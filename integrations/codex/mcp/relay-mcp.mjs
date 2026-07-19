#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const progressScript = join(root, "scripts", "relay-progress.mjs");

let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  readMessages();
});

function readMessages() {
  while (buffer.length > 0) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const header = buffer.slice(0, headerEnd);
      const match = /^Content-Length:\s*(\d+)/im.exec(header);
      if (match === null) {
        buffer = "";
        return;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (buffer.length < start + length) return;
      const body = buffer.slice(start, start + length);
      buffer = buffer.slice(start + length);
      handleBody(body);
      continue;
    }

    const newline = buffer.indexOf("\n");
    if (newline === -1) return;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line !== "") handleBody(line);
  }
}

function handleBody(body) {
  let message;
  try {
    message = JSON.parse(body);
  } catch {
    return;
  }
  if (message.id === undefined) return;

  try {
    if (message.method === "initialize") {
      respond(message.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "relay-codex", version: "0.1.0" },
      });
      return;
    }

    if (message.method === "tools/list") {
      respond(message.id, {
        tools: [
          {
            name: "relay_status",
            description: "Return Relay plugin status, repository identity, linked board summary, and the visible [RELAY] state.",
            inputSchema: {
              type: "object",
              properties: { cwd: { type: "string", description: "Working directory to inspect." } },
            },
          },
          {
            name: "relay_resume",
            description: "Return a bounded resume packet for the linked Relay board in the current repository.",
            inputSchema: {
              type: "object",
              properties: { cwd: { type: "string", description: "Working directory to resume." } },
            },
          },
        ],
      });
      return;
    }

    if (message.method === "tools/call") {
      const name = message.params?.name;
      const args = message.params?.arguments ?? {};
      const command = name === "relay_resume" ? "resume" : name === "relay_status" ? "status" : undefined;
      if (command === undefined) throw new Error(`Unknown Relay tool: ${String(name)}`);
      const output = runProgress(command, typeof args.cwd === "string" ? args.cwd : process.cwd());
      respond(message.id, { content: [{ type: "text", text: output }] });
      return;
    }

    respond(message.id, {});
  } catch (error) {
    respond(message.id, {
      content: [{ type: "text", text: error instanceof Error ? error.message : "Relay MCP command failed." }],
      isError: true,
    });
  }
}

function runProgress(command, cwd) {
  return execFileSync(process.execPath, [progressScript, command, "--cwd", cwd], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5_000,
  }).trim();
}

function respond(id, result) {
  const body = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}
