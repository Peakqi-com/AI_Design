import { NextResponse } from "next/server";
import { addTagToContact, removeTagFromContact } from "@/lib/crm/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TagBody = {
  tag?: string;
};

const parseTag = async (request: Request): Promise<string | null> => {
  const fromQuery = new URL(request.url).searchParams.get("tag")?.trim();
  if (fromQuery) {
    return fromQuery;
  }
  try {
    const body = (await request.json()) as TagBody;
    return body.tag?.trim() || null;
  } catch {
    return null;
  }
};

export async function POST(
  request: Request,
  context: { params: Promise<{ contactId: string }> },
) {
  try {
    const { contactId } = await context.params;
    const tag = await parseTag(request);
    if (!tag) {
      return NextResponse.json({ error: "Tag is required." }, { status: 400 });
    }

    const contact = await addTagToContact(contactId, tag);
    if (!contact) {
      return NextResponse.json({ error: "Contact not found." }, { status: 404 });
    }

    return NextResponse.json({ contact });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tag add failed";
    return NextResponse.json(
      { error: `CRM 暫時忙碌（contacts:tag:add），請稍後重試。${message}` },
      { status: 503 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ contactId: string }> },
) {
  try {
    const { contactId } = await context.params;
    const tag = await parseTag(request);
    if (!tag) {
      return NextResponse.json({ error: "Tag is required." }, { status: 400 });
    }

    const contact = await removeTagFromContact(contactId, tag);
    if (!contact) {
      return NextResponse.json({ error: "Contact not found." }, { status: 404 });
    }

    return NextResponse.json({ contact });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tag remove failed";
    return NextResponse.json(
      { error: `CRM 暫時忙碌（contacts:tag:remove），請稍後重試。${message}` },
      { status: 503 },
    );
  }
}
