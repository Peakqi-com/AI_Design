import { NextResponse } from "next/server";
import { listContacts, ensureCrmContact } from "@/lib/crm/store";

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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      displayName?: string;
      email?: string;
      phone?: string;
      company?: string;
      title?: string;
      address?: string;
      notes?: string;
      cardImageUrl?: string;
      tags?: string[];
      status?: string;
    };
    if (!body.displayName?.trim()) {
      return NextResponse.json({ error: "displayName is required." }, { status: 400 });
    }
    const contact = await ensureCrmContact({
      displayName: body.displayName.trim(),
      source: "manual",
      email: body.email,
      phone: body.phone,
      tags: body.tags,
      status: (body.status as "new" | "contacted" | "proposal" | "signed") || "new",
    });
    // Update extra fields not covered by ensureCrmContact
    if (body.company || body.title || body.address || body.notes || body.cardImageUrl) {
      const { updateContact } = await import("@/lib/crm/store");
      await updateContact(contact.id, {
        company: body.company?.trim(),
        title: body.title?.trim(),
        address: body.address?.trim(),
        cardImageUrl: body.cardImageUrl,
        notes: body.notes?.trim(),
      });
    }
    return NextResponse.json({ contact });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Create contact failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
