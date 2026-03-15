import { NextResponse } from "next/server";
import { isGoogleAiCredentialErrorMessage } from "@/lib/ai/google-provider";
import { generatePanoramaRender } from "@/lib/ai/interior-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PanoramaBody = {
  imageDataUrl?: string;
  style?: string;
  customPrompt?: string;
  preferredModel?: string;
};

export async function POST(request: Request) {
  let body: PanoramaBody;
  try {
    body = (await request.json()) as PanoramaBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const imageDataUrl = body.imageDataUrl?.trim();
  const style = body.style?.trim() || undefined;
  const customPrompt = body.customPrompt?.trim() || undefined;
  const preferredModel = body.preferredModel?.trim() || undefined;

  if (!imageDataUrl) {
    return NextResponse.json({ error: "imageDataUrl is required." }, { status: 400 });
  }

  const startedAt = Date.now();
  try {
    const result = await generatePanoramaRender({
      imageDataUrl,
      style,
      customPrompt,
      preferredModel,
    });

    return NextResponse.json({
      imageDataUrl: result.imageDataUrl,
      summary: result.summary,
      model: result.model,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 室內場景延展發生未知錯誤。";
    const status = isGoogleAiCredentialErrorMessage(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
