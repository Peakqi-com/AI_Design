import { NextResponse } from "next/server";
import {
  getCreditWalletBalance,
  resolveCreditGateContext,
} from "@/lib/billing/credit-wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedUserId = url.searchParams.get("userId")?.trim() || "";

  try {
    const context = await resolveCreditGateContext(requestedUserId);
    const remainingCredits = await getCreditWalletBalance(context);
    return NextResponse.json({
      userId: context.userId,
      remainingCredits,
      shouldEnforce: context.shouldEnforce,
      plan: context.plan,
      authProvider: context.authProvider,
      initialCredits: context.initialCredits,
      costs: {
        image: context.imageCost,
        video: context.videoCost,
      },
      upgradeMessage: context.upgradeMessage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "讀取點數資訊失敗。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
