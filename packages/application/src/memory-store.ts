import type { RelayState, RelayStore } from "./types.js";

export class MemoryRelayStore implements RelayStore {
  readonly #idempotency = new Map<string, unknown>();
  #state: RelayState;

  constructor(initialState: RelayState = { boards: [], cards: [], activity: [] }) {
    this.#state = structuredClone(initialState);
  }

  read(): Readonly<RelayState> {
    return structuredClone(this.#state);
  }

  transact<T>(operation: (state: RelayState) => T): T {
    const draft = structuredClone(this.#state);
    const result = operation(draft);
    this.#state = draft;
    return result;
  }

  getIdempotent<T>(key: string): T | undefined {
    return structuredClone(this.#idempotency.get(key)) as T | undefined;
  }

  saveIdempotent<T>(key: string, value: T): void {
    this.#idempotency.set(key, structuredClone(value));
  }
}
