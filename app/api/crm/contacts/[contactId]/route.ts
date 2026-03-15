import { NextResponse } from "next/server";
import { getContactById, updateContact } from "@/lib/crm/store";
import { ContactStatus } from "@/lib/crm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_SET = new Set<ContactStatus>(["new", "contacted", "proposal", "signed"]);

type UpdateContactBody = {
  displayName?: string;
  email?: string;
  phone?: string;
  status?: ContactStatus;
  avatarUrl?: string | null;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ contactId: string }> },
) {
  try {
    const { contactId } = await context.params;
    const contact = await getContactById(contactId);
    if (!contact) {
      return NextResponse.json({ error: "Contact not found." }, { status: 404 });
    }
    return NextResponse.json({ contact });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Contact read failed";
    return NextResponse.json(
      { error: `CRM 暫時忙碌（contacts:get-one），請稍後重試。${message}` },
      { status: 503 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ contactId: string }> },
) {
  try {
    const { contactId } = await context.params;

    let body: UpdateContactBody;
    try {
      body = (await request.json()) as UpdateContactBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    if (body.status && !STATUS_SET.has(body.status)) {
      return NextResponse.json({ error: "Unsupported status value." }, { status: 400 });
    }

    const contact = await updateContact(contactId, {
      displayName: body.displayName?.trim(),
      email: body.email?.trim(),
      phone: body.phone?.trim(),
      status: body.status,
      avatarUrl: body.avatarUrl,
    });

    if (!contact) {
      return NextResponse.json({ error: "Contact not found." }, { status: 404 });
    }

    return NextResponse.json({ contact });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Contact update failed";
    return NextResponse.json(
      { error: `CRM 暫時忙碌（contacts:patch），請稍後重試。${message}` },
      { status: 503 },
    );
  }
}
