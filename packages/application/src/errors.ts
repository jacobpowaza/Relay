export class RelayApplicationError extends Error {
  constructor(
    readonly code:
      | "RELAY_CONFLICT"
      | "RELAY_FORBIDDEN"
      | "RELAY_NOT_FOUND"
      | "RELAY_VALIDATION_FAILED",
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "RelayApplicationError";
  }
}
