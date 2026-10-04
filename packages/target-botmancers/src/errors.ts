export class BotmancersError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BotmancersError";
    this.code = code;
  }
}

export class BotmancersHttpError extends BotmancersError {
  readonly status?: number;
  readonly attempts: number;
  readonly retryable: boolean;

  constructor(input: { status?: number; attempts: number; retryable: boolean; cause?: unknown }) {
    super(
      "botmancers_http_error",
      `Botmancers request failed after ${input.attempts} attempt(s)${input.status === undefined ? "" : ` with status ${input.status}`}`,
      { cause: input.cause },
    );
    this.name = "BotmancersHttpError";
    this.attempts = input.attempts;
    this.retryable = input.retryable;
    if (input.status !== undefined) this.status = input.status;
  }
}

export class BotmancersResponseError extends BotmancersError {
  constructor(message: string) {
    super("invalid_botmancers_response", message);
    this.name = "BotmancersResponseError";
  }
}

export class CapabilityVersionError extends BotmancersError {
  readonly receivedVersion: string | null;

  constructor(receivedVersion: string | null) {
    super("unsupported_capability_version", `Unsupported Botmancers capability version ${receivedVersion ?? "<missing>"}`);
    this.name = "CapabilityVersionError";
    this.receivedVersion = receivedVersion;
  }
}

export class PlanApprovalError extends BotmancersError {
  constructor(code: "missing_plan_digest" | "changed_plan_digest" | "unsafe_plan" | "partial_plan" | "invalid_plan", message: string) {
    super(code, message);
    this.name = "PlanApprovalError";
  }
}

export class OperationIdentityError extends BotmancersError {
  constructor() {
    super("invalid_operation_identity", "Botmancers apply and verify require a valid operation ID and idempotency key");
    this.name = "OperationIdentityError";
  }
}
