import { NextResponse } from "next/server";
import { listContacts } from "@/lib/crm/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const search = url.searchParams.get("search") ?? undefined;
    const tag = url.searchParams.get("tag") ?? undefined;
    const contacts = await listContacts({ search, tag });
    return NextResponse.json({ contacts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CRM contacts unavailable";
    return NextResponse.json(
      { error: `CRM 暫時忙碌（contacts:list），請稍後重試。${message}` },
      { status: 503 },
    );
  }
}
