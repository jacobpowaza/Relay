const { createHash } = require("node:crypto");
const { readFile, stat, readdir } = require("node:fs/promises");
const path = require("node:path");

const IGNORED_DIRECTORIES = new Set([
  ".git", "node_modules", ".next", "dist", "build", ".turbo",
  "coverage", ".nyc_output", "__pycache__", ".venv", "venv",
  ".cache", ".vscode", ".idea", "vendor", ".relay",
  // Packaged app / native build output. Without these, a packaged Electron
  // app (Relay.app/Contents/Resources/...) or a mobile build gets walked and
  // indexed as if it were source — hundreds of duplicate, non-editable files.
  "release", "out", "target", "bin", "obj",
  "Pods", "DerivedData", "Carthage", ".dart_tool", ".gradle",
  ".parcel-cache", ".svelte-kit", ".output", ".vercel", ".serverless",
  ".expo", "Debug", "Release",
]);

// Directories that are themselves build artifacts regardless of where they
// sit in the tree — a macOS app bundle can appear anywhere a release step
// drops it, not just under a directory named "release".
const IGNORED_DIRECTORY_SUFFIXES = [".app", ".framework", ".xcodeproj", ".xcworkspace", ".xcarchive"];

const IGNORED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
  ".woff", ".woff2", ".ttf", ".eot",
  ".mp4", ".webm", ".ogg", ".wav", ".mp3",
  ".zip", ".tar", ".gz", ".br",
  ".map", ".d.ts",
  ".lock", ".sum",
  // Packaged release output lands at the repo root, outside the ignored dirs.
  ".dmg", ".blockmap", ".exe", ".appimage", ".deb", ".rpm", ".pkg", ".asar",
]);

const SOURCE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".rs", ".go", ".java", ".rb", ".php",
  ".css", ".scss", ".less", ".html", ".vue", ".svelte",
  ".swift", ".kt", ".dart",
  ".json", ".yaml", ".yml", ".toml",
]);

/**
 * @param {string} dirPath
 * @returns {Promise<Array<{ filePath: string; relativePath: string }>>}
 */
async function walkDirectory(dirPath, rootPath = dirPath) {
  /** @type {Array<{ filePath: string; relativePath: string }>} */
  const results = [];
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)) continue;
    if (entry.isDirectory() && IGNORED_DIRECTORY_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      // Resolve against the repo root, not the current subdirectory, or nested
      // entries collapse to their basename and every index.ts collides.
      const sub = await walkDirectory(fullPath, rootPath);
      results.push(...sub);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (IGNORED_EXTENSIONS.has(ext)) continue;
      results.push({ filePath: fullPath, relativePath: path.relative(rootPath, fullPath) });
    }
  }
  return results;
}

/**
 * The set of files the index covers. `discoverRepository` and `diffDiscovery`
 * must agree on this, or every file one includes and the other skips is
 * reported as permanently "added".
 * @param {Array<{ filePath: string; relativePath: string }>} files
 * @returns {Array<{ filePath: string; relativePath: string }>}
 */
function selectSourceFiles(files) {
  return files.filter((f) => SOURCE_EXTENSIONS.has(path.extname(f.relativePath).toLowerCase()));
}

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function computeFileHash(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
  } catch {
    return "";
  }
}

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function getModifiedTime(filePath) {
  try {
    const s = await stat(filePath);
    return s.mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

/**
 * @param {string} content
 * @param {string} relativePath
 * @param {string} ext
 * @returns {string[]}
 */
function extractExports(content, relativePath, ext) {
  /** @type {string[]} */
  const exports = [];
  if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") {
    const namedExport = content.matchAll(/export\s+(?:default\s+)?(?:function|const|class|type|interface|enum|async\s+function)\s+(\w+)/g);
    for (const match of namedExport) { if (match[1] !== undefined) exports.push(match[1]); }
    const exportDefault = content.match(/export\s+default\s+(?:function\s+)?(\w+)/);
    if (exportDefault !== null && exportDefault[1] !== undefined) exports.push("default:" + exportDefault[1]);
    // CommonJS: `module.exports = { a, b }` and `exports.name = ...`. Without
    // this every .cjs file indexes with zero exports and low confidence.
    const cjsBlock = content.match(/module\.exports\s*=\s*\{([^}]*)\}/);
    if (cjsBlock !== null && cjsBlock[1] !== undefined) {
      for (const part of cjsBlock[1].split(",")) {
        const name = (part.split(":")[0] ?? "").trim();
        if (/^\w+$/.test(name)) exports.push(name);
      }
    }
    for (const match of content.matchAll(/^(?:module\.)?exports\.(\w+)\s*=/gm)) { if (match[1] !== undefined) exports.push(match[1]); }
  }
  if (ext === ".py") {
    const defs = content.matchAll(/^(?:async\s+)?def\s+(\w+)|^class\s+(\w+)/gm);
    for (const match of defs) { const name = match[1] ?? match[2]; if (name !== undefined) exports.push(name); }
  }
  if (ext === ".rs") {
    const fns = content.matchAll(/^(?:pub\s+)?fn\s+(\w+)|^(?:pub\s+)?(?:struct|enum|trait|impl|mod)\s+(\w+)/gm);
    for (const match of fns) { const name = match[1] ?? match[2]; if (name !== undefined) exports.push(name); }
  }
  return exports.slice(0, 8);
}

