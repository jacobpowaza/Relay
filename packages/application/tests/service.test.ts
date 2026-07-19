import { describe, expect, it } from "vitest";

import { MemoryRelayStore, RelayApplicationError, RelayService } from "../src/index.js";
import type { ApplicationActor } from "../src/index.js";

const actor: ApplicationActor = {
  id: "user-1",
  name: "Jacob",
  type: "human",
  workspaceId: "workspace-1",
};

describe("RelayService", () => {
  it("creates a board and activity atomically", () => {
    const store = new MemoryRelayStore();
    const service = new RelayService(store);

    const board = service.createBoard(actor, {
      directoryId: "directory-1",
      name: "Platform hardening",
      description: "Secure the platform",
    }, "create-board-1");

    const state = store.read();
    expect(state.boards).toHaveLength(1);
    expect(state.activity[0]).toMatchObject({ boardId: board.id, action: "board.created" });
  });

  it("returns the original board for a repeated idempotency key", () => {
    const service = new RelayService(new MemoryRelayStore());
    const input = { directoryId: "directory-1", name: "Relay", description: "" };

    const first = service.createBoard(actor, input, "same-key");
    const second = service.createBoard(actor, input, "same-key");

    expect(second).toEqual(first);
    expect(service.listBoards(actor)).toHaveLength(1);
  });

  it("rejects a stale card move without changing state", () => {
    const store = new MemoryRelayStore();
    const service = new RelayService(store);
    const board = service.createBoard(actor, { directoryId: "directory-1", name: "Relay" }, "board");
    const card = service.createCard(actor, { boardId: board.id, columnId: "ready", title: "Build API" }, "card");

    service.moveCard(actor, { cardId: card.id, columnId: "progress", expectedVersion: 1 });

    expect(() => service.moveCard(actor, {
      cardId: card.id,
      columnId: "verified",
      expectedVersion: 1,
    })).toThrowError(RelayApplicationError);
    expect(service.getBoardState(actor, board.id).cards[0]?.columnId).toBe("progress");
  });

  it("does not leak boards across workspaces", () => {
    const service = new RelayService(new MemoryRelayStore());
    service.createBoard(actor, { directoryId: "directory-1", name: "Private" }, "board");

    expect(service.listBoards({ ...actor, id: "user-2", workspaceId: "workspace-2" })).toEqual([]);
  });
});
