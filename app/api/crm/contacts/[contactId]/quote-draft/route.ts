import { NextResponse } from "next/server";
import { generateLineConversationQuoteDraft } from "@/lib/ai/line-quotation";
import { createProject, createId, getContactById, listMessagesByContact } from "@/lib/crm/store";
import { ProjectQuotationItem, ProjectQuotationMeta } from "@/lib/crm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toQuoteNumber = (projectId: string): string => {
  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `Q-${dateTag}-${projectId.slice(-4).toUpperCase()}`;
};

export async function POST(
  _request: Request,
  context: { params: Promise<{ contactId: string }> },
) {
  try {
    const { contactId } = await context.params;
    const contact = await getContactById(contactId);
    if (!contact) {
      return NextResponse.json({ error: "Contact not found." }, { status: 404 });
    }

    const messages = await listMessagesByContact(contactId);
    const usableMessages = messages.filter((message) => {
      if (message.messageType === "text" && (message.text || "").trim()) {
        return true;
      }
      return false;
    });
    if (usableMessages.length === 0) {
      return NextResponse.json(
        { error: "目前沒有可整理成報價的 LINE 對話文字內容。" },
        { status: 400 },
      );
    }

    const { draft, model } = await generateLineConversationQuoteDraft({
      contactDisplayName: contact.displayName,
      conversationMessages: usableMessages.map((message) => ({
        text: message.text,
        timestamp: message.timestamp,
        direction: message.direction,
        messageType: message.messageType,
      })),
    });

    const seedProjectId = createId("project");
    const quotationItems: ProjectQuotationItem[] = draft.quotationItems.map((item, index) => ({
      id: `quote_${index + 1}_${seedProjectId.slice(-6)}`,
      name: item.name,
      description: item.description,
      quantity: Math.max(1, Number(item.quantity) || 1),
      unitPrice: Math.max(0, Number(item.unitPrice) || 0),
    }));
    const quotationMeta: ProjectQuotationMeta = {
      quoteNo: toQuoteNumber(seedProjectId),
      validUntil: draft.validUntil,
      status: "draft",
      note: draft.note,
      updatedAt: new Date().toISOString(),
    };

    const project = await createProject({
      userId: contact.userId,
      name: draft.projectName,
      clientName: draft.clientName || contact.displayName,
      status: "quoted",
      phase: draft.phase || "LINE 群組需求整理",
      budget: draft.budget || "待確認",
      linkedContactId: contact.id,
      note: draft.note,
      quotationItems,
      quotationMeta,
    });

    return NextResponse.json({
      project,
      sourceContact: {
        id: contact.id,
        displayName: contact.displayName,
        source: contact.source,
        lineUserId: contact.lineUserId,
      },
      summary: {
        messageCount: usableMessages.length,
        model,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Create quote draft failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