/**
 * @param {string} content
 * @param {string} relativePath
 * @param {string} ext
 * @returns {string[]}
 */
function extractImports(content, relativePath, ext) {
  /** @type {string[]} */
  const imports = [];
  if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") {
    const localImports = content.matchAll(/from\s+["'](\.[^"']+)["']/g);
    for (const match of localImports) { if (match[1] !== undefined) imports.push(match[1]); }
    const dynamicImports = content.matchAll(/import\s*\(?\s*["'](\.[^"']+)["']\)?/g);
    for (const match of dynamicImports) { if (match[1] !== undefined) imports.push(match[1]); }
    const requireImports = content.matchAll(/require\s*\(\s*["'](\.[^"']+)["']\s*\)/g);
    for (const match of requireImports) { if (match[1] !== undefined) imports.push(match[1]); }
  }
  if (ext === ".py") {
    const pyImports = content.matchAll(/(?:from\s+(\.[^\s]+)\s+import|import\s+(\.[^\s]+))/g);
    for (const match of pyImports) {
      if (match[1] !== undefined) imports.push(match[1]);
      if (match[2] !== undefined) imports.push(match[2]);
    }
  }
  return imports.filter((imp) => !imp.includes("node_modules")).slice(0, 12);
}

// Filename-specific overrides, checked before any directory- or content-based
// guess. These are exact, well-known files whose purpose is fixed by their
// name — matching them against the full path (as the generic patterns below
// do) is how a `package.json` sitting under `apps/api/` used to inherit
// "API route and request handler" from its parent directory's name.
const FILENAME_PATTERNS = [
  { match: /^package\.json$/, purpose: "Package manifest and dependency list" },
  { match: /^tsconfig(\..+)?\.json$/, purpose: "TypeScript compiler configuration" },
  { match: /^(vite|webpack|rollup|esbuild)\.config\.(m?[jt]s|cjs)$/, purpose: "Build tool configuration" },
  { match: /^(babel|jest|vitest)\.config\.(m?[jt]s|cjs|json)$/, purpose: "Test/transpile tool configuration" },
  { match: /^\.?eslintrc(\..+)?$|^eslint\.config\.(m?[jt]s|cjs)$/, purpose: "Lint rule configuration" },
  { match: /^\.?prettierrc(\..+)?$|^prettier\.config\.(m?[jt]s|cjs)$/, purpose: "Code formatting configuration" },
  { match: /^electron-builder\.(yml|yaml|json|js)$/, purpose: "Electron packaging and release configuration" },
  { match: /^app-update\.yml$/, purpose: "Electron auto-update feed configuration" },
  { match: /^Dockerfile(\..+)?$/, purpose: "Container build definition" },
  { match: /^docker-compose(\..+)?\.ya?ml$/, purpose: "Container orchestration configuration" },
  { match: /^README(\..+)?$/i, purpose: "Project documentation" },
  { match: /^CHANGELOG(\..+)?$/i, purpose: "Change history and release notes" },
  { match: /^\.env(\..+)?$/, purpose: "Environment variable configuration" },
];

