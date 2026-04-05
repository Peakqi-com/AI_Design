import { NextResponse } from "next/server";
import {
  isReplicateCredentialErrorMessage,
  VeoStartError,
  startVeoImageToVideo,
} from "@/lib/ai/veo-video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GenerateBody = {
  imageDataUrl?: string;
  lastFrameImageDataUrl?: string;
  prompt?: string;
  model?: string;
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "4:5";
  resolution?: "720p" | "1080p";
  durationSec?: number;
  negativePrompt?: string;
  mode?: "image-to-video" | "text-to-video" | "first-last-frame";
};

export async function POST(request: Request) {
  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const imageDataUrl = body.imageDataUrl?.trim();
  const lastFrameImageDataUrl = body.lastFrameImageDataUrl?.trim();
  const prompt = body.prompt?.trim();
  const mode = body.mode || (imageDataUrl ? "image-to-video" : "text-to-video");

  if (mode !== "text-to-video" && !imageDataUrl) {
    return NextResponse.json({ error: "imageDataUrl is required." }, { status: 400 });
  }
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required." }, { status: 400 });
  }

  try {
    const result = await startVeoImageToVideo({
      imageDataUrl: imageDataUrl || undefined,
      lastFrameImageDataUrl: mode === "first-last-frame" ? lastFrameImageDataUrl : undefined,
      prompt,
      model: body.model,
      aspectRatio: body.aspectRatio,
      resolution: body.resolution,
      durationSec: body.durationSec,
      negativePrompt: body.negativePrompt,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof VeoStartError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          hints: error.hints || [],
          supportSummary: error.supportSummary || "",
        },
        { status: error.statusCode },
      );
    }
    const message = error instanceof Error ? error.message : "啟動影片生成失敗。";
    const status = isReplicateCredentialErrorMessage(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
