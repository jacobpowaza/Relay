const { spawn } = require("node:child_process");
const { readFile } = require("node:fs/promises");
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
 * @property {(model: string) => string[]} buildArgs
 * @property {(stdout: string) => string} extractText
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
    buildArgs: (/** @type {string} */ model) => ["-p", "--model", model, "--output-format", "json"],
    // claude --output-format json wraps the reply in an envelope.
    extractText: (/** @type {string} */ stdout) => {
      const parsed = JSON.parse(stdout);
      if (typeof parsed.result === "string") return parsed.result;
      if (typeof parsed.text === "string") return parsed.text;
      throw new Error("Unrecognized claude CLI envelope.");
    },
  },
  codex: {
    label: "Codex",
    command: "codex",
    models: [
      { id: "gpt-5-codex", label: "GPT-5 Codex" },
      { id: "gpt-5", label: "GPT-5" },
      { id: "o3", label: "o3" },
    ],
    defaultModel: "gpt-5-codex",
    buildArgs: (/** @type {string} */ model) => ["exec", "-m", model, "--sandbox", "read-only", "--color", "never"],
    // codex exec streams prose; the JSON block is recovered by extractJsonArray.
    extractText: (/** @type {string} */ stdout) => stdout,
  },
};

/** Files per agent call. Larger batches amortize the prompt but risk truncation. */
const BATCH_SIZE = 12;
/** Chars of each file sent for summarization. Whole files blow the budget fast. */
const EXCERPT_CHARS = 1600;

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
 * @param {string} text
 * @returns {Array<Record<string, unknown>>}
 */
function extractJsonArray(text) {
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
 * @returns {Promise<string>}
 */
async function buildPrompt(repoRoot, filePaths) {
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

  return [
    "You are indexing a codebase for a cached project index.",
    "For each file below, write a one-sentence purpose describing what it actually does in this project.",
    "Be specific: say what this file is responsible for, not what kind of file it is.",
    'Bad: "UI component". Good: "Renders the discovery table and owns row selection state".',
    "",
    "Reply with ONLY a JSON array, no prose and no code fence, shaped:",
    '[{"path":"<exact path as given>","purpose":"<one sentence>","features":["<area>"]}]',
    "",
    sections.join("\n\n"),
  ].join("\n");
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

  return new Promise((resolve, reject) => {
    /** @type {import("node:child_process").ChildProcessWithoutNullStreams} */
    let child;
    try {
      child = spawn(spec.command, spec.buildArgs(model), {
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

    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        const detail = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
        finish(reject, new Error(`${spec.label} exited with code ${code}${detail ? `: ${detail}` : ""}`));
        return;
      }
      try {
        finish(resolve, extractJsonArray(spec.extractText(stdout)));
      } catch (error) {
        finish(reject, new Error(`Could not parse ${spec.label} reply: ${error instanceof Error ? error.message : String(error)}`));
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
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
      const prompt = await buildPrompt(repoRoot, batch);
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
  buildPrompt,
  describeAgent,
  enrichEntries,
  extractJsonArray,
  listAgents,
  runAgentBatch,
};
