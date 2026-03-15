import { NextResponse } from "next/server";
import { getLineBotInfo, normalizeLineAccessToken } from "@/lib/crm/line";
import {
  clearLineSettings,
  getLineSettings,
  getStorageBackend,
  saveLineSettings,
} from "@/lib/crm/store";
import { LineIntegrationSettings } from "@/lib/crm/types";
import { resolveServerUserScopeId } from "@/lib/server/user-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const normalizeBaseUrl = (value: string): string => {
  let trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }

  // Guard against accidental duplicates like "https://https://domain.com"
  const schemePrefix = trimmed.match(/^(https?:\/\/)+/i);
  if (schemePrefix) {
    const schemes = schemePrefix[0].match(/https?:\/\//gi) ?? [];
    const firstScheme = schemes[0]?.toLowerCase() === "http://" ? "http://" : "https://";
    trimmed = `${firstScheme}${trimmed.slice(schemePrefix[0].length)}`;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }

  return trimmed.replace(/\/+$/, "");
};

const resolveBaseUrl = (request: Request): string => {
  const fromEnv = [
    process.env.APP_BASE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]
    .map((value) => normalizeBaseUrl(value || ""))
    .find(Boolean);

  if (fromEnv) {
    return fromEnv;
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) {
    return "";
  }
  const protocol = request.headers.get("x-forwarded-proto") ?? "https";
  return normalizeBaseUrl(`${protocol}://${host}`);
};

const getWebhookUrl = (request: Request, userScopeId: string): string => {
  const query = `userId=${encodeURIComponent(userScopeId)}`;
  const baseUrl = resolveBaseUrl(request);
  if (!baseUrl) {
    return `/api/line/webhook?${query}`;
  }
  return `${baseUrl}/api/line/webhook?${query}`;
};

const sanitizeSettings = (
  settings: LineIntegrationSettings | null,
  request: Request,
  userScopeId: string,
): Record<string, unknown> => ({
  connected: Boolean(
    settings?.enabled && settings.channelAccessToken.trim() && settings.channelSecret.trim(),
  ),
  channelId: settings?.channelId ?? "",
  hasChannelAccessToken: Boolean(settings?.channelAccessToken),
  hasChannelSecret: Boolean(settings?.channelSecret),
  updatedAt: settings?.updatedAt ?? null,
  lastWebhookAt: settings?.lastWebhookAt ?? null,
  lastWebhookEventCount: settings?.lastWebhookEventCount ?? 0,
  lastWebhookProcessedCount: settings?.lastWebhookProcessedCount ?? 0,
  lastWebhookFailedCount: settings?.lastWebhookFailedCount ?? 0,
  lastWebhookError: settings?.lastWebhookError ?? null,
  webhookUrl: getWebhookUrl(request, userScopeId),
  storageBackend: getStorageBackend(),
});

type UpdateSettingsBody = {
  channelId?: string;
  channelAccessToken?: string;
  channelSecret?: string;
  enabled?: boolean;
};

const getLineErrorMessage = (details: unknown): string => {
  if (!details || typeof details !== "object") {
    return "";
  }
  const maybe = details as { message?: string; details?: string[] };
  const detailList = Array.isArray(maybe.details) ? maybe.details.filter(Boolean).join("; ") : "";
  return [maybe.message || "", detailList].filter(Boolean).join(" | ");
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedUserId = url.searchParams.get("userId")?.trim() || "";
  const userScopeId = await resolveServerUserScopeId(requestedUserId);
  const settings = await getLineSettings(userScopeId);
  return NextResponse.json(sanitizeSettings(settings, request, userScopeId));
}

export async function PUT(request: Request) {
  const url = new URL(request.url);
  const requestedUserId = url.searchParams.get("userId")?.trim() || "";
  let body: UpdateSettingsBody;
  try {
    body = (await request.json()) as UpdateSettingsBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const userScopeId = await resolveServerUserScopeId(requestedUserId);
  const existing = await getLineSettings(userScopeId);
  const channelId = body.channelId?.trim() || existing?.channelId || "";
  const channelAccessToken =
    normalizeLineAccessToken(body.channelAccessToken || "") ||
    normalizeLineAccessToken(existing?.channelAccessToken || "");
  const channelSecret = body.channelSecret?.trim() || existing?.channelSecret || "";
  const enabled = body.enabled ?? true;

  if (!channelId || !channelAccessToken || !channelSecret) {
    return NextResponse.json(
      {
        error:
          "channelId, channelAccessToken, channelSecret are required. Existing values can be reused by leaving new inputs empty.",
      },
      { status: 400 },
    );
  }

  const botInfo = await getLineBotInfo(channelAccessToken);
  if (!botInfo.ok) {
    const detailMessage = getLineErrorMessage(botInfo.body);
    return NextResponse.json(
      {
        error: detailMessage
          ? `LINE Channel Access Token validation failed: ${detailMessage}`
          : "LINE Channel Access Token validation failed.",
        details: botInfo.body ?? null,
      },
      { status: 400 },
    );
  }

  const nextSettings: LineIntegrationSettings = {
    enabled,
    channelId,
    channelAccessToken,
    channelSecret,
    updatedAt: new Date().toISOString(),
    lastWebhookAt: existing?.lastWebhookAt,
    lastWebhookEventCount: existing?.lastWebhookEventCount ?? 0,
    lastWebhookProcessedCount: existing?.lastWebhookProcessedCount ?? 0,
    lastWebhookFailedCount: existing?.lastWebhookFailedCount ?? 0,
    lastWebhookError: existing?.lastWebhookError ?? null,
  };

  const saved = await saveLineSettings(nextSettings, userScopeId);
  return NextResponse.json(sanitizeSettings(saved, request, userScopeId));
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const requestedUserId = url.searchParams.get("userId")?.trim() || "";
  const userScopeId = await resolveServerUserScopeId(requestedUserId);
  await clearLineSettings(userScopeId);
  return NextResponse.json(sanitizeSettings(null, request, userScopeId));
}
