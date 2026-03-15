import { NextResponse } from "next/server";
import { LinePushMessage, pushLineMessages } from "@/lib/crm/line";
import { toClientMessage } from "@/lib/crm/serializers";
import { resolveServerUserScopeId } from "@/lib/server/user-scope";
import {
  createMessage,
  getContactById,
  getLineSettings,
  listMessagesByContact,
  markContactAsRead,
} from "@/lib/crm/store";
import { CrmAttachment, MessageType } from "@/lib/crm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingAttachment = CrmAttachment & {
  dataUrl?: string;
};

type CreateMessageBody = {
  contactId?: string;
  text?: string;
  attachment?: IncomingAttachment;
};

const inferMessageType = (text: string | undefined, attachment?: CrmAttachment): MessageType => {
  if (attachment) {
    if (attachment.type === "image") {
      return "image";
    }
    if (attachment.type === "audio") {
      return "audio";
    }
    if (attachment.type === "video") {
      return "video";
    }
    return "file";
  }
  return text?.trim() ? "text" : "system";
};

const normalizeAttachment = (attachment?: IncomingAttachment): CrmAttachment | undefined => {
  if (!attachment) {
    return undefined;
  }

  if (
    attachment.storage === "inline_base64" &&
    !attachment.base64Data &&
    attachment.dataUrl?.includes(";base64,")
  ) {
    const [, base64Part] = attachment.dataUrl.split(";base64,");
    return {
      ...attachment,
      base64Data: base64Part || undefined,
    };
  }

  const { dataUrl: _unused, ...rest } = attachment;
  return rest;
};

const resolvePublicAttachmentUrl = (
  requestUrl: string,
  attachment: CrmAttachment,
): string | null => {
  const raw = attachment.url?.trim();
  if (!raw) {
    return null;
  }
  try {
    return new URL(raw, requestUrl).toString();
  } catch {
    return null;
  }
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const contactId = url.searchParams.get("contactId");
    const markRead = url.searchParams.get("markRead") === "1";

    if (!contactId) {
      return NextResponse.json({ error: "contactId is required." }, { status: 400 });
    }

    if (markRead) {
      await markContactAsRead(contactId);
    }

    const messages = await listMessagesByContact(contactId);
    return NextResponse.json({
      messages: messages.map(toClientMessage),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CRM messages unavailable";
    return NextResponse.json(
      { error: `CRM 暫時忙碌（messages:get），請稍後重試。${message}` },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    let body: CreateMessageBody;
    try {
      body = (await request.json()) as CreateMessageBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const contactId = body.contactId?.trim();
    const text = body.text?.trim();
    const attachment = normalizeAttachment(body.attachment);

    if (!contactId) {
      return NextResponse.json({ error: "contactId is required." }, { status: 400 });
    }
    if (!text && !attachment) {
      return NextResponse.json({ error: "text or attachment is required." }, { status: 400 });
    }

    const contact = await getContactById(contactId);
    if (!contact) {
      return NextResponse.json({ error: "Contact not found." }, { status: 404 });
    }

    if (contact.source === "line" && contact.lineUserId) {
      const userScopeId = await resolveServerUserScopeId();
      const lineSettings = await getLineSettings(userScopeId);
      if (!lineSettings?.enabled || !lineSettings.channelAccessToken) {
        return NextResponse.json(
          { error: "LINE integration is not connected. Please configure it in settings." },
          { status: 400 },
        );
      }

      const lineMessages: LinePushMessage[] = [];
      if (text) {
        lineMessages.push({ type: "text", text });
      }

      if (attachment?.type === "image") {
        const imageUrl = resolvePublicAttachmentUrl(request.url, attachment);
        if (!imageUrl) {
          return NextResponse.json(
            { error: "圖片附件缺少可公開存取 URL，暫時無法推送到 LINE。" },
            { status: 400 },
          );
        }
        if (!/^https:\/\//i.test(imageUrl)) {
          return NextResponse.json(
            { error: "LINE 圖片推送需要 HTTPS 圖片網址，請使用正式 HTTPS 網域。" },
            { status: 400 },
          );
        }
        lineMessages.push({
          type: "image",
          originalContentUrl: imageUrl,
          previewImageUrl: imageUrl,
        });
      } else if (attachment && !text) {
        const fallbackText =
          attachment.type === "video"
            ? "已傳送影片附件，請至 CRM 查看。"
            : attachment.type === "audio"
              ? "已傳送語音附件，請至 CRM 查看。"
              : "已傳送檔案附件，請至 CRM 查看。";
        lineMessages.push({ type: "text", text: fallbackText });
      }

      if (lineMessages.length > 0) {
        const sendResult = await pushLineMessages(
          contact.lineUserId,
          lineMessages,
          lineSettings.channelAccessToken,
        );
        if (!sendResult.ok) {
          return NextResponse.json(
            {
              error: "Failed to send message to LINE.",
              details: sendResult.body ?? null,
            },
            { status: 502 },
          );
        }
      }
    }

    const message = await createMessage({
      contactId,
      direction: "outbound",
      senderType: "agent",
      source: "crm",
      messageType: inferMessageType(text, attachment),
      text,
      attachment,
    });

    return NextResponse.json({ message: toClientMessage(message) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CRM messages unavailable";
    return NextResponse.json(
      { error: `CRM 暫時忙碌（messages:post），請稍後重試。${message}` },
      { status: 503 },
    );
  }
}
