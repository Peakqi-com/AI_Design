import crypto from "crypto";

const LINE_API_BASE = "https://api.line.me/v2/bot";
const LINE_CONTENT_BASE = "https://api-data.line.me/v2/bot";

export const normalizeLineAccessToken = (token: string): string =>
  token
    .trim()
    .replace(/^Bearer\s+/i, "")
    .trim();

export interface LineProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
}

const getAuthHeaders = (channelAccessToken: string): Record<string, string> => ({
  Authorization: `Bearer ${normalizeLineAccessToken(channelAccessToken)}`,
});

export const verifyLineSignature = (
  bodyText: string,
  signatureHeader: string | null,
  channelSecret: string,
): boolean => {
  if (!signatureHeader) {
    return false;
  }
  const hmac = crypto.createHmac("SHA256", channelSecret);
  const digest = hmac.update(bodyText).digest("base64");
  return digest === signatureHeader;
};

export async function getLineBotInfo(channelAccessToken: string): Promise<{
  ok: boolean;
  body?: unknown;
  status: number;
}> {
  const response = await fetch(`${LINE_API_BASE}/info`, {
    headers: getAuthHeaders(channelAccessToken),
  });
  let body: unknown = undefined;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return { ok: response.ok, body, status: response.status };
}

export async function fetchLineProfile(
  userId: string,
  channelAccessToken: string,
): Promise<LineProfile | null> {
  const response = await fetch(`${LINE_API_BASE}/profile/${encodeURIComponent(userId)}`, {
    headers: getAuthHeaders(channelAccessToken),
  });

  if (!response.ok) {
    return null;
  }

  const profile = (await response.json()) as LineProfile;
  return profile;
}

export interface LineMessageContent {
  buffer: Buffer;
  mimeType?: string;
  fileName?: string;
}

export async function downloadLineMessageContent(
  messageId: string,
  channelAccessToken: string,
): Promise<LineMessageContent | null> {
  const response = await fetch(
    `${LINE_CONTENT_BASE}/message/${encodeURIComponent(messageId)}/content`,
    {
      headers: getAuthHeaders(channelAccessToken),
    },
  );

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? undefined;
  const disposition = response.headers.get("content-disposition") ?? "";
  const fileNameMatch = disposition.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i);
  const fileName = fileNameMatch?.[1]?.replace(/["']/g, "").trim();
  const arrayBuffer = await response.arrayBuffer();

  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: contentType,
    fileName,
  };
}

export async function pushLineTextMessage(
  userId: string,
  text: string,
  channelAccessToken: string,
): Promise<{ ok: boolean; status: number; body?: unknown }> {
  return pushLineMessages(
    userId,
    [{ type: "text", text }],
    channelAccessToken,
  );
}

export type LinePushMessage =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      originalContentUrl: string;
      previewImageUrl: string;
    };

export async function pushLineMessages(
  userId: string,
  messages: LinePushMessage[],
  channelAccessToken: string,
): Promise<{ ok: boolean; status: number; body?: unknown }> {
  const response = await fetch(`${LINE_API_BASE}/message/push`, {
    method: "POST",
    headers: {
      ...getAuthHeaders(channelAccessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: userId,
      messages,
    }),
  });

  let body: unknown = undefined;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}
