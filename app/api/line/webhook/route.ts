import { NextResponse } from "next/server";
import { saveAttachment } from "@/lib/crm/attachments";
import {
  downloadLineMessageContent,
  fetchLineProfile,
  pushLineTextMessage,
  verifyLineSignature,
} from "@/lib/crm/line";
import {
  applyAutoTags,
  createMessage,
  getAutoReplyConfig,
  getLineSettings,
  listLineSettingsByScope,
  matchAutoReply,
  updateLineWebhookStats,
  upsertLineContact,
} from "@/lib/crm/store";
import { LineIntegrationSettings, MessageType } from "@/lib/crm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LineWebhookSource = {
  type?: string;
  userId?: string;
  groupId?: string;
  roomId?: string;
};

type LineWebhookMessage = {
  id?: string;
  type?: string;
  text?: string;
  title?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  fileName?: string;
  packageId?: string;
  stickerId?: string;
};

type LineWebhookEvent = {
  type?: string;
  timestamp?: number;
  source?: LineWebhookSource;
  message?: LineWebhookMessage;
};

type LineWebhookBody = {
  events?: LineWebhookEvent[];
};

const toIso = (timestamp?: number): string =>
  timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();

const mapLineMessageType = (lineType?: string): MessageType => {
  switch (lineType) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "file":
      return "file";
    case "sticker":
      return "sticker";
    case "location":
      return "location";
    case "text":
      return "text";
    default:
      return "system";
  }
};

const getFallbackName = (sourceKey: string): string => {
  if (sourceKey.startsWith("group:")) {
    return `LINE 群組 ${sourceKey.slice(-6)}`;
  }
  if (sourceKey.startsWith("room:")) {
    return `LINE 聊天室 ${sourceKey.slice(-6)}`;
  }
  return `LINE 使用者 ${sourceKey.slice(-6)}`;
};

const getSourceKey = (source?: LineWebhookSource): string | null => {
  if (!source) {
    return null;
  }
  if (source.userId) {
    return source.userId;
  }
  if (source.groupId) {
    return `group:${source.groupId}`;
  }
  if (source.roomId) {
    return `room:${source.roomId}`;
  }
  return null;
};

