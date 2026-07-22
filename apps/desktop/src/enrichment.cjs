const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const { readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");

/**
 * Agent-backed enrichment for the heuristic index.
 *
 * The heuristic scan in discovery.cjs is cheap and covers the whole repo, but
 * its purposes are pattern-matched ("UI component", "Shared utilities"). This
 * module upgrades selected entries to real semantic summaries by handing a
 * batch of files to an agent CLI. It is deliberately on-demand: enriching the
 * whole index would cost more tokens than the index saves.
 */

/**
 * @typedef {object} AgentSpec
 * @property {string} label
 * @property {string} command
 * @property {Array<{ id: string; label: string }>} models
 * @property {string} defaultModel
 * @property {boolean} [schemaEnforced]
 * @property {(model: string, outputFile: string, schemaFile: string) => string[]} buildArgs
 * @property {(stdout: string, outputFileContents: string) => string} extractText
 * @property {number} [fixedContextTokens] measured per-spawn overhead, used for
 *   the pre-run cost estimate.
 * @property {{ inputPerMillionUsd: number; outputPerMillionUsd: number }} [rates]
 *   per-model price, keyed by model id. Absent means the run cannot be priced.
 */

/** @type {Record<string, AgentSpec>} */
const AGENTS = {
  claude: {
    label: "Claude",
    command: "claude",
    models: [
      { id: "claude-opus-4-8", label: "Opus 4.8" },
      { id: "claude-sonnet-5", label: "Sonnet 5" },
      { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
    ],
    defaultModel: "claude-haiku-4-5-20251001",
    buildArgs: (/** @type {string} */ model) => [
      "-p", "--model", model, "--output-format", "json",
      // Enrichment is pure summarization: it needs the model, not a coding
      // agent. Booting a default session loaded the user's settings, plugins,
      // skills, hooks and MCP servers into every batch — measured at 34,322
      // context tokens to answer a 10-token prompt. These flags cut that to
      // 9,393 (-73%, $0.0469 -> $0.0109 per batch) with identical output.
      "--setting-sources", "",
      "--strict-mcp-config",
      "--disable-slash-commands",
      // No file access needed; the excerpts are already in the prompt.
      "--disallowed-tools", "Bash", "Edit", "Write", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task",
    ],
    // Verified against claude 2.0 live: the prompt is accepted on stdin and the
    // reply text lands in `result` on a single JSON object printed to stdout.
    extractText: (/** @type {string} */ stdout) => {
      const parsed = JSON.parse(stdout);
      // A refusal or tool failure still exits 0 with a well-formed envelope, so
      // the error flag has to be checked or the message becomes a "summary".
      if (parsed.is_error === true) {
        const detail = typeof parsed.result === "string" ? parsed.result.slice(0, 200) : parsed.subtype;
        throw new Error(`claude reported an error: ${detail}`);
      }
      if (typeof parsed.result === "string") return parsed.result;
      throw new Error("Unrecognized claude CLI envelope.");
    },
  },
  codex: {
    label: "Codex",
    command: "codex",
    // Verified live against codex v0.144 on a ChatGPT account: EVERY explicit
    // model id is rejected at the API with "The '<id>' model is not supported
    // when using Codex with a ChatGPT account" — gpt-5-codex, gpt-5.1-codex,
    // gpt-5.1-codex-mini and o4-mini were all probed and all refused. So there
    // is no model list to offer here; the only thing that works is omitting -m
    // and letting codex use whatever ~/.codex/config.toml selects. A dropdown
    // of ids that cannot run would be worse UI than one honest row.
    models: [{ id: "", label: "Codex default (from config)" }],
    defaultModel: "",
    // Codex constrains its reply with a JSON Schema rather than a prompt
    // instruction, which is why it needs a second temp file.
    schemaEnforced: true,
    buildArgs: (/** @type {string} */ model, /** @type {string} */ outputFile, /** @type {string} */ schemaFile) => [
      "exec",
      // An empty model means "don't pass -m", letting codex pick its default.
      ...(model === "" ? [] : ["-m", model]),
      "--sandbox", "read-only",
      "--color", "never",
      // Without this codex refuses to start in any directory that is not a git
      // repo, which a discovered project may well not be.
      "--skip-git-repo-check",
      // Indexing is stateless; persisting a session per batch would litter
      // CODEX_HOME with a rollout file for every 30 files indexed.
      "--ephemeral",
      // Server-enforced reply shape, strictly better than asking for JSON in
      // the prompt: the model cannot answer with prose or a code fence, so
      // extractJsonArray never has to salvage anything.
      "--output-schema", schemaFile,
      // codex writes its banner, transcript and errors to stderr and leaves
      // stdout EMPTY, so the reply has to be collected from a file.
      "-o", outputFile,
    ],
    extractText: (/** @type {string} */ _stdout, /** @type {string} */ outputFileContents) => outputFileContents,
  },
};

/**
 * Reply schema for agents that support server-side shape enforcement.
 *
 * Two constraints here were found by live rejection rather than from the docs,
 * and both are load-bearing:
 *   1. the root must be `type: "object"` — an array root is refused outright
 *      ("schema must be a JSON Schema of 'type: \"object\"'"), which is why the
 *      entries are wrapped in `files` instead of returned bare the way the
 *      Claude path returns them;
 *   2. strict mode requires `required` to list EVERY key in `properties`, so
 *      `features` is mandatory even for a file that has none — the model
 *      returns an empty array rather than omitting the key.
 */
const REPLY_SCHEMA = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          purpose: { type: "string" },
          features: { type: "array", items: { type: "string" } },
        },
        required: ["path", "purpose", "features"],
        additionalProperties: false,
      },
    },
  },
  required: ["files"],
  additionalProperties: false,
};

