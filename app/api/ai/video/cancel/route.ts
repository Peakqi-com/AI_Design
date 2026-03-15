import { NextResponse } from "next/server";
import { cancelVeoOperation, isReplicateCredentialErrorMessage } from "@/lib/ai/veo-video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CancelBody = {
  operationName?: string;
};

export async function POST(request: Request) {
  let body: CancelBody;
  try {
    body = (await request.json()) as CancelBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const operationName = body.operationName?.trim();
  if (!operationName) {
    return NextResponse.json({ error: "operationName is required." }, { status: 400 });
  }

  try {
    const result = await cancelVeoOperation(operationName);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "取消影片生成失敗。";
    const statusCode = isReplicateCredentialErrorMessage(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
