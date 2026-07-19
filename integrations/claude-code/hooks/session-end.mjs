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
    const core = await import("../../core/dist/src/index.js");
    const repository = core.detectRepositoryIdentity(process.cwd());
    const config = core.loadIntegrationConfig(core.defaultConfigPath());
    const link = config.repositories[repository.root];
    if (config.enabled && link?.enabled) {
      const checkpoint = core.checkpointFromSessionEndInput(parsedInput, "claude-code", link.boardId);
      checkpoint.repository = repository;
      core.appendCheckpointToLocalWorkspace(config.localWorkspacePath ?? core.defaultLocalWorkspacePath(), checkpoint);
    }
  } catch {}
});
