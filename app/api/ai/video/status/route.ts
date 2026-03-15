import { NextResponse } from "next/server";
import { getVeoOperationStatus, isReplicateCredentialErrorMessage } from "@/lib/ai/veo-video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const operationName = url.searchParams.get("operationName")?.trim();
  if (!operationName) {
    return NextResponse.json({ error: "operationName is required." }, { status: 400 });
  }

  try {
    const status = await getVeoOperationStatus(operationName);
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "讀取影片生成狀態失敗。";
    const statusCode = isReplicateCredentialErrorMessage(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