/**
 * Files per agent call. Larger batches amortize the prompt but risk truncation.
 *
 * Each spawn pays a fixed ~9.4k tokens of system context no matter how little
 * it is asked to do, so the batch size is what decides cost per file: at 12 the
 * fixed overhead was ~780 tokens/file, at 30 it is ~310. Held at 30 because the
 * reply is one JSON object per file and long replies are where truncation and
 * dropped entries start showing up.
 */
const BATCH_SIZE = 30;
/** Chars of each file sent for summarization. Whole files blow the budget fast. */
const EXCERPT_CHARS = 1600;

/**
 * Measured fixed context each spawn pays before it reads a single file, used
 * only for the pre-run estimate.
 *
 * claude: 9,393, measured after the --setting-sources/--strict-mcp-config/
 * --disallowed-tools trim (it was 34,322 with a default session).
 * codex: ~16,000. Two identical 2-file runs reported 15,900 and 17,377 tokens,
 * so this number carries roughly +/-10% of real variance on its own — which is
 * the honest reason the UI must say "estimate" rather than quote a total.
 * --ignore-user-config was measured as a possible trim and REJECTED: it came in
 * at 17,377 vs 15,900, i.e. no saving, while discarding the user's model config.
 */
/** @type {Record<string, number>} */
const FIXED_CONTEXT_TOKENS = { claude: 9393, codex: 16000 };

/** Rough bytes-per-token. Universal approximation for English + source text. */
const CHARS_PER_TOKEN = 4;

/** Reply size per file: one short JSON object, measured at ~40 tokens. */
const OUTPUT_TOKENS_PER_FILE = 40;

/**
 * Published per-million token prices, in USD.
 *
 * Only models whose price is actually known appear here. A model that is absent
 * yields a null cost rather than a guessed one: showing a confidently wrong
 * dollar figure is worse than showing none. Codex is deliberately absent — it
 * bills against a ChatGPT plan on this account, not per token, so there is no
 * per-token price that would be true.
 */
