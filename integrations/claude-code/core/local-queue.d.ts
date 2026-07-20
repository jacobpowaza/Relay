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
export declare function emptyLocalQueue(): LocalQueue;
export declare function readLocalQueue(path: string): LocalQueue;
export declare function writeLocalQueue(path: string, queue: LocalQueue): void;
export declare function enqueueCheckpoint(path: string, checkpoint: CheckpointInput): LocalQueue;
export declare function defaultQueuePath(dataDirectory: string): string;
//# sourceMappingURL=local-queue.d.ts.map