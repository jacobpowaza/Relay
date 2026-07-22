#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";

const path = `${homedir()}/.relay/integrations/session-end.log`;
mkdirSync(dirname(path), { recursive: true });
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", async () => {
  let parsedInput = {};
  try {
    parsedInput = input ? JSON.parse(input) : {};
  } catch {}
  const line = JSON.stringify({ at: new Date().toISOString(), agent: "claude-code", event: "session-end", input: parsedInput });
  const previous = (() => {
    try { return readFileSync(path, "utf8"); } catch { return ""; }
  })();
  writeFileSync(path, `${previous}${line}\n`, { mode: 0o600 });
  try {
    const core = await import("../core/index.js");
    const repository = core.detectRepositoryIdentity(process.cwd());
    const config = core.loadIntegrationConfig(core.defaultConfigPath());
    const link = config.repositories[repository.root];
    if (!config.enabled || !link?.enabled) return;

    const workspacePath = config.localWorkspacePath ?? core.defaultLocalWorkspacePath();
    const checkpoint = core.checkpointFromSessionEndInput(parsedInput, "claude-code", link.boardId);
    checkpoint.repository = repository;
    core.appendCheckpointToLocalWorkspace(workspacePath, checkpoint);

    const repoPath = repository.root;

    // Drain the discovery debounce queue before doing anything else. During the
    // session, edited files wait for a quiet period so a file rewritten several
    // times is indexed once, at rest. The session ending is the last chance to
    // index whatever was still inside that window.
    try {
      const { execFileSync } = await import("node:child_process");
      const { fileURLToPath } = await import("node:url");
      const { join } = await import("node:path");
      const hookDir = dirname(fileURLToPath(import.meta.url));
      execFileSync(process.execPath, [join(hookDir, "discovery-index.mjs"), "--flush"], {
        input: JSON.stringify({ cwd: repoPath }),
        stdio: ["pipe", "ignore", "ignore"],
        timeout: 5_000,
      });
    } catch {
      // A failed flush leaves entries queued for the next session; it must
      // never block session teardown.
    }

    const discovery = core.loadDiscoveryFromWorkspace(workspacePath, repoPath);
    if (discovery && discovery.entries.length > 0) {
      const changedPaths = parsedInput.changedFiles ?? parsedInput.files ?? [];
      if (Array.isArray(changedPaths) && changedPaths.length > 0) {
        const { createHash } = await import("node:crypto");
        const { readFileSync, existsSync } = await import("node:fs");
        const now = new Date().toISOString();
        const entryMap = new Map(discovery.entries.map((e) => [e.filePath, e]));
        let updated = false;
        for (const rawPath of changedPaths) {
          const relativePath = typeof rawPath === "string"
            ? (rawPath.startsWith("/") ? rawPath.slice(repository.root.length + 1) : rawPath)
            : "";
          const entry = entryMap.get(relativePath);
          if (!entry) continue;
          const fullPath = repository.root + "/" + relativePath;
          if (!existsSync(fullPath)) continue;
          try {
            const content = readFileSync(fullPath, "utf8");
            const hash = createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
            if (hash !== entry.contentHash) {
              entry.contentHash = hash;
              entry.lastModified = now;
              entry.lastDiscovered = now;
              entry.discoveredBy = "claude-code";
              entry.status = "current";
              updated = true;
            }
          } catch {}
        }
        if (updated) {
          const raw = JSON.parse(readFileSync(workspacePath, "utf8"));
          if (raw.discoveries === undefined) raw.discoveries = {};
          // MUST be the normalized key. Writing under the raw path created a
          // second, orphaned entry that neither the app nor the hooks ever read,
          // leaving the real index on stale hashes forever.
          raw.discoveries[core.discoveryKey(repoPath)] = discovery;
          // Write to a temp file and rename, the way every other writer in this
          // codebase does. A direct write here is a truncation window over the
          // user's ENTIRE workspace — boards, cards and notes, not just the
          // discovery index — if the process dies or the disk fills mid-write.
          const { randomUUID } = await import("node:crypto");
          const { renameSync } = await import("node:fs");
          const temporaryPath = `${workspacePath}.${process.pid}.${randomUUID()}.tmp`;
          writeFileSync(temporaryPath, JSON.stringify(raw, null, 2), { mode: 0o600 });
          renameSync(temporaryPath, workspacePath);
        }
      }
    }
  } catch {}
});
