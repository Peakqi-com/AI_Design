import { NextResponse } from "next/server";
import {
  createMessage,
  getLineSettings,
  listContacts,
} from "@/lib/crm/store";
import { pushLineTextMessage } from "@/lib/crm/line";
import { resolveServerUserScopeId } from "@/lib/server/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BroadcastBody = {
  userId?: string;
  tag?: string; // 空 = 全部 LINE 客戶
  message?: string;
};

export async function POST(request: Request) {
  let body: BroadcastBody;
  try {
    body = (await request.json()) as BroadcastBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = (body.message || "").trim();
  if (!message) {
    return NextResponse.json({ error: "訊息內容不可空白。" }, { status: 400 });
  }

  const userScopeId = await resolveServerUserScopeId((body.userId || "").trim());
  const settings = await getLineSettings(userScopeId);
  if (!settings?.enabled || !settings.channelAccessToken) {
    return NextResponse.json({ error: "LINE OA 尚未串接，無法群發。" }, { status: 400 });
  }

  const tag = (body.tag || "").trim();
  const contacts = await listContacts({ userId: userScopeId, tag: tag || undefined });
  const lineContacts = contacts.filter((c) => c.source === "line" && c.lineUserId);

  if (lineContacts.length === 0) {
    return NextResponse.json({ error: "沒有符合條件的 LINE 客戶。", sent: 0, failed: 0 }, { status: 200 });
  }

  let sent = 0;
  let failed = 0;
  for (const contact of lineContacts) {
    try {
      const result = await pushLineTextMessage(contact.lineUserId!, message, settings.channelAccessToken);
      if (result.ok) {
        sent += 1;
        await createMessage({
          contactId: contact.id,
          direction: "outbound",
          senderType: "agent",
          source: "line",
          messageType: "text",
          text: message,
        }).catch(() => undefined);
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return NextResponse.json({ ok: true, total: lineContacts.length, sent, failed });
}
