import { createV1Handlers } from "../../../../../../src/http";
import { marketService } from "../../../../../../src/runtime";
import { json } from "../../../_adapter";

export const dynamic = "force-dynamic";
export const GET = async (request: Request, context: { params: Promise<{ provider: string; externalId: string }> }) => json(request, createV1Handlers(await marketService()).detail, await context.params);
