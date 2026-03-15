import { NextResponse } from "next/server";
import { ensureCrmContact } from "@/lib/crm/store";
import { ContactStatus } from "@/lib/crm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_SET = new Set<ContactStatus>(["new", "contacted", "proposal", "signed"]);

type EnsureBody = {
  source?: "line" | "manual";
  lineUserId?: string;
  displayName?: string;
  avatarUrl?: string | null;
  email?: string;
  phone?: string;
  status?: ContactStatus;
  tags?: string[];
};

export async function POST(request: Request) {
  try {
    let body: EnsureBody;
    try {
      body = (await request.json()) as EnsureBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const displayName = body.displayName?.trim() || "";
    if (!displayName) {
      return NextResponse.json({ error: "displayName is required." }, { status: 400 });
    }
    if (body.status && !STATUS_SET.has(body.status)) {
      return NextResponse.json({ error: "Unsupported status value." }, { status: 400 });
    }

    const contact = await ensureCrmContact({
      source: body.source,
      lineUserId: body.lineUserId,
      displayName,
      avatarUrl: body.avatarUrl,
      email: body.email,
      phone: body.phone,
      status: body.status,
      tags: Array.isArray(body.tags) ? body.tags : [],
    });
    return NextResponse.json({ contact });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Contact ensure failed";
    return NextResponse.json(
      { error: `CRM 暫時忙碌（contacts:ensure），請稍後重試。${message}` },
      { status: 503 },
    );
  }
}
