import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
export function emptyLocalQueue() {
    return { schemaVersion: 1, checkpoints: [] };
}
export function readLocalQueue(path) {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.checkpoints))
            return emptyLocalQueue();
        return { schemaVersion: 1, checkpoints: parsed.checkpoints };
    }
    catch {
        return emptyLocalQueue();
    }
}
export function writeLocalQueue(path, queue) {
    mkdirSync(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(queue, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, path);
}
export function enqueueCheckpoint(path, checkpoint) {
    const queue = readLocalQueue(path);
    if (queue.checkpoints.some((item) => item.idempotencyKey === checkpoint.idempotencyKey)) {
        return queue;
    }
    const nextQueue = {
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
export function defaultQueuePath(dataDirectory) {
    return join(dataDirectory, "queue.json");
}
