import { createV1Handlers } from "../../../../../../../../src/http.js";
import { marketService } from "../../../../../../../../src/runtime.js";
import { json } from "../../../../../_adapter.js";

export const POST = (request: Request, context: { params: Promise<{ provider: string; externalId: string }> }) => context.params.then((params) => json(request, createV1Handlers(marketService()).preview, params));
