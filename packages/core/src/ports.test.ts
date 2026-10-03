import { describe, expectTypeOf, it } from "vitest";

import type {
  ApplyResult,
  ClonePlan,
  OperationIdentity,
  PreviewResult,
  TargetAdapter,
  VerifyResult,
} from "./index.js";

declare const adapter: TargetAdapter;
declare const plan: ClonePlan;
declare const operation: OperationIdentity;

describe("target port operation contracts", () => {
  it("keeps preview read-only and requires identities for retryable operations", () => {
    expectTypeOf<TargetAdapter["preview"]>().returns.toEqualTypeOf<Promise<PreviewResult>>();
    expectTypeOf<TargetAdapter["apply"]>().returns.toEqualTypeOf<Promise<ApplyResult>>();
    expectTypeOf<TargetAdapter["verify"]>().returns.toEqualTypeOf<Promise<VerifyResult>>();

    if (false) {
      // @ts-expect-error apply requires an operation ID and idempotency key
      adapter.apply(plan);
      // @ts-expect-error verify requires an operation ID and idempotency key
      adapter.verify({ plan, targetReference: "target-1" });
      adapter.apply(plan, operation);
    }
  });
});
