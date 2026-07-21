import { describe, expect, it } from "vitest";

import {
  getServerWorkspaceSnapshot,
  getWorkspaceSnapshot,
  reconcile,
  setWorkspace,
} from "./storage";
import type { RelayWorkspaceData } from "./types";

describe("workspace storage snapshots", () => {
  it("returns a cached client snapshot for useSyncExternalStore", () => {
    setWorkspace({ directories: [], boards: [] });

    const snapshot = getWorkspaceSnapshot();

    expect(getWorkspaceSnapshot()).toBe(snapshot);
    expect(snapshot.settings).toBeDefined();
  });

  it("returns a cached server snapshot for useSyncExternalStore", () => {
    expect(getServerWorkspaceSnapshot()).toBe(getServerWorkspaceSnapshot());
  });

  it("normalizes duplicate note ids so card detail lists have stable keys", () => {
    setWorkspace({
      directories: [],
      boards: [{
        id: "board-1",
        directoryId: "dir-1",
        name: "Board",
        description: "",
        repository: "",
        currentPhase: "Planning",
        progress: 0,
        activeTasks: 0,
        blockers: 0,
        lastActivity: "2026-07-18T00:00:00.000Z",
        owner: "Local User",
        plan: "",
        columns: [],
        cards: [{
          id: "card-1",
          title: "Card",
          description: "",
          columnId: "todo",
          phaseId: "phase-1",
          type: "task",
          priority: "normal",
          tags: [],
          notes: [
            { id: "duplicate", body: "One", author: "Codex", createdAt: "2026-07-18T00:00:00.000Z" },
            { id: "duplicate", body: "Two", author: "Codex", createdAt: "2026-07-18T00:01:00.000Z" },
          ],
          progress: 0,
          criteriaDone: 0,
          criteriaTotal: 0,
          blocked: false,
          owner: "Unassigned",
          updatedAt: "2026-07-18T00:00:00.000Z",
        }],
        phases: [],
        context: [],
        activity: [],
        decisions: [],
      }],
    });

    const notes = getWorkspaceSnapshot().boards[0]?.cards[0]?.notes ?? [];

    expect(notes.map((note) => note.id)).toEqual(["duplicate", "duplicate-1"]);
  });

  it("fills missing plugin-created card fields with controlled safe values", () => {
    setWorkspace({
      directories: [],
      boards: [{
        id: "board-1",
        directoryId: "dir-1",
        name: "Board",
        description: undefined,
        repository: undefined,
        currentPhase: undefined,
        progress: Number.NaN,
        activeTasks: Number.NaN,
        blockers: Number.NaN,
        lastActivity: "bad-date",
        owner: undefined,
        plan: undefined,
        columns: [],
        cards: [{
          id: "card-1",
          title: "Card",
          description: undefined,
          columnId: undefined,
          phaseId: undefined,
          type: "task",
          priority: "normal",
          tags: [],
          notes: [],
          progress: Number.NaN,
          criteriaDone: Number.NaN,
          criteriaTotal: Number.NaN,
          blocked: undefined,
          owner: undefined,
          updatedAt: "bad-date",
        }],
        phases: [],
        context: [],
        activity: [],
        decisions: [],
      }],
    } as unknown as RelayWorkspaceData);

    const board = getWorkspaceSnapshot().boards[0];
    const card = board?.cards[0];

    expect(board?.progress).toBe(0);
    expect(board?.repository).toBe("No repository");
    expect(card).toMatchObject({
      description: "",
      owner: "Unassigned",
      progress: 0,
      criteriaDone: 0,
      criteriaTotal: 0,
      blocked: false,
    });
  });

  it("preserves archived board and card timestamps", () => {
    setWorkspace({
      directories: [],
      boards: [{
        id: "board-1",
        archivedAt: "2026-07-18T12:00:00.000Z",
        directoryId: "dir-1",
        name: "Board",
        description: "",
        repository: "",
        currentPhase: "Planning",
        progress: 0,
        activeTasks: 0,
        blockers: 0,
        lastActivity: "2026-07-18T00:00:00.000Z",
        owner: "Local User",
        plan: "",
        columns: [],
        cards: [{
          id: "card-1",
          archivedAt: "2026-07-18T12:30:00.000Z",
          title: "Card",
          description: "",
          columnId: "ready",
          phaseId: "phase-1",
          type: "task",
          priority: "normal",
          tags: [],
          notes: [],
          progress: 0,
          criteriaDone: 0,
          criteriaTotal: 1,
          blocked: false,
          owner: "Unassigned",
          updatedAt: "2026-07-18T00:00:00.000Z",
        }],
        phases: [],
        context: [],
        activity: [],
        decisions: [],
      }],
    });

    const board = getWorkspaceSnapshot().boards[0];

    expect(board?.archivedAt).toBe("2026-07-18T12:00:00.000Z");
    expect(board?.cards[0]?.archivedAt).toBe("2026-07-18T12:30:00.000Z");
  });
});

describe("reconcile structural sharing", () => {
  it("returns the previous reference when nothing changed", () => {
    const previous = { boards: [{ id: "a", name: "A", cards: [{ id: "c1", title: "One" }] }] };
    const next = structuredClone(previous);
    expect(reconcile(previous, next)).toBe(previous);
  });

  it("only creates new identities along the path that changed", () => {
    const previous = {
      boards: [
        { id: "a", name: "A", cards: [{ id: "c1", title: "One" }, { id: "c2", title: "Two" }] },
        { id: "b", name: "B", cards: [{ id: "c3", title: "Three" }] },
      ],
    };
    const next = structuredClone(previous);
    next.boards[0]!.cards[1]!.title = "Two changed";

    const merged = reconcile(previous, next);

    // The edited card and its ancestors are new; everything else is reused.
    // This is what stops an unrelated card from remounting and dropping its
    // transient UI state on every workspace write.
    expect(merged).not.toBe(previous);
    expect(merged.boards[1]).toBe(previous.boards[1]);
    expect(merged.boards[0]?.cards[0]).toBe(previous.boards[0]?.cards[0]);
    expect(merged.boards[0]?.cards[1]).not.toBe(previous.boards[0]?.cards[1]);
    expect(merged.boards[0]?.cards[1]?.title).toBe("Two changed");
  });

  it("matches array entities by id so reordering preserves references", () => {
    const previous = { cards: [{ id: "c1", title: "One" }, { id: "c2", title: "Two" }] };
    const next = { cards: [{ id: "c2", title: "Two" }, { id: "c1", title: "One" }] };

    const merged = reconcile(previous, next);
    expect(merged.cards[0]).toBe(previous.cards[1]);
    expect(merged.cards[1]).toBe(previous.cards[0]);
  });

  it("keeps sibling references when an item is inserted", () => {
    const previous = { cards: [{ id: "c1", title: "One" }] };
    const next = { cards: [{ id: "c1", title: "One" }, { id: "c2", title: "Two" }] };

    const merged = reconcile(previous, next);
    expect(merged.cards[0]).toBe(previous.cards[0]);
    expect(merged.cards).toHaveLength(2);
  });

  it("handles removals, primitives, nulls and type changes", () => {
    expect(reconcile({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
    expect(reconcile(1, 2)).toBe(2);
    expect(reconcile(null, { a: 1 })).toEqual({ a: 1 });
    expect(reconcile({ a: 1 }, null)).toBeNull();
    expect(reconcile([1, 2], { a: 1 })).toEqual({ a: 1 });
  });
});
