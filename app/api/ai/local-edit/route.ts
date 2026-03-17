import { NextResponse } from "next/server";
import { isGoogleAiCredentialErrorMessage } from "@/lib/ai/google-provider";
import { editInteriorRenderRegion } from "@/lib/ai/interior-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LocalEditBody = {
  imageDataUrl?: string;
  regionHintImageDataUrl?: string;
  instruction?: string;
  roomType?: string;
  style?: string;
  preferredModel?: string;
};

export async function POST(request: Request) {
  let body: LocalEditBody;
  try {
    body = (await request.json()) as LocalEditBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const imageDataUrl = body.imageDataUrl?.trim();
  const regionHintImageDataUrl = body.regionHintImageDataUrl?.trim();
  const instruction = body.instruction?.trim();
  const roomType = body.roomType?.trim() || undefined;
  const style = body.style?.trim() || undefined;
  const preferredModel = body.preferredModel?.trim() || undefined;

  if (!imageDataUrl || !regionHintImageDataUrl || !instruction) {
    return NextResponse.json(
      { error: "imageDataUrl, regionHintImageDataUrl, instruction are required." },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  try {
    const result = await editInteriorRenderRegion({
      imageDataUrl,
      regionHintImageDataUrl,
      instruction,
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
    const message = error instanceof Error ? error.message : "AI 局部修改發生未知錯誤。";
    const status = isGoogleAiCredentialErrorMessage(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