/** @type {Record<string, { inputPerMillionUsd: number; outputPerMillionUsd: number }>} */
const MODEL_RATES = {
  "claude-opus-4-8": { inputPerMillionUsd: 5, outputPerMillionUsd: 25 },
  "claude-sonnet-5": { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  "claude-haiku-4-5-20251001": { inputPerMillionUsd: 1, outputPerMillionUsd: 5 },
};

/**
 * Estimates what an enrichment run will cost BEFORE it is started, so the user
 * can see the bill implied by a click rather than discover it afterwards.
 *
 * Deliberately computed here and not in the renderer: the renderer has no idea
 * what BATCH_SIZE is, what the per-spawn overhead is, or how large the excerpts
 * are, and duplicating those constants across the IPC boundary is exactly how
 * they drift out of step with the code that actually spends the tokens.
 *
 * The excerpt term uses each file's real size capped at EXCERPT_CHARS, matching
 * what buildPrompt will actually send, so a repo of small files is not billed as
 * though every file were 1600 chars.
 *
 * @param {object} options
 * @param {string} options.agent
 * @param {string} [options.model]
 * @param {number[]} options.fileSizes byte size of each file to be enriched
 * @returns {{ files: number; batches: number; inputTokens: number; outputTokens: number; costUsd: number | null; model: string; agent: string; approximate: true }}
 */
function estimateEnrichmentCost({ agent, model, fileSizes }) {
  const spec = AGENTS[agent];
  if (spec === undefined) throw new Error(`Unknown discovery agent: ${agent}`);
  const chosenModel = model ?? spec.defaultModel;

  const files = fileSizes.length;
  const batches = Math.ceil(files / BATCH_SIZE);
  const overhead = FIXED_CONTEXT_TOKENS[agent] ?? 12000;

  const excerptTokens = fileSizes.reduce(
    (sum, size) => sum + Math.ceil(Math.min(size, EXCERPT_CHARS) / CHARS_PER_TOKEN),
    0,
  );
  const inputTokens = batches * overhead + excerptTokens;
  const outputTokens = files * OUTPUT_TOKENS_PER_FILE;

  const rate = MODEL_RATES[chosenModel];
  const costUsd = rate === undefined
    ? null
    : (inputTokens / 1_000_000) * rate.inputPerMillionUsd + (outputTokens / 1_000_000) * rate.outputPerMillionUsd;

  return { agent, model: chosenModel, files, batches, inputTokens, outputTokens, costUsd, approximate: true };
}

/**
 * @param {string} agent
 * @returns {{ label: string; models: Array<{ id: string; label: string }>; defaultModel: string }}
 */
function describeAgent(agent) {
  const spec = AGENTS[agent];
  if (spec === undefined) throw new Error(`Unknown discovery agent: ${agent}`);
  return { label: spec.label, models: spec.models, defaultModel: spec.defaultModel };
}

function listAgents() {
  return Object.keys(AGENTS).map((id) => ({ id, ...describeAgent(id) }));
}

/**
 * Agents wrap JSON in prose and fences no matter how firmly the prompt asks
 * them not to. Recover the first balanced top-level array instead of trusting
 * the whole reply to parse.
 *
 * Schema-enforced replies (codex) arrive as `{"files":[...]}` rather than a
 * bare array, because the schema root is required to be an object. That case is
 * tried first and exactly: when the whole reply parses cleanly there is nothing
 * to salvage, and scanning for the first `[` would otherwise still work but for
 * the wrong reason — it would find the array by accident rather than by
 * contract, and would silently pick the wrong one if the shape ever gains a
 * second array field.
 *
 * @param {string} text
 * @returns {Array<Record<string, unknown>>}
 */
function extractJsonArray(text) {
  try {
    const whole = JSON.parse(text);
    if (Array.isArray(whole)) return whole;
    if (whole !== null && typeof whole === "object" && Array.isArray(whole.files)) return whole.files;
  } catch {
    // Not a clean JSON document: fall through to the salvage scan below.
  }

  const start = text.indexOf("[");
  if (start === -1) throw new Error("Agent reply contained no JSON array.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        const parsed = JSON.parse(text.slice(start, i + 1));
        if (!Array.isArray(parsed)) throw new Error("Agent reply was not a JSON array.");
        return parsed;
      }
    }
  }
  throw new Error("Agent reply contained an unterminated JSON array.");
}

/**
 * @param {string} repoRoot
 * @param {string[]} filePaths
 * @param {{ schemaEnforced?: boolean }} [options] when the agent enforces the
 *   reply shape server-side, the JSON instructions are omitted: repeating them
 *   would contradict the schema (which mandates an object root, not the bare
 *   array the prompt asks for) and waste prompt tokens on every batch.
 * @returns {Promise<string>}
 */
