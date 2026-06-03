const DEFAULT_REPLICATE_VIDEO_MODEL =
  (process.env.REPLICATE_VIDEO_MODEL || "").trim() || "kwaivgi/kling-v2.6";
const DEFAULT_REPLICATE_VIDEO_MODEL_VERSION = (process.env.REPLICATE_VIDEO_MODEL_VERSION || "").trim();
const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

interface ParsedDataUrl {
  mimeType: string;
  dataUrl: string;
}

export interface StartVeoImageVideoInput {
  imageDataUrl?: string;
  lastFrameImageDataUrl?: string;
  prompt: string;
  model?: string;
  mode?: "image-to-video" | "text-to-video" | "first-last-frame";
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "4:5";
  resolution?: "720p" | "1080p";
  durationSec?: number;
  negativePrompt?: string;
}

// Kling v3.0: supports end_image for first-last-frame, 1080p, native audio
const FIRST_LAST_FRAME_MODEL = "kwaivgi/kling-v3-video";
// Kling v2.6: 1080p + native audio, text-to-video + image-to-video, ~$0.30-0.60
const TEXT_TO_VIDEO_MODEL = "kwaivgi/kling-v2.6";

export interface VeoStartResult {
  operationName: string;
  model: string;
}

export interface VeoOperationStatus {
  done: boolean;
  operationName: string;
  videoUri?: string;
  videoGcsUri?: string;
  error?: string;
}

export class VeoStartError extends Error {
  code: string;
  statusCode: number;
  hints?: string[];
  supportSummary?: string;

  constructor(input: {
    message: string;
    code: string;
    statusCode?: number;
    hints?: string[];
    supportSummary?: string;
  }) {
    super(input.message);
    this.name = "VeoStartError";
    this.code = input.code;
    this.statusCode = input.statusCode ?? 500;
    this.hints = input.hints;
    this.supportSummary = input.supportSummary;
  }
}

const parseDataUrl = (dataUrl: string): ParsedDataUrl => {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Replicate 影片模型目前只支援圖片 base64 輸入。");
  }
  const normalizedBase64 = (match[2] || "").replace(/\s+/g, "");
  if (!normalizedBase64) {
    throw new Error("圖片資料為空（image is empty），請重新上傳圖片。");
  }
  const approxBytes = Math.floor((normalizedBase64.length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    throw new Error("圖片大小超過 20MB，請先壓縮後再試。");
  }
  const normalizedDataUrl = `data:${match[1]};base64,${normalizedBase64}`;
  return {
    mimeType: match[1],
    dataUrl: normalizedDataUrl,
  };
};

const extractErrorMessage = (raw: unknown): string => {
  if (!raw || typeof raw !== "object") {
    return "Replicate API 回傳未知錯誤。";
  }
  const maybe = raw as {
    error?: { message?: string } | string;
    detail?: string;
    title?: string;
    status?: number | string;
  };
  if (typeof maybe.error === "string" && maybe.error.trim()) {
    return maybe.error.trim();
  }
  if (maybe.error && typeof maybe.error === "object" && typeof maybe.error.message === "string") {
    return maybe.error.message.trim();
  }
  if (typeof maybe.detail === "string" && maybe.detail.trim()) {
    return maybe.detail.trim();
  }
  if (typeof maybe.title === "string" && maybe.title.trim()) {
    return maybe.title.trim();
  }
  return "Replicate API 回傳錯誤。";
};

const tryParseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const normalizeOperationName = (operationName: string): string => operationName.trim();

const isCredentialLikeStatus = (status: number): boolean => status === 401 || status === 403;

export const isReplicateCredentialErrorMessage = (message: string): boolean =>
  /api token|authorization|unauthorized|forbidden|credential|authentication|bearer/i.test(
    message,
  );

const getReplicateToken = (): string => {
  const token = (process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY || "").trim();
  if (!token) {
    throw new VeoStartError({
      code: "VEO_AUTH_INVALID",
      statusCode: 503,
      message: "尚未設定 REPLICATE_API_TOKEN，無法使用 Replicate 影片模型。",
    });
  }
  return token;
};

const getReplicateHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${getReplicateToken()}`,
  "Content-Type": "application/json",
});

const normalizeDuration = (durationSec?: number): number => {
  if (!Number.isFinite(durationSec)) {
    return 5;
  }
  const rounded = Math.round(Number(durationSec));
  return Math.max(1, Math.min(15, rounded));
};

const resolveModelTarget = (requested?: string): { model: string; version?: string } => {
  const raw = (requested || "").trim();
  if (raw) {
    if (/^[0-9a-f]{64}$/i.test(raw)) {
      return { model: DEFAULT_REPLICATE_VIDEO_MODEL, version: raw };
    }
    if (raw.includes(":")) {
      const [modelPart, versionPart] = raw.split(":");
      const model = modelPart.trim() || DEFAULT_REPLICATE_VIDEO_MODEL;
      const version = versionPart.trim();
      return { model, ...(version ? { version } : {}) };
    }
    return { model: raw };
  }
  if (DEFAULT_REPLICATE_VIDEO_MODEL_VERSION) {
    return {
      model: DEFAULT_REPLICATE_VIDEO_MODEL,
      version: DEFAULT_REPLICATE_VIDEO_MODEL_VERSION,
    };
  }
  return { model: DEFAULT_REPLICATE_VIDEO_MODEL };
};

const resolveModelSlug = (model: string): { owner: string; name: string } | null => {
  const cleaned = (model || "").trim();
  if (!cleaned) {
    return null;
  }
  const [owner, name] = cleaned.split("/").map((part) => part.trim());
  if (!owner || !name) {
    return null;
  }
  return { owner, name };
};

const extractVideoUriFromOutput = (output: unknown): string | undefined => {
  if (typeof output === "string" && output.trim()) {
    return output.trim();
  }
  if (Array.isArray(output)) {
    for (const item of output) {
      if (typeof item === "string" && item.trim()) {
        return item.trim();
      }
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        if (typeof record.url === "string" && record.url.trim()) {
          return record.url.trim();
        }
      }
    }
    return undefined;
  }
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    if (typeof record.url === "string" && record.url.trim()) {
      return record.url.trim();
    }
    if (typeof record.video === "string" && record.video.trim()) {
      return record.video.trim();
    }
  }
  return undefined;
};

const buildReplicateInput = (input: StartVeoImageVideoInput): Record<string, unknown> => {
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new VeoStartError({
      code: "VEO_GENERATE_FAILED",
      statusCode: 400,
      message: "prompt is required.",
    });
  }
  const payload: Record<string, unknown> = {
    prompt,
    duration: normalizeDuration(input.durationSec),
    aspect_ratio: input.aspectRatio || "9:16",
    resolution: input.resolution || "720p",
  };
  if (input.imageDataUrl?.trim()) {
    const parsed = parseDataUrl(input.imageDataUrl.trim());
    payload.image = parsed.dataUrl;
    if (input.lastFrameImageDataUrl?.trim()) {
      // First + last frame mode: Kling uses end_image + mode:pro
      const parsedLast = parseDataUrl(input.lastFrameImageDataUrl.trim());
      payload.end_image = parsedLast.dataUrl;
      payload.mode = "pro";
    }
  }
  if (input.negativePrompt?.trim()) {
    payload.negative_prompt = input.negativePrompt.trim();
  }
  return payload;
};

export async function startVeoImageToVideo(
  input: StartVeoImageVideoInput,
): Promise<VeoStartResult> {
  // Use dedicated models for specific modes
  let effectiveModel = input.model;
  if (!effectiveModel) {
    if (input.mode === "first-last-frame") {
      effectiveModel = FIRST_LAST_FRAME_MODEL;
    } else if (input.mode === "text-to-video") {
      effectiveModel = TEXT_TO_VIDEO_MODEL;
    }
  }
  const target = resolveModelTarget(effectiveModel);
  const requestBody: Record<string, unknown> = {
    input: buildReplicateInput(input),
  };
  let endpoint = `${REPLICATE_API_BASE}/predictions`;
  if (target.version) {
    requestBody.version = target.version;
  } else {
    const slug = resolveModelSlug(target.model);
    if (!slug) {
      throw new VeoStartError({
        code: "VEO_GENERATE_FAILED",
        statusCode: 400,
        message:
          "Replicate 模型格式錯誤。請使用 owner/name（例如 xai/grok-imagine-video）或 owner/name:version。",
      });
    }
    endpoint = `${REPLICATE_API_BASE}/models/${encodeURIComponent(slug.owner)}/${encodeURIComponent(slug.name)}/predictions`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: getReplicateHeaders(),
    body: JSON.stringify(requestBody),
  });
  const rawBody = await response.text();
  const parsedBody = rawBody ? tryParseJson(rawBody) : null;

  if (!response.ok) {
    const fallbackMessage = rawBody.trim().slice(0, 220) || `HTTP ${response.status}`;
    const message = parsedBody ? extractErrorMessage(parsedBody) : fallbackMessage;
    if (response.status === 429) {
      throw new VeoStartError({
        code: "VEO_RATE_LIMITED",
        statusCode: 429,
        message: `Replicate 目前達到速率限制：${message}`,
      });
    }
    if (isCredentialLikeStatus(response.status) || isReplicateCredentialErrorMessage(message)) {
      throw new VeoStartError({
        code: "VEO_AUTH_INVALID",
        statusCode: 503,
        message: `Replicate 認證失敗：${message}`,
      });
    }
    throw new VeoStartError({
      code: "VEO_GENERATE_FAILED",
      statusCode: response.status >= 400 && response.status < 500 ? response.status : 500,
      message,
    });
  }

  const body = (parsedBody || {}) as { id?: string };
  const operationName = normalizeOperationName(body.id || "");
  if (!operationName) {
    throw new VeoStartError({
      code: "VEO_GENERATE_FAILED",
      statusCode: 500,
      message: "Replicate 沒有回傳 prediction id，請稍後再試。",
    });
  }

  return {
    operationName,
    model: target.version ? `${target.model}:${target.version}` : target.model,
  };
}

export async function getVeoOperationStatus(operationName: string): Promise<VeoOperationStatus> {
  const normalizedName = normalizeOperationName(operationName);
  const endpoint = `${REPLICATE_API_BASE}/predictions/${encodeURIComponent(normalizedName)}`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: getReplicateHeaders(),
  });

  const rawBody = await response.text();
  const parsedBody = rawBody ? tryParseJson(rawBody) : null;
  const body = (parsedBody || {}) as {
    status?: string;
    output?: unknown;
    error?: string | null;
  };

  if (!response.ok) {
    const fallbackMessage = rawBody.trim().slice(0, 220) || `HTTP ${response.status}`;
    const message = parsedBody ? extractErrorMessage(parsedBody) : fallbackMessage;
    throw new Error(message);
  }

  const predictionStatus = (body.status || "").toLowerCase();
  const done = predictionStatus === "succeeded" || predictionStatus === "failed" || predictionStatus === "canceled";
  const videoUri = predictionStatus === "succeeded" ? extractVideoUriFromOutput(body.output) : undefined;
  const rawError = (body.error || "").trim();
  const errorMessage =
    rawError ||
    (predictionStatus === "failed"
      ? "Replicate 影片生成失敗。"
      : predictionStatus === "canceled"
        ? "影片生成已取消。"
        : undefined);

  return {
    done,
    operationName: normalizedName,
    videoUri,
    error:
      done && predictionStatus === "succeeded" && !videoUri
        ? "影片已完成但未取得輸出網址。"
        : errorMessage,
  };
}

export async function cancelVeoOperation(
  operationName: string,
): Promise<{ operationName: string; cancelled: boolean; message?: string }> {
  const normalizedName = normalizeOperationName(operationName);
  const endpoint = `${REPLICATE_API_BASE}/predictions/${encodeURIComponent(normalizedName)}/cancel`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: getReplicateHeaders(),
  });

  const rawBody = await response.text();
  const parsedBody = rawBody ? tryParseJson(rawBody) : null;

  if (response.ok) {
    return {
      operationName: normalizedName,
      cancelled: true,
    };
  }

  const fallbackMessage = rawBody.trim().slice(0, 220) || `HTTP ${response.status}`;
  const message = parsedBody ? extractErrorMessage(parsedBody) : fallbackMessage;

  // Some providers may return not-found/failed-precondition when operation already completed.
  if (
    response.status === 404 ||
    response.status === 409 ||
    /not found|already (done|finished|completed)|cannot cancel|failed precondition|already canceled/i.test(message)
  ) {
    return {
      operationName: normalizedName,
      cancelled: false,
      message,
    };
  }

  throw new Error(message);
}

const isAllowedVideoUri = (videoUri: string): boolean => {
  try {
    const parsed = new URL(videoUri);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    // Allow all HTTPS URLs — Replicate models output to various CDNs
    return true;
  } catch {
    return false;
  }
};

export async function downloadVeoVideo(
  videoUri: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  if (!isAllowedVideoUri(videoUri)) {
    throw new Error("不合法的影片下載連結。");
  }

  // Try without auth first, then with Replicate token if needed
  let response = await fetch(videoUri, { method: "GET", redirect: "follow" });
  if (!response.ok && (response.status === 401 || response.status === 403 || response.status === 404)) {
    // Some CDNs need the Replicate token
    response = await fetch(videoUri, {
      method: "GET",
      redirect: "follow",
      headers: { Authorization: `Bearer ${getReplicateToken()}` },
    });
  }
  if (!response.ok) {
    // Last try: get fresh URL from Replicate prediction
    // The video URI might have expired, try fetching without any modification
    try {
      response = await fetch(videoUri, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": "InteriorPro/1.0" },
      });
    } catch { /* use previous response */ }
  }

  if (!response.ok) {
    const raw = await response.text();
    const snippet = raw.trim().slice(0, 180);
    throw new Error(
      `下載影片失敗（${response.status}）` +
        (snippet ? `：${snippet}` : ""),
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") || "video/mp4";

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType,
  };
}
