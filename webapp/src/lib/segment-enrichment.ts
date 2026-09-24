import { enrichSegmentInput, type RegenerateRequest } from "../../convex/lib/segmentEnrichment";

// The development-only workshop supplies its own experimental key.
export async function enrichSegment(request: Request): Promise<Response> {
  const apiKey = request.headers.get("x-openai-api-key")?.trim() || "";
  const input = await request.json().catch(() => null) as RegenerateRequest | null;
  return enrichSegmentInput(input, apiKey);
}
