import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../src/server.js";

import type { FastifyInstance } from "fastify";

let server: FastifyInstance | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("Relay API", () => {
  it("reports health", async () => {
    server = await buildServer();
    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "relay-api" });
  });

  it("creates a board idempotently and reads its activity", async () => {
    server = await buildServer();
    const request = {
      method: "POST" as const,
      url: "/v1/boards",
      headers: { "idempotency-key": "board-1" },
      payload: { directoryId: "directory-1", name: "Relay API" },
    };

    const first = await server.inject(request);
    const second = await server.inject(request);
    const boardId = first.json<{ data: { id: string } }>().data.id;
    const state = await server.inject({ method: "GET", url: `/v1/boards/${boardId}` });

    expect(first.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(state.json<{ data: { activity: unknown[] } }>().data.activity).toHaveLength(1);
  });

  it("returns a typed validation error", async () => {
    server = await buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/v1/boards",
      headers: { "idempotency-key": "invalid" },
      payload: { directoryId: "directory-1", name: "" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      "RELAY_VALIDATION_FAILED",
    );
  });
});
