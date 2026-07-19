import { buildServer } from "./server.js";

const server = await buildServer({ logger: true });

await server.listen({
  host: process.env.API_HOST ?? "127.0.0.1",
  port: Number(process.env.API_PORT ?? 3100),
});
