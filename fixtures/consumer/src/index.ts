import {
  BotTemplateManifestSchema,
  SCHEMA_VERSION,
  type ApplyResult,
  type BotTemplateManifest,
  type ClonePlan,
  type OperationIdentity,
  type PreviewResult,
  type SourceAdapter,
  type SourceIdentity,
  type TargetAdapter,
  type Template,
  type VerifyResult,
} from "@clone-market/core";

export function validateExternalManifest(input: unknown): BotTemplateManifest {
  return BotTemplateManifestSchema.parse(input);
}

export class FixtureSourceAdapter implements SourceAdapter {
  readonly source = "fixture";

  async listTemplates(): Promise<{ templates: Template[] }> {
    return { templates: [] };
  }

  async fetchTemplate(_source: SourceIdentity): Promise<unknown> {
    return {};
  }

  async normalizeTemplate(input: unknown): Promise<BotTemplateManifest> {
    return validateExternalManifest(input);
  }
}

export class FixtureTargetAdapter implements TargetAdapter {
  readonly target = "fixture";

  async preview(plan: ClonePlan): Promise<PreviewResult> {
    return { schemaVersion: SCHEMA_VERSION, planId: plan.id, summary: "Preview", artifacts: [], warnings: [] };
  }

  async apply(_plan: ClonePlan, operation: OperationIdentity): Promise<ApplyResult> {
    return {
      schemaVersion: SCHEMA_VERSION,
      status: "succeeded",
      operationId: operation.operationId,
      targetReference: "fixture-target",
      completedAt: "2026-10-03T12:00:00.000Z",
    };
  }

  async verify(
    input: { plan: ClonePlan; targetReference: string },
    operation: OperationIdentity,
  ): Promise<VerifyResult> {
    return {
      schemaVersion: SCHEMA_VERSION,
      status: "passed",
      operationId: operation.operationId,
      targetReference: input.targetReference,
      checkedAt: "2026-10-03T12:00:00.000Z",
      checks: [],
    };
  }
}
