import cors from "@fastify/cors";
import {
  MemoryRelayStore,
  RelayApplicationError,
  RelayService,
} from "@relay/application";
import Fastify from "fastify";
import { ZodError } from "zod";

import type { ApplicationActor } from "@relay/application";
import type { FastifyInstance, FastifyRequest } from "fastify";

interface ServerOptions {
  appOrigin?: string;
  logger?: boolean;
  service?: RelayService;
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function actorFromDevelopmentHeaders(request: FastifyRequest): ApplicationActor {
  if (process.env.NODE_ENV === "production") {
    throw new RelayApplicationError(
      "RELAY_FORBIDDEN",
      "Development identity headers are disabled in production.",
    );
  }

  const actorType = header(request, "x-relay-actor-type") === "agent" ? "agent" : "human";
  const agentProvider = header(request, "x-relay-agent-provider")?.trim().toLowerCase();
  const defaultAgentName = agentProvider === "claude" ? "Claude" : agentProvider === "codex" ? "Codex" : "Relay Agent";

  return {
    id: header(request, "x-relay-actor-id") ?? "local-user",
    name: header(request, "x-relay-actor-name") ?? (actorType === "agent" ? defaultAgentName : "Local developer"),
    type: actorType,
    workspaceId: header(request, "x-relay-workspace-id") ?? "local-workspace",
  };
}

function statusForError(error: RelayApplicationError): number {
  if (error.code === "RELAY_CONFLICT") return 409;
  if (error.code === "RELAY_FORBIDDEN") return 403;
  if (error.code === "RELAY_NOT_FOUND") return 404;
  return 400;
}

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const server = Fastify({
    logger: options.logger ?? false,
    genReqId: () => crypto.randomUUID(),
  });
  const service = options.service ?? new RelayService(new MemoryRelayStore());

  await server.register(cors, {
    credentials: true,
    origin: options.appOrigin ?? process.env.APP_ORIGIN ?? "http://localhost:3000",
  });

  server.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "RELAY_VALIDATION_FAILED",
          message: "The request did not match the Relay contract.",
          requestId: request.id,
          details: { issues: error.issues },
        },
      });
    }
    if (error instanceof RelayApplicationError) {
      return reply.status(statusForError(error)).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
    }

    request.log.error(error);
    return reply.status(500).send({
      error: {
        code: "RELAY_INTERNAL_ERROR",
        message: "Relay could not complete the request.",
        requestId: request.id,
      },
    });
  });

  server.get("/health", () => ({ status: "ok", service: "relay-api" }));

  server.get("/v1/boards", (request) => {
    return { data: service.listBoards(actorFromDevelopmentHeaders(request)) };
  });

  server.get<{ Params: { boardId: string } }>("/v1/boards/:boardId", (request) => {
    return { data: service.getBoardState(actorFromDevelopmentHeaders(request), request.params.boardId) };
  });

  server.post("/v1/boards", (request, reply) => {
    const idempotencyKey = header(request, "idempotency-key");
    if (idempotencyKey === undefined || idempotencyKey.trim() === "") {
      throw new RelayApplicationError(
        "RELAY_VALIDATION_FAILED",
        "The Idempotency-Key header is required.",
      );
    }
    const board = service.createBoard(
      actorFromDevelopmentHeaders(request),
      request.body,
      idempotencyKey,
    );
    return reply.status(201).send({ data: board });
  });

  server.post("/v1/cards", (request, reply) => {
    const idempotencyKey = header(request, "idempotency-key");
    if (idempotencyKey === undefined || idempotencyKey.trim() === "") {
      throw new RelayApplicationError(
        "RELAY_VALIDATION_FAILED",
        "The Idempotency-Key header is required.",
      );
    }
    const card = service.createCard(
      actorFromDevelopmentHeaders(request),
      request.body,
      idempotencyKey,
    );
    return reply.status(201).send({ data: card });
  });

  server.patch("/v1/cards/status", (request) => {
    return { data: service.moveCard(actorFromDevelopmentHeaders(request), request.body) };
  });

  return server;
}