async function processLineMessageEvent(
  event: LineWebhookEvent,
  channelAccessToken: string,
  userScopeId: string,
): Promise<void> {
  const sourceKey = getSourceKey(event.source);
  const userId = event.source?.userId;
  const lineMessage = event.message;
  if (!sourceKey || !lineMessage?.type) {
    return;
  }

  const profile = userId ? await fetchLineProfile(userId, channelAccessToken) : null;
  const contact = await upsertLineContact({
    lineUserId: sourceKey,
    displayName: profile?.displayName ?? getFallbackName(sourceKey),
    avatarUrl: profile?.pictureUrl ?? null,
    userId: userScopeId,
  });

  const messageType = mapLineMessageType(lineMessage.type);
  const lineMessageId = lineMessage.id;
  const timestamp = toIso(event.timestamp);

  if (lineMessage.type === "text") {
    await createMessage({
      contactId: contact.id,
      direction: "inbound",
      senderType: "customer",
      source: "line",
      messageType: "text",
      text: lineMessage.text ?? "",
      lineMessageId,
      timestamp,
      rawEvent: event,
    });
    // 自動標籤：依使用者的關鍵字規則套用
    await applyAutoTags(userScopeId, contact.id, lineMessage.text ?? "").catch(() => undefined);
    // 關鍵字自動回覆
    const replyText = await matchAutoReply(userScopeId, lineMessage.text ?? "").catch(() => null);
    if (replyText && userId) {
      const ok = await pushLineTextMessage(userId, replyText, channelAccessToken).catch(() => false);
      if (ok) {
        await createMessage({
          contactId: contact.id,
          direction: "outbound",
          senderType: "system",
          source: "line",
          messageType: "text",
          text: replyText,
          timestamp: toIso(event.timestamp),
        }).catch(() => undefined);
      }
    }
    return;
  }

  if (lineMessage.type === "sticker") {
    await createMessage({
      contactId: contact.id,
      direction: "inbound",
      senderType: "customer",
      source: "line",
      messageType: "sticker",
      text: `[Sticker] ${lineMessage.packageId ?? "unknown"}:${lineMessage.stickerId ?? "unknown"}`,
      lineMessageId,
      timestamp,
      rawEvent: event,
    });
    return;
  }

  if (lineMessage.type === "location") {
    const summary = [
      "[位置資訊]",
      lineMessage.title ? `標題: ${lineMessage.title}` : null,
      lineMessage.address ? `地址: ${lineMessage.address}` : null,
      typeof lineMessage.latitude === "number" && typeof lineMessage.longitude === "number"
        ? `座標: ${lineMessage.latitude}, ${lineMessage.longitude}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    await createMessage({
      contactId: contact.id,
      direction: "inbound",
      senderType: "customer",
      source: "line",
      messageType: "location",
      text: summary,
      lineMessageId,
      timestamp,
      rawEvent: event,
    });
    return;
  }

  if (!lineMessageId) {
    await createMessage({
      contactId: contact.id,
      direction: "inbound",
      senderType: "customer",
      source: "line",
      messageType,
      text: `[${lineMessage.type}]`,
      timestamp,
      rawEvent: event,
    });
    return;
  }

  const content = await downloadLineMessageContent(lineMessageId, channelAccessToken);
  if (!content) {
    await createMessage({
      contactId: contact.id,
      direction: "inbound",
      senderType: "customer",
      source: "line",
      messageType,
      text: `[${lineMessage.type}] 無法下載附件內容`,
      lineMessageId,
      timestamp,
      rawEvent: event,
    });
    return;
  }

  const attachment = await saveAttachment({
    buffer: content.buffer,
    fileName: lineMessage.fileName || content.fileName,
    mimeType: content.mimeType,
    lineMessageId,
  });

  await createMessage({
    contactId: contact.id,
    direction: "inbound",
    senderType: "customer",
    source: "line",
    messageType,
    text:
      messageType === "image"
        ? "[圖片]"
        : messageType === "video"
          ? "[影片]"
          : messageType === "audio"
            ? "[語音]"
            : "[檔案]",
    attachment,
    lineMessageId,
    timestamp,
    rawEvent: event,
  });
}

async function processEvent(
  event: LineWebhookEvent,
  channelAccessToken: string,
  userScopeId: string,
): Promise<void> {
  const eventType = event.type;
  const userId = event.source?.userId;
  const sourceKey = getSourceKey(event.source);

  if (!eventType) {
    return;
  }

  if (eventType === "follow") {
    if (!userId) {
      return;
    }
    const profile = await fetchLineProfile(userId, channelAccessToken);
    await upsertLineContact({
      lineUserId: userId,
      displayName: profile?.displayName ?? getFallbackName(userId),
      avatarUrl: profile?.pictureUrl ?? null,
      userId: userScopeId,
    });
    // 加入好友：推送歡迎訊息（若有設定）
    const cfg = await getAutoReplyConfig(userScopeId).catch(() => null);
    if (cfg?.welcomeEnabled && cfg.welcomeMessage?.trim()) {
      await pushLineTextMessage(userId, cfg.welcomeMessage.trim(), channelAccessToken).catch(() => undefined);
    }
    return;
  }

  if (eventType === "message") {
    if (!sourceKey) {
      return;
    }
    await processLineMessageEvent(event, channelAccessToken, userScopeId);
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message:
      "LINE webhook endpoint is ready. Use POST with X-Line-Signature. For multi-tenant mode, append ?userId=<scope> to webhook URL.",
  });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const requestedUserScopeId = (url.searchParams.get("userId") || "").trim();
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 401 });
  }

  let scopedSettings: { userScopeId: string; settings: LineIntegrationSettings };
  if (requestedUserScopeId) {
    const scoped = await getLineSettings(requestedUserScopeId);
    if (!scoped?.enabled || !scoped.channelSecret || !scoped.channelAccessToken) {
      return NextResponse.json(
        { error: "LINE integration settings are missing." },
        { status: 503 },
      );
    }
    if (!verifyLineSignature(rawBody, signature, scoped.channelSecret)) {
      return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    }
    scopedSettings = { userScopeId: requestedUserScopeId, settings: scoped };
  } else {
    const candidates = await listLineSettingsByScope();
    const matched = candidates.find(
      (candidate) =>
        candidate.settings?.enabled &&
        candidate.settings.channelSecret &&
        candidate.settings.channelAccessToken &&
        verifyLineSignature(rawBody, signature, candidate.settings.channelSecret),
    );
    if (!matched) {
      return NextResponse.json(
        { error: "Invalid signature or tenant mapping not found." },
        { status: 401 },
      );
    }
    scopedSettings = matched;
  }

  let payload: LineWebhookBody;
  try {
    payload = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid LINE webhook payload." }, { status: 400 });
  }

  const events = payload.events ?? [];
  let processed = 0;
  let failed = 0;
  let firstError = "";

  for (const event of events) {
    try {
      await processEvent(
        event,
        scopedSettings.settings.channelAccessToken,
        scopedSettings.userScopeId,
      );
      processed += 1;
    } catch (error) {
      failed += 1;
      if (!firstError) {
        firstError = error instanceof Error ? error.message : "未知事件處理錯誤";
      }
    }
  }

  await updateLineWebhookStats({
    lastWebhookAt: new Date().toISOString(),
    lastWebhookEventCount: events.length,
    lastWebhookProcessedCount: processed,
    lastWebhookFailedCount: failed,
    lastWebhookError: firstError || null,
  }, scopedSettings.userScopeId);

  return NextResponse.json({
    ok: failed === 0,
    processed,
    failed,
    received: events.length,
    error: firstError || null,
  });
}
