export class AcceptanceFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AcceptanceFailure";
  }
}

export function acceptanceError(reason: unknown): { code: string; message: string } {
  if (reason instanceof AcceptanceFailure) return { code: reason.code, message: reason.message };
  if (reason instanceof Error) return { code: "acceptance_failed", message: reason.message };
  return { code: "acceptance_failed", message: String(reason) };
}
