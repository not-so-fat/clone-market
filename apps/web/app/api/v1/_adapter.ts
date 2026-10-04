import type { ApiRequest, ApiResponse } from "../../../src/http.js";

export async function json(request: Request, operation: (input: ApiRequest) => Promise<ApiResponse>, params: Record<string, string> = {}) {
  const url = new URL(request.url);
  const body = request.method === "GET" ? undefined : await request.json().catch(() => undefined);
  const result = await operation({ params, query: Object.fromEntries(url.searchParams), body });
  return Response.json(result.body, { status: result.status });
}
