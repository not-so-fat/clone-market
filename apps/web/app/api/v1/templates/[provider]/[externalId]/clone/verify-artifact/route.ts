import { createV1Handlers } from "../../../../../../../../src/http";
import { marketService } from "../../../../../../../../src/runtime";
import { json } from "../../../../../_adapter";

export const POST = async (request: Request, context: { params: Promise<{ provider: string; externalId: string }> }) => json(request, createV1Handlers(await marketService()).verifyArtifact, await context.params);
