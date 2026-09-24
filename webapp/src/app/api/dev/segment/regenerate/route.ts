import { enrichSegment } from "@/lib/segment-enrichment";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development" && process.env.VERCEL_ENV !== "preview") return Response.json({ error: "Not found" }, { status: 404 });
  return enrichSegment(request);
}
