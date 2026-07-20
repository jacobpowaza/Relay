#!/usr/bin/env node
// Vendors the compiled @relay/integration-core into the current integration's
// distributable core/ directory so the plugin is self-contained when deployed.
// Called from each integration package's build script.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ownDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(ownDir, "..", "..");
const coreDist = join(repoRoot, "integrations", "core", "dist", "src");
const integrationRoot = process.cwd();
const target = join(integrationRoot, "core");

if (!existsSync(coreDist)) {
  console.error("ERROR: @relay/integration-core not built. Run `pnpm --filter @relay/integration-core build` first.");
  console.error(`  Expected compiled output at: ${coreDist}`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(coreDist, target, { recursive: true });
console.log(`vendored integration-core (${existsSync(target)}) into ${target}`);