// Directory names strong enough to signal purpose on their own, but only for
// files that are still ambiguous by name — and matched as a whole path
// segment, not a substring, so `apps/api-docs/foo.ts` doesn't match `api`.
const STRUCTURAL_DIRECTORIES = [
  { match: /^(api|routes?)$/i, purpose: "API route and request handler" },
  { match: /^(controllers?)$/i, purpose: "Request controller" },
  { match: /^(middlewares?)$/i, purpose: "Request middleware and interceptors" },
  { match: /^(hooks?)$/i, purpose: "React hook" },
  { match: /^(components?)$/i, purpose: "UI component" },
  { match: /^(pages?|views?)$/i, purpose: "Page layout and routing" },
  { match: /^(migrations?)$/i, purpose: "Database migration" },
  { match: /^(workers?|jobs?|queues?)$/i, purpose: "Background worker and job processing" },
];

/**
 * @param {string} relativePath
 * @param {string} ext
 * @param {string[]} exports
 * @returns {string}
 */
function inferPurpose(relativePath, ext, exports) {
  const name = path.basename(relativePath, ext);
  const basename = path.basename(relativePath);
  const dirs = relativePath.split(path.sep);
  const parentDir = (dirs.length > 1 ? dirs[dirs.length - 2] : "") ?? "";

  for (const pattern of FILENAME_PATTERNS) {
    if (pattern.match.test(basename)) return pattern.purpose;
  }

  // Content-derived patterns, matched against the filename first (not the
  // full path — a directory called "api-utils" would otherwise satisfy the
  // "util" pattern via substring match on unrelated ancestors). Tests are
  // checked ahead of everything else in this group so a spec file living
  // under a feature directory is never mislabeled as that feature's own code.
  const patterns = [
    { match: /test|spec|e2e|cypress|playwright|vitest|jest|unit/i, purpose: "Tests and test utilities" },
    { match: /auth|login|session|oauth|jwt|token/i, purpose: "Authentication and authorization" },
    { match: /user|profile|account/i, purpose: "User and account management" },
    { match: /payment|stripe|billing|checkout|invoice/i, purpose: "Payment and billing processing" },
    { match: /database|schema|model|entity|repository|prisma|drizzle|typeorm/i, purpose: "Database model and data access" },
    { match: /route|endpoint|controller|handler/i, purpose: "API route and request handler" },
    { match: /middleware/i, purpose: "Request middleware and interceptors" },
    { match: /^use[A-Z]/, purpose: "React hook" },
    { match: /component|button|card|modal|form|input|select|dialog|tooltip/i, purpose: "UI component" },
    { match: /layout|page/i, purpose: "Page layout and routing" },
    { match: /style|css|theme|design-token/i, purpose: "Styles and design tokens" },
    { match: /util|helper|common|shared/i, purpose: "Shared utilities and helpers" },
    { match: /config|setting|env|constant/i, purpose: "Configuration and constants" },
    { match: /error|exception|fallback|boundary/i, purpose: "Error handling and boundaries" },
    { match: /provider|context/i, purpose: "React context provider" },
    { match: /plugin|adapter|bridge/i, purpose: "Integration adapter and bridge" },
    { match: /type|interface|enum/i, purpose: "TypeScript type definitions" },
    { match: /worker|queue|job|task|scheduler/i, purpose: "Background worker and job processing" },
    { match: /webhook|notification|email|push|alert/i, purpose: "Webhook and notification handling" },
    { match: /search|query|filter/i, purpose: "Search and query logic" },
    { match: /cache|redis|memcache/i, purpose: "Caching layer" },
    { match: /log|monitor|metric|trace|observability/i, purpose: "Logging and observability" },
    { match: /validat|sanitize|parse/i, purpose: "Validation and data parsing" },
    { match: /migration|seed/i, purpose: "Database migration and seeding" },
    { match: /docker|compose|deploy/i, purpose: "Deployment and infrastructure configuration" },
    { match: /^index$/i, purpose: "Module index and re-exports" },
  ];

  for (const pattern of patterns) {
    if (pattern.match.test(basename)) return pattern.purpose;
  }

  for (const dir of STRUCTURAL_DIRECTORIES) {
    if (dir.match.test(parentDir)) return dir.purpose;
  }

  if (exports.length > 0) {
    const joinedExports = exports.join(" ");
    if (/handler|controller|endpoint/i.test(joinedExports)) return "API route handler";
    if (/schema|model|entity/i.test(joinedExports)) return "Data model definition";
    if (/render|component|view|page/i.test(joinedExports)) return "UI component";
  }

  const capitalized = `${(name[0] ?? "").toUpperCase()}${name.slice(1)}`;
  return `${capitalized} module`;
}

