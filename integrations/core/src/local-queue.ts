import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { CheckpointInput } from "./protocol.js";

export interface QueuedCheckpoint {
  idempotencyKey: string;
  createdAt: string;
  attempts: number;
  checkpoint: CheckpointInput;
}

export interface LocalQueue {
  checkpoints: QueuedCheckpoint[];
  schemaVersion: 1;
}

export function emptyLocalQueue(): LocalQueue {
  return { schemaVersion: 1, checkpoints: [] };
}

export function readLocalQueue(path: string): LocalQueue {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LocalQueue>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.checkpoints)) return emptyLocalQueue();
    return { schemaVersion: 1, checkpoints: parsed.checkpoints };
  } catch {
    return emptyLocalQueue();
  }
}

export function writeLocalQueue(path: string, queue: LocalQueue): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(queue, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

export function enqueueCheckpoint(path: string, checkpoint: CheckpointInput): LocalQueue {
  const queue = readLocalQueue(path);
  if (queue.checkpoints.some((item) => item.idempotencyKey === checkpoint.idempotencyKey)) {
    return queue;
  }

  const nextQueue: LocalQueue = {
    schemaVersion: 1,
    checkpoints: [
      ...queue.checkpoints,
      {
        idempotencyKey: checkpoint.idempotencyKey,
        createdAt: checkpoint.createdAt,
        attempts: 0,
        checkpoint,
      },
    ],
  };
  writeLocalQueue(path, nextQueue);
  return nextQueue;
}

export function defaultQueuePath(dataDirectory: string): string {
  return join(dataDirectory, "queue.json");
}
