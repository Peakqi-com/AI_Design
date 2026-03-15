import { NextResponse } from "next/server";
import { isGoogleAiCredentialErrorMessage } from "@/lib/ai/google-provider";
import { refineInteriorRender } from "@/lib/ai/interior-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RefineBody = {
  imageDataUrl?: string;
  sourceIdentityImageDataUrl?: string;
  lockFace?: boolean;
  roomType?: string;
  style?: string;
  preferredModel?: string;
};

export async function POST(request: Request) {
  let body: RefineBody;
  try {
    body = (await request.json()) as RefineBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const imageDataUrl = body.imageDataUrl?.trim();
  const sourceIdentityImageDataUrl = body.sourceIdentityImageDataUrl?.trim() || undefined;
  const lockFace = body.lockFace !== false;
  const roomType = body.roomType?.trim() || undefined;
  const style = body.style?.trim() || undefined;
  const preferredModel = body.preferredModel?.trim() || undefined;

  if (!imageDataUrl) {
    return NextResponse.json({ error: "imageDataUrl is required." }, { status: 400 });
  }

  const startedAt = Date.now();
  try {
    const result = await refineInteriorRender({
      imageDataUrl,
      sourceIdentityImageDataUrl,
      lockFace,
      roomType,
      style,
      preferredModel,
    });

    return NextResponse.json({
      imageDataUrl: result.imageDataUrl,
      summary: result.summary,
      model: result.model,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 室內細節修復發生未知錯誤。";
    const status = isGoogleAiCredentialErrorMessage(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