const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Status is derived, never stored: a persisted value goes stale the instant
 * anything writes to the file. Callers compute it against the current disk
 * state so the UI and the plugin context packet always agree.
 *
 * Hashing is gated behind an mtime comparison - re-hashing every entry on
 * every read is too slow on large repos, and an unchanged mtime means an
 * unchanged file in practice.
 *
 * @param {string} repoRoot
 * @param {any} entry
 * @returns {Promise<"current"|"changed"|"new"|"stale"|"never">}
 */
async function computeEntryStatus(repoRoot, entry) {
  if (!entry) return "new";
  if (!entry.lastDiscovered) return "never";

  const absPath = path.resolve(repoRoot, entry.filePath);
  let mtimeMs;
  try {
    mtimeMs = (await stat(absPath)).mtimeMs;
  } catch {
    // Path no longer resolves - the entry points at a moved or deleted file.
    return "stale";
  }

  const discoveredMs = new Date(entry.lastDiscovered).getTime();
  if (Number.isNaN(discoveredMs)) return "never";

  if (mtimeMs > discoveredMs) {
    // mtime moved, but a touch or a revert can leave content identical.
    // Confirm with the hash so formatting-only churn is not flagged.
    const hash = await computeFileHash(absPath);
    return hash && hash === entry.contentHash ? "current" : "changed";
  }

  if (Date.now() - discoveredMs > STALE_AFTER_MS) return "stale";
  return "current";
}

/**
 * Resolves derived status for a whole index in one pass.
 * @param {string} repoRoot
 * @param {Array<any>} entries
 * @returns {Promise<Array<any>>}
 */
async function withDerivedStatus(repoRoot, entries) {
  return Promise.all(entries.map(async (entry) => ({
    ...entry,
    status: await computeEntryStatus(repoRoot, entry),
  })));
}

/**
 * Indexes one file. Shared by the full scan and by single-file updates so an
 * agent can add a newly-encountered file without triggering a repo walk.
 * @param {string} repoRoot
 * @param {string} relativePath
 * @param {object} [options]
 * @param {string} [options.discoveredBy]
 * @param {Array<{ relativePath: string }>} [options.siblingFiles]
 * @returns {Promise<any>}
 */
async function buildEntry(repoRoot, relativePath, options = {}) {
  const absPath = path.resolve(repoRoot, relativePath);
  const ext = path.extname(relativePath).toLowerCase();
  let content;
  try {
    content = await readFile(absPath, "utf8");
  } catch {
    return null;
  }

  const now = new Date().toISOString();
  const importantExports = extractExports(content, relativePath, ext);
  const rawImports = extractImports(content, relativePath, ext);
  const dependencies = [...new Set(rawImports.map((imp) => {
    const resolved = path.resolve(path.dirname(absPath), imp);
    return path.relative(repoRoot, resolved);
  }))].filter((dep) => !dep.startsWith(".."));

  const segments = relativePath.split(path.sep);
  const featureHint = segments.length > 1 ? segments[0] : "";
  const featureName = featureHint && /^[a-z][a-z0-9-]+$/i.test(featureHint) ? featureHint : "";

  const relatedFiles = [];
  if ((ext === ".ts" || ext === ".tsx") && options.siblingFiles) {
    const dirPrefix = relativePath.replace(/[^/]+$/, "");
    relatedFiles.push(...options.siblingFiles
      .filter((sf) => sf.relativePath.startsWith(dirPrefix) && sf.relativePath !== relativePath)
      .slice(0, 5)
      .map((sf) => sf.relativePath));
  }

  return {
    filePath: relativePath,
    purpose: inferPurpose(relativePath, ext, importantExports),
    importantExports,
    relatedFiles: [...new Set(relatedFiles)],
    features: featureName ? [featureName] : [],
    dependencies,
    lastModified: await getModifiedTime(absPath),
    contentHash: createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16),
    lastDiscovered: now,
    discoveredBy: options.discoveredBy ?? "relay-desktop",
    confidence: importantExports.length > 0 ? "high" : "medium",
    status: "current",
  };
}