async function buildPrompt(repoRoot, filePaths, options = {}) {
  /** @type {string[]} */
  const sections = [];
  for (const relativePath of filePaths) {
    let content = "";
    try {
      content = await readFile(path.resolve(repoRoot, relativePath), "utf8");
    } catch {
      continue;
    }
    const excerpt = content.length > EXCERPT_CHARS ? `${content.slice(0, EXCERPT_CHARS)}\n...[truncated]` : content;
    sections.push(`### ${relativePath}\n\`\`\`\n${excerpt}\n\`\`\``);
  }

  const instructions = [
    "You are indexing a codebase for a cached project index.",
    "For each file below, write a one-sentence purpose describing what it actually does in this project.",
    "Be specific: say what this file is responsible for, not what kind of file it is.",
    'Bad: "UI component". Good: "Renders the discovery table and owns row selection state".',
    "Use the exact path as given. Return one entry per file.",
  ];

  if (options.schemaEnforced !== true) {
    instructions.push(
      "",
      "Reply with ONLY a JSON array, no prose and no code fence, shaped:",
      '[{"path":"<exact path as given>","purpose":"<one sentence>","features":["<area>"]}]',
    );
  }

  return [...instructions, "", sections.join("\n\n")].join("\n");
}

/**
 * Runs one agent batch.
 * @param {object} options
 * @param {string} options.agent
 * @param {string} options.model
 * @param {string} options.prompt
 * @param {string} options.cwd
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
function runAgentBatch({ agent, model, prompt, cwd, signal }) {
  const spec = AGENTS[agent];
  if (spec === undefined) return Promise.reject(new Error(`Unknown discovery agent: ${agent}`));

  // Some CLIs (codex) only expose their reply through a file. Allocate one per
  // call so concurrent batches cannot read each other's output.
  const runId = randomUUID();
  const outputFile = path.join(tmpdir(), `relay-discovery-${runId}.txt`);
  const schemaFile = path.join(tmpdir(), `relay-discovery-${runId}.schema.json`);

  const run = new Promise((resolve, reject) => {
    // --output-schema takes a path, not inline JSON, so the schema has to exist
    // on disk before the child starts. Written synchronously for exactly that
    // ordering reason: an async write could still be in flight at spawn time.
    if (spec.schemaEnforced === true) {
      try {
        writeFileSync(schemaFile, JSON.stringify(REPLY_SCHEMA), "utf8");
      } catch (error) {
        reject(new Error(`Could not stage the ${spec.label} reply schema: ${error instanceof Error ? error.message : String(error)}`));
        return;
      }
    }

    /** @type {import("node:child_process").ChildProcessWithoutNullStreams} */
    let child;
    try {
      child = spawn(spec.command, spec.buildArgs(model, outputFile, schemaFile), {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
    } catch (error) {
      reject(new Error(`Could not start ${spec.label}: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    function onAbort() {
      child.kill("SIGTERM");
      finish(reject, new Error("cancelled"));
    }

    /**
     * @param {(value: any) => void} fn
     * @param {any} value
     */
    function finish(fn, value) {
      if (settled) return;
      settled = true;
      if (signal !== undefined) signal.removeEventListener("abort", onAbort);
      fn(value);
    }

    if (signal !== undefined) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    child.on("error", (/** @type {NodeJS.ErrnoException} */ error) => {
      const hint = error.code === "ENOENT"
        ? `${spec.label} CLI not found on PATH. Install it or pick the other agent.`
        : error.message;
      finish(reject, new Error(hint));
    });

    child.on("close", async (code) => {
      if (settled) return;
      if (code !== 0) {
        const detail = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
        finish(reject, new Error(`${spec.label} exited with code ${code}${detail ? `: ${detail}` : ""}`));
        return;
      }
      // Missing is normal for agents that reply on stdout; only codex writes it.
      let outputFileContents = "";
      try {
        outputFileContents = await readFile(outputFile, "utf8");
      } catch { /* falls through to the stdout path */ }
      try {
        const text = spec.extractText(stdout, outputFileContents);
        if (text.trim() === "") {
          // Exit 0 with nothing to show means the reply went somewhere we are
          // not looking. Say so instead of reporting zero enriched files.
          const detail = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
          throw new Error(`no reply text captured${detail ? ` (stderr: ${detail})` : ""}`);
        }
        finish(resolve, extractJsonArray(text));
      } catch (error) {
        finish(reject, new Error(`Could not parse ${spec.label} reply: ${error instanceof Error ? error.message : String(error)}`));
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });

  // Batches run in a loop, so leaking temp files per batch would add up.
  return run.finally(() => Promise.all([
    rm(outputFile, { force: true }).catch(() => {}),
    rm(schemaFile, { force: true }).catch(() => {}),
  ]));
}

/**
 * Enriches the given entries in batches, reporting progress per batch.
 *
 * Partial results are kept: if batch 3 of 5 fails, the first two batches are
 * still applied and the error is reported alongside them. Re-running then only
 * needs to cover what is still unenriched.
 *
 * @param {object} options
 * @param {string} options.repoRoot
 * @param {Array<any>} options.entries
 * @param {string[]} options.filePaths
 * @param {string} options.agent
 * @param {string} [options.model]
 * @param {AbortSignal} [options.signal]
 * @param {(progress: { completed: number; total: number; phase: string }) => void} [options.onProgress]
 * @returns {Promise<{ entries: Array<any>; enriched: number; failed: string[]; error?: string }>}
 */
async function enrichEntries({ repoRoot, entries, filePaths, agent, model, signal, onProgress }) {
  const spec = AGENTS[agent];
  if (spec === undefined) throw new Error(`Unknown discovery agent: ${agent}`);
  const chosenModel = model ?? spec.defaultModel;

  const targets = filePaths.filter((p) => entries.some((e) => e.filePath === p));
  /** @type {string[][]} */
  const batches = [];
  for (let i = 0; i < targets.length; i += BATCH_SIZE) batches.push(targets.slice(i, i + BATCH_SIZE));

  const byPath = new Map(entries.map((e) => [e.filePath, { ...e }]));
  /** @type {string[]} */
  const failed = [];
  let enriched = 0;
  /** @type {string|undefined} */
  let error;

  for (const [index, batch] of batches.entries()) {
    if (signal?.aborted === true) { error = "cancelled"; break; }
    onProgress?.({ completed: index, total: batches.length, phase: `Enriching ${batch.length} files with ${spec.label}` });

    let results;
    try {
      const prompt = await buildPrompt(repoRoot, batch, { schemaEnforced: spec.schemaEnforced === true });
      results = await runAgentBatch({ agent, model: chosenModel, prompt, cwd: repoRoot, signal });
    } catch (batchError) {
      const message = batchError instanceof Error ? batchError.message : String(batchError);
      if (message === "cancelled") { error = "cancelled"; break; }
      // Keep going: one bad batch should not discard the batches that worked.
      failed.push(...batch);
      error = message;
      continue;
    }

    for (const result of results) {
      const target = typeof result.path === "string" ? result.path : "";
      const entry = byPath.get(target);
      if (entry === undefined) continue;
      if (typeof result.purpose === "string" && result.purpose.trim() !== "") {
        entry.purpose = result.purpose.trim();
        entry.confidence = "high";
        entry.discoveredBy = `${agent}:${chosenModel}`;
        entry.lastDiscovered = new Date().toISOString();
        entry.enriched = true;
        enriched += 1;
      }
      if (Array.isArray(result.features)) {
        const extra = result.features.filter((f) => typeof f === "string" && f.trim() !== "");
        if (extra.length > 0) entry.features = [...new Set([...entry.features, ...extra])];
      }
    }
  }

  onProgress?.({ completed: batches.length, total: batches.length, phase: "Enrichment complete" });

  /** @type {{ entries: Array<any>; enriched: number; failed: string[]; error?: string }} */
  const out = { entries: [...byPath.values()], enriched, failed };
  if (error !== undefined) out.error = error;
  return out;
}

module.exports = {
  AGENTS,
  BATCH_SIZE,
  EXCERPT_CHARS,
  MODEL_RATES,
  REPLY_SCHEMA,
  buildPrompt,
  describeAgent,
  enrichEntries,
  estimateEnrichmentCost,
  extractJsonArray,
  listAgents,
  runAgentBatch,
};
