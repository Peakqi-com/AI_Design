import { NextResponse } from "next/server";
import {
  isReplicateCredentialErrorMessage,
  VeoStartError,
  startVeoImageToVideo,
} from "@/lib/ai/veo-video";
import {
  consumeCreditWallet,
  refundCreditWallet,
  resolveCreditGateContext,
} from "@/lib/billing/credit-wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GenerateBody = {
  userId?: string;
  imageDataUrl?: string;
  prompt?: string;
  model?: string;
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3";
  resolution?: "720p" | "1080p";
  durationSec?: number;
  negativePrompt?: string;
};

export async function POST(request: Request) {
  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const imageDataUrl = body.imageDataUrl?.trim();
  const prompt = body.prompt?.trim();
  if (!imageDataUrl) {
    return NextResponse.json({ error: "imageDataUrl is required for image-to-video mode." }, { status: 400 });
  }
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required." }, { status: 400 });
  }

  const creditContext = await resolveCreditGateContext(body.userId?.trim());
  const chargeResult = await consumeCreditWallet({
    context: creditContext,
    cost: creditContext.videoCost,
    action: "social-video",
  });
  if (!chargeResult.ok) {
    return NextResponse.json(
      {
        error: chargeResult.upgradeMessage,
        code: "INSUFFICIENT_CREDITS",
        remainingCredits: chargeResult.remainingCredits,
        requiredCredits: chargeResult.requiredCredits,
      },
      { status: 402 },
    );
  }

  try {
    const result = await startVeoImageToVideo({
      imageDataUrl,
      prompt,
      model: body.model,
      aspectRatio: body.aspectRatio,
      resolution: body.resolution,
      durationSec: body.durationSec,
      negativePrompt: body.negativePrompt,
    });
    return NextResponse.json({
      ...result,
      remainingCredits:
        Number.isFinite(chargeResult.remainingCredits) ? chargeResult.remainingCredits : null,
      costDeducted:
        Number.isFinite(chargeResult.remainingCredits) && chargeResult.cost > 0 ? chargeResult.cost : 0,
    });
  } catch (error) {
    await refundCreditWallet({
      context: creditContext,
      cost: chargeResult.cost,
    });
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
