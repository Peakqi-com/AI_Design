import { NextResponse } from "next/server";
import {
  getPricingStandards,
  savePricingStandards,
} from "@/lib/crm/store";
import { DEFAULT_PRICING_SEED } from "@/lib/crm/pricing-standards";
import { resolveServerUserScopeId } from "@/lib/server/user-scope";
import { PricingStandardItem } from "@/lib/crm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedUserId = url.searchParams.get("userId")?.trim() || "";
  const userScopeId = await resolveServerUserScopeId(requestedUserId);
  // first read seeds from the default table so new users start populated
  const items = await getPricingStandards(userScopeId, DEFAULT_PRICING_SEED);
  return NextResponse.json({ items });
}

type SaveBody = { userId?: string; items?: PricingStandardItem[] };

export async function PUT(request: Request) {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const requestedUserId = (body.userId || "").trim();
  const userScopeId = await resolveServerUserScopeId(requestedUserId);
  const items = Array.isArray(body.items) ? body.items : [];
  const saved = await savePricingStandards(userScopeId, items);
  return NextResponse.json({ items: saved });
}

/** Reset the user's table back to the default seed. */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const requestedUserId = url.searchParams.get("userId")?.trim() || "";
  const userScopeId = await resolveServerUserScopeId(requestedUserId);
  const seeded: PricingStandardItem[] = DEFAULT_PRICING_SEED.map((s, i) => ({
    ...s,
    id: `price_seed_${i}`,
  }));
  const saved = await savePricingStandards(userScopeId, seeded);
  return NextResponse.json({ items: saved });
}
