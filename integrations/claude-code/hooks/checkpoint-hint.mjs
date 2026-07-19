#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const marker = `${homedir()}/.relay/integrations/last-checkpoint-hint`;
const now = Date.now();
let previous = 0;
if (existsSync(marker)) {
  previous = Number(readFileSync(marker, "utf8")) || 0;
}

if (process.argv[2] === "pre-compact" || now - previous > 20 * 60 * 1000) {
  writeFileSync(marker, String(now), { mode: 0o600 });
  console.error("Relay reminder: checkpoint durable progress if active card changed, files changed materially, tests ran, blocker found, or compaction/session end near.");
}
