import { randomUUID } from "node:crypto";

import {
  createBoardSchema,
  createCardSchema,
  updateCardStatusSchema,
} from "@relay/contracts";

import { RelayApplicationError } from "./errors.js";
import type {
  ApplicationActivity,
  ApplicationActor,
  ApplicationBoard,
  ApplicationCard,
  RelayState,
  RelayStore,
} from "./types.js";

function activity(
  actor: ApplicationActor,
  input: Omit<ApplicationActivity, "actorId" | "actorName" | "actorType" | "id" | "occurredAt" | "workspaceId">,
): ApplicationActivity {
  return {
    id: randomUUID(),
    workspaceId: actor.workspaceId,
    actorId: actor.id,
    actorName: actor.name,
    actorType: actor.type,
    occurredAt: new Date().toISOString(),
    ...input,
  };
}

function assertBoardAccess(board: ApplicationBoard, actor: ApplicationActor): void {
  if (board.workspaceId !== actor.workspaceId) {
    throw new RelayApplicationError("RELAY_FORBIDDEN", "The board is outside the actor's workspace.");
  }
}

function idempotencyScope(actor: ApplicationActor, key: string): string {
  return `${actor.workspaceId}:${actor.id}:${key}`;
}

export class RelayService {
  constructor(private readonly store: RelayStore) {}

  listBoards(actor: ApplicationActor): ApplicationBoard[] {
    return this.store.read().boards.filter((board) => board.workspaceId === actor.workspaceId);
  }

  getBoardState(actor: ApplicationActor, boardId: string): Readonly<RelayState> {
    const state = this.store.read();
    const board = state.boards.find((candidate) => candidate.id === boardId);
    if (board === undefined) throw new RelayApplicationError("RELAY_NOT_FOUND", "Board not found.");
    assertBoardAccess(board, actor);
    return {
      boards: [board],
      cards: state.cards.filter((card) => card.boardId === boardId),
      activity: state.activity.filter((event) => event.boardId === boardId),
    };
  }

  createBoard(
    actor: ApplicationActor,
    rawInput: unknown,
    idempotencyKey: string,
  ): ApplicationBoard {
    const input = createBoardSchema.parse(rawInput);
    const scope = idempotencyScope(actor, idempotencyKey);
    const existing = this.store.getIdempotent<ApplicationBoard>(scope);
    if (existing !== undefined) return existing;

    const now = new Date().toISOString();
    const board: ApplicationBoard = {
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      directoryId: input.directoryId,
      name: input.name,
      description: input.description,
      detailedPlan: input.detailedPlan ?? "",
      ...(input.repositoryUrl === undefined ? {} : { repositoryUrl: input.repositoryUrl }),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    this.store.transact((state) => {
      state.boards.push(board);
      state.activity.push(activity(actor, {
        boardId: board.id,
        action: "board.created",
        targetId: board.id,
        targetType: "board",
        next: { name: board.name, directoryId: board.directoryId },
      }));
    });
    this.store.saveIdempotent(scope, board);
    return board;
  }

  createCard(
    actor: ApplicationActor,
    rawInput: unknown,
    idempotencyKey: string,
  ): ApplicationCard {
    const input = createCardSchema.parse(rawInput);
    const scope = idempotencyScope(actor, idempotencyKey);
    const existing = this.store.getIdempotent<ApplicationCard>(scope);
    if (existing !== undefined) return existing;

    const now = new Date().toISOString();
    const card = this.store.transact((state) => {
      const board = state.boards.find((candidate) => candidate.id === input.boardId);
      if (board === undefined) throw new RelayApplicationError("RELAY_NOT_FOUND", "Board not found.");
      assertBoardAccess(board, actor);

      const created: ApplicationCard = {
        id: randomUUID(),
        boardId: input.boardId,
        columnId: input.columnId,
        title: input.title,
        description: input.description,
        type: input.type,
        priority: input.priority,
        urgency: input.urgency,
        complexity: input.complexity,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      state.cards.push(created);
      state.activity.push(activity(actor, {
        boardId: board.id,
        action: "card.created",
        targetId: created.id,
        targetType: "card",
        next: { title: created.title, columnId: created.columnId },
      }));
      return created;
    });
    this.store.saveIdempotent(scope, card);
    return card;
  }

  moveCard(actor: ApplicationActor, rawInput: unknown): ApplicationCard {
    const input = updateCardStatusSchema.parse(rawInput);
    return this.store.transact((state) => {
      const card = state.cards.find((candidate) => candidate.id === input.cardId);
      if (card === undefined) throw new RelayApplicationError("RELAY_NOT_FOUND", "Card not found.");
      const board = state.boards.find((candidate) => candidate.id === card.boardId);
      if (board === undefined) throw new RelayApplicationError("RELAY_NOT_FOUND", "Board not found.");
      assertBoardAccess(board, actor);
      if (card.version !== input.expectedVersion) {
        throw new RelayApplicationError(
          "RELAY_CONFLICT",
          "The card changed after it was loaded.",
          { currentVersion: card.version, expectedVersion: input.expectedVersion },
        );
      }

      const previousColumnId = card.columnId;
      card.columnId = input.columnId;
      card.version += 1;
      card.updatedAt = new Date().toISOString();
      state.activity.push(activity(actor, {
        boardId: board.id,
        action: "card.moved",
        targetId: card.id,
        targetType: "card",
        previous: { columnId: previousColumnId },
        next: { columnId: card.columnId },
      }));
      return structuredClone(card);
    });
  }
}
