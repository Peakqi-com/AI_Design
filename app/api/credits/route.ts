import { NextResponse } from "next/server";
import { resolveServerUserScopeId } from "@/lib/server/user-scope";
import {
  getUserCredits,
  deductCredits,
  setUserPlan,
  addCredits,
  listAllUsers,
  isAdminEmail,
  CREDIT_COSTS,
  PLAN_INFO,
  type UserPlan,
} from "@/lib/credits/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/credits?userId=xxx
 *   → { credits, plan, totalUsed, ... }
 *
 * GET /api/credits?admin=1&email=admin@...
 *   → { users: [...], planInfo, creditCosts }
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedUserId = url.searchParams.get("userId")?.trim() || "";
  const adminMode = url.searchParams.get("admin") === "1";
  const adminEmail = url.searchParams.get("email")?.trim() || "";

  if (adminMode) {
    if (!isAdminEmail(adminEmail)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    try {
      const users = await listAllUsers();
      return NextResponse.json({ users, planInfo: PLAN_INFO, creditCosts: CREDIT_COSTS });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to list users" },
        { status: 500 },
      );
    }
  }

  const userId = await resolveServerUserScopeId(requestedUserId);
  const profileEmail = url.searchParams.get("email")?.trim() || undefined;
  const profileName = url.searchParams.get("name")?.trim() || undefined;
  const profileAvatar = url.searchParams.get("avatar")?.trim() || undefined;
  try {
    const record = await getUserCredits(userId, {
      email: profileEmail,
      name: profileName,
      avatarUrl: profileAvatar,
    });
    return NextResponse.json(record);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get credits" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/credits
 * Body: { userId, action } → deduct credits
 * Body: { userId, action: "set-plan", plan, credits?, email } → admin: set plan
 * Body: { userId, action: "add-credits", amount, email } → admin: add credits
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = await resolveServerUserScopeId(String(body.userId || ""));
  const action = String(body.action || "");

  // Admin actions
  if (action === "set-plan") {
    const email = String(body.email || "");
    if (!isAdminEmail(email)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const targetUserId = String(body.targetUserId || userId);
    const plan = String(body.plan || "free") as UserPlan;
    const customCredits = typeof body.credits === "number" ? body.credits : undefined;
    try {
      const record = await setUserPlan(targetUserId, plan, customCredits);
      return NextResponse.json(record);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed" },
        { status: 500 },
      );
    }
  }

  if (action === "add-credits") {
    const email = String(body.email || "");
    if (!isAdminEmail(email)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const targetUserId = String(body.targetUserId || userId);
    const amount = Number(body.amount || 0);
    try {
      const record = await addCredits(targetUserId, amount);
      return NextResponse.json(record);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed" },
        { status: 500 },
      );
    }
  }

  // Normal deduction
  if (!action || !CREDIT_COSTS[action]) {
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  try {
    const result = await deductCredits(userId, action);
    if (!result.success) {
      return NextResponse.json({ error: result.error, ...result }, { status: 402 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Deduction failed" },
      { status: 500 },
    );
  }
}
