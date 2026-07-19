import { createServer } from "node:net";
import { buildServer } from "./server.js";

const PREFERRED_PORT = Number(process.env.API_PORT ?? 4318);
const MAX_ATTEMPTS = 20;

function canListen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findAvailablePort(host: string, preferred: number): Promise<number> {
  for (let offset = 0; offset < MAX_ATTEMPTS; offset++) {
    const port = preferred + offset;
    if (await canListen(host, port)) return port;
  }
  throw new Error(
    `Relay API could not find an available port from ${preferred} to ${preferred + MAX_ATTEMPTS - 1}.`,
  );
}

const host = process.env.API_HOST ?? "127.0.0.1";
const port = await findAvailablePort(host, PREFERRED_PORT);

const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:4317";

const server = await buildServer({ appOrigin, logger: true });

await server.listen({ host, port });

console.log(`[relay:api] Listening on http://${host}:${port}`);
