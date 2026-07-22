import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const enrichment = require("../src/enrichment.cjs");

const { AGENTS, REPLY_SCHEMA, estimateEnrichmentCost, extractJsonArray } = enrichment;

describe("extractJsonArray", () => {
  // Codex is constrained by --output-schema, whose root MUST be an object, so
  // its replies arrive wrapped. Claude has no such constraint and replies with
  // a bare array. Both shapes are live-observed, not hypothetical.
  it("unwraps the schema-enforced {files:[...]} envelope codex returns", () => {
    const reply = '{"files":[{"path":"a.js","purpose":"Adds numbers","features":[]}]}';
    expect(extractJsonArray(reply)).toEqual([{ path: "a.js", purpose: "Adds numbers", features: [] }]);
  });

  it("accepts the bare array claude returns", () => {
    expect(extractJsonArray('[{"path":"b.js"}]')).toEqual([{ path: "b.js" }]);
  });

  it("salvages an array wrapped in prose and a code fence", () => {
    const reply = 'Sure, here you go:\n```json\n[{"path":"c.js"}]\n```\nHope that helps!';
    expect(extractJsonArray(reply)).toEqual([{ path: "c.js" }]);
  });

  it("does not stop at a ] that appears inside a string", () => {
    const reply = '[{"path":"d.js","purpose":"Handles arr[0] indexing"}]';
    expect(extractJsonArray(reply)).toEqual([{ path: "d.js", purpose: "Handles arr[0] indexing" }]);
  });

  it("throws rather than returning nothing when there is no array at all", () => {
    expect(() => extractJsonArray("I could not do that.")).toThrow(/no JSON array/i);
  });

  it("throws on an unterminated array instead of silently truncating results", () => {
    expect(() => extractJsonArray('[{"path":"e.js"}')).toThrow(/unterminated/i);
  });
});

describe("REPLY_SCHEMA", () => {
  // Both of these were learned from live 400s. If either regresses, codex
  // rejects every batch at the API and enrichment silently produces nothing.
  it("uses an object root, because an array root is rejected outright", () => {
    expect(REPLY_SCHEMA.type).toBe("object");
  });

  it("marks every declared property required, as strict mode demands", () => {
    const item = REPLY_SCHEMA.properties.files.items;
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
  });
});

describe("estimateEnrichmentCost", () => {
  const sizes = (count: number, size: number) => Array.from({ length: count }, () => size);

  it("bills each file at its real size, not at the excerpt cap", () => {
    const small = estimateEnrichmentCost({ agent: "claude", fileSizes: sizes(30, 200) });
    const large = estimateEnrichmentCost({ agent: "claude", fileSizes: sizes(30, 40_000) });
    // Same file count and batch count, so any difference is excerpt size alone.
    expect(small.batches).toBe(large.batches);
    expect(small.inputTokens).toBeLessThan(large.inputTokens);
  });

  it("caps a huge file at the excerpt limit rather than charging for the whole thing", () => {
    const capped = estimateEnrichmentCost({ agent: "claude", fileSizes: [10_000_000] });
    const atCap = estimateEnrichmentCost({ agent: "claude", fileSizes: [enrichment.EXCERPT_CHARS] });
    expect(capped.inputTokens).toBe(atCap.inputTokens);
  });

  it("charges the fixed per-spawn overhead once per batch", () => {
    const oneBatch = estimateEnrichmentCost({ agent: "claude", fileSizes: sizes(enrichment.BATCH_SIZE, 100) });
    const twoBatches = estimateEnrichmentCost({ agent: "claude", fileSizes: sizes(enrichment.BATCH_SIZE + 1, 100) });
    expect(oneBatch.batches).toBe(1);
    expect(twoBatches.batches).toBe(2);
    // The jump from one batch to two must be dominated by a second overhead
    // charge, not by the single extra file's excerpt.
    expect(twoBatches.inputTokens - oneBatch.inputTokens).toBeGreaterThan(5000);
  });

  it("returns a null cost for codex rather than inventing a per-token price", () => {
    const estimate = estimateEnrichmentCost({ agent: "codex", fileSizes: sizes(10, 1000) });
    expect(estimate.costUsd).toBeNull();
    expect(estimate.inputTokens).toBeGreaterThan(0);
  });

  it("prices a known claude model, and scales with the model's rate", () => {
    const haiku = estimateEnrichmentCost({ agent: "claude", model: "claude-haiku-4-5-20251001", fileSizes: sizes(30, 1600) });
    const opus = estimateEnrichmentCost({ agent: "claude", model: "claude-opus-4-8", fileSizes: sizes(30, 1600) });
    expect(haiku.costUsd).toBeGreaterThan(0);
    expect(opus.costUsd).toBeGreaterThan(haiku.costUsd as number);
  });

  it("returns a null cost for an unknown model instead of guessing", () => {
    const estimate = estimateEnrichmentCost({ agent: "claude", model: "some-unreleased-model", fileSizes: sizes(5, 500) });
    expect(estimate.costUsd).toBeNull();
  });

  it("reports zero work for an empty candidate set", () => {
    const estimate = estimateEnrichmentCost({ agent: "claude", fileSizes: [] });
    expect(estimate.files).toBe(0);
    expect(estimate.batches).toBe(0);
    expect(estimate.inputTokens).toBe(0);
  });

  it("rejects an unknown agent", () => {
    expect(() => estimateEnrichmentCost({ agent: "gemini", fileSizes: [] })).toThrow(/Unknown discovery agent/);
  });
});

describe("agent argv", () => {
  it("omits -m for codex, because a ChatGPT account rejects every explicit id", () => {
    const args = AGENTS.codex.buildArgs("", "/tmp/out.txt", "/tmp/schema.json");
    expect(args).not.toContain("-m");
    expect(args).toContain("--output-schema");
    expect(args).toContain("/tmp/schema.json");
    // -o is how the reply is recovered at all: codex leaves stdout empty.
    expect(args).toContain("-o");
    expect(args).toContain("/tmp/out.txt");
  });

  it("passes a model through for codex when one is explicitly configured", () => {
    expect(AGENTS.codex.buildArgs("some-model", "/tmp/o", "/tmp/s")).toContain("-m");
  });

  it("keeps claude's context trim flags, which cut cost per batch by ~73%", () => {
    const args = AGENTS.claude.buildArgs("claude-haiku-4-5-20251001", "/tmp/o", "/tmp/s");
    expect(args).toContain("--setting-sources");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--output-format");
  });

  it("treats a claude error envelope as a failure, not as a summary", () => {
    const envelope = JSON.stringify({ is_error: true, result: "rate limited", subtype: "error" });
    expect(() => AGENTS.claude.extractText(envelope)).toThrow(/reported an error/);
  });
});