/**
 * @param {string} repoRoot
 * @param {object} [options]
 * @param {boolean} [options.quick]
 * @param {string} [options.discoveredBy]
 * @returns {Promise<any>}
 */
async function discoverRepository(repoRoot, options = {}) {
  let entries = [];
  const featureMap = new Map();
  const now = new Date().toISOString();

  if (options.quick) {
    return {
      boardId: "",
      entries: [],
      features: [],
      lastFullDiscovery: now,
      coverage: 100,
      staleRelationshipCount: 0,
      discoveryCount: 0,
      version: 1,
    };
  }

  const files = await walkDirectory(repoRoot);
  const sourceFiles = selectSourceFiles(files);

  for (const { relativePath } of sourceFiles) {
    const entry = await buildEntry(repoRoot, relativePath, {
      discoveredBy: options.discoveredBy ?? "relay-desktop",
      siblingFiles: sourceFiles,
    });
    if (entry === null) continue;
    entry.lastDiscovered = now;

    const featureName = entry.features[0];
    if (featureName && !featureMap.has(featureName)) {
      featureMap.set(featureName, { name: featureName, description: `${featureName} feature area`, filePaths: [] });
    }
    entries.push(entry);
  }

  for (const entry of entries) {
    for (const dep of entry.dependencies) {
      const resolved = sourceFiles.find((sf) => {
        const depPath = dep.replace(/^\.\//, "");
        return sf.relativePath === depPath || sf.relativePath === depPath + ".ts" || sf.relativePath === depPath + ".tsx" || sf.relativePath === depPath + "/index.ts" || sf.relativePath === depPath + "/index.tsx" || sf.relativePath === depPath + ".js" || sf.relativePath === depPath + ".jsx";
      });
      if (resolved) {
        const depEntry = entries.find((e) => e.filePath === resolved.relativePath);
        if (depEntry) {
          depEntry.relatedFiles.push(entry.filePath);
          depEntry.relatedFiles = [...new Set(depEntry.relatedFiles)];
        }
      }
    }
  }

  for (const entry of entries) {
    if (entry.features.length > 0) {
      const feat = featureMap.get(entry.features[0]);
      if (feat) feat.filePaths.push(entry.filePath);
    }
  }

  // Coverage is indexed-vs-indexable. Measuring against every walked file
  // counts assets the index deliberately skips and understates coverage.
  const totalFiles = sourceFiles.length;
  const indexedCount = entries.length;
  const coverage = totalFiles > 0 ? Math.round((indexedCount / totalFiles) * 100) : 100;

  return {
    boardId: "",
    entries,
    features: [...featureMap.values()],
    lastFullDiscovery: now,
    coverage: Math.min(100, coverage),
    staleRelationshipCount: 0,
    discoveryCount: entries.length,
    version: 1,
  };
}

/**
 * @param {string} repoRoot
 * @param {Array<{ filePath: string; contentHash: string }>} existingEntries
 * @returns {Promise<{ changed: string[]; added: string[]; deleted: string[]; entries: Array<{ filePath: string; contentHash: string }> }>}
 */
async function diffDiscovery(repoRoot, existingEntries) {
  const files = selectSourceFiles(await walkDirectory(repoRoot));
  const currentPaths = new Set(files.map((f) => f.relativePath));
  const existingMap = new Map(existingEntries.map((e) => [e.filePath, e]));

  const changed = [];
  const added = [];
  const deleted = [];

  for (const { relativePath, filePath } of files) {
    const existing = existingMap.get(relativePath);
    if (!existing) {
      added.push(relativePath);
      continue;
    }
    const hash = await computeFileHash(filePath);
    if (hash && hash !== existing.contentHash) {
      changed.push(relativePath);
    }
  }
  for (const existingPath of existingMap.keys()) {
    if (!currentPaths.has(existingPath)) deleted.push(existingPath);
  }

  return { changed, added, deleted, entries: existingEntries };
}

module.exports = {
  buildEntry,
  computeEntryStatus,
  computeFileHash,
  diffDiscovery,
  discoverRepository,
  extractExports,
  inferPurpose,
  selectSourceFiles,
  walkDirectory,
  withDerivedStatus,
};
