import { NextResponse } from "next/server";
import { generateSocialImageByNanobanana } from "@/lib/ai/social-image";
import {
  consumeCreditWallet,
  refundCreditWallet,
  resolveCreditGateContext,
} from "@/lib/billing/credit-wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GenerateSocialImageBody = {
  userId?: string;
  imageDataUrl?: string;
  prompt?: string;
  style?: string;
};

export async function POST(request: Request) {
  let body: GenerateSocialImageBody;
  try {
    body = (await request.json()) as GenerateSocialImageBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const imageDataUrl = body.imageDataUrl?.trim() || "";
  const prompt = body.prompt?.trim() || "";
  const style = body.style?.trim() || "";
  if (!imageDataUrl || !prompt) {
    return NextResponse.json({ error: "imageDataUrl and prompt are required." }, { status: 400 });
  }

  const startedAt = Date.now();
  const creditContext = await resolveCreditGateContext(body.userId?.trim());
  const chargeResult = await consumeCreditWallet({
    context: creditContext,
    cost: creditContext.imageCost,
    action: "social-image",
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
    const result = await generateSocialImageByNanobanana({
      imageDataUrl,
      prompt,
      style,
    });
    return NextResponse.json({
      imageDataUrl: result.imageDataUrl,
      summary: result.summary,
      model: result.model,
      elapsedMs: Date.now() - startedAt,
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
    const message = error instanceof Error ? error.message : "Generate social image failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
