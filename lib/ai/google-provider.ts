import { GoogleAuth } from "google-auth-library";

const AI_STUDIO_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_VERTEX_LOCATION = "us-central1";
const DEFAULT_VERTEX_API_VERSION = "v1beta1";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export type GoogleAiProvider = "aistudio" | "vertex";

interface ResolvedGoogleAiProvider {
  provider: GoogleAiProvider;
  vertexProjectId?: string;
  vertexLocation?: string;
  vertexApiVersion?: string;
}

let cachedVertexAccessToken: { token: string; expiresAt: number } | null = null;
let googleAuth: GoogleAuth | null = null;

const asBool = (value: string | undefined): boolean => /^(1|true|yes|on)$/i.test((value || "").trim());

const normalizeProviderInput = (value: string | undefined): GoogleAiProvider | null => {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "vertex") {
    return "vertex";
  }
  if (normalized === "aistudio" || normalized === "google-ai-studio" || normalized === "studio") {
    return "aistudio";
  }
  return null;
};

const resolveVertexProjectId = (): string =>
  (
    process.env.VERTEX_AI_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT
  )?.trim() || "";

const resolveGoogleAiProvider = (): ResolvedGoogleAiProvider => {
  const forcedProvider = normalizeProviderInput(
    process.env.GOOGLE_AI_PROVIDER || process.env.AI_PROVIDER || undefined,
  );
  const useVertexFromFlag = asBool(process.env.GOOGLE_GENAI_USE_VERTEXAI);
  const hasVertexHints = Boolean(resolveVertexProjectId() || process.env.VERTEX_API_KEY?.trim());
  const provider: GoogleAiProvider =
    forcedProvider || (useVertexFromFlag || hasVertexHints ? "vertex" : "aistudio");

  if (provider === "vertex") {
    const vertexProjectId = resolveVertexProjectId();
    if (!vertexProjectId) {
      throw new Error(
        "尚未設定 Vertex AI 專案 ID。請設定 VERTEX_AI_PROJECT_ID（或 GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT）。",
      );
    }
    const vertexLocation =
      process.env.VERTEX_AI_LOCATION?.trim() ||
      process.env.GOOGLE_CLOUD_LOCATION?.trim() ||
      DEFAULT_VERTEX_LOCATION;
    const vertexApiVersion = process.env.VERTEX_AI_API_VERSION?.trim() || DEFAULT_VERTEX_API_VERSION;
    return { provider, vertexProjectId, vertexLocation, vertexApiVersion };
  }

  return { provider };
};

export const getGoogleAiProviderLabel = (): string =>
  resolveGoogleAiProvider().provider === "vertex" ? "Vertex AI" : "Google AI Studio";

export const normalizeGoogleModelName = (modelName: string): string => {
  const trimmed = modelName.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("models/")) {
    return trimmed.slice("models/".length);
  }
  const marker = "/models/";
  const markerIndex = trimmed.lastIndexOf(marker);
  if (markerIndex >= 0) {
    return trimmed.slice(markerIndex + marker.length);
  }
  return trimmed;
};

const normalizeOperationName = (operationName: string): string => {
  const trimmed = operationName
    .trim()
    .replace(/^https?:\/\/[^/]+\/?/i, "")
    .replace(/^\/+/, "");
  const withoutVersion = trimmed.replace(/^v1(?:beta1?)?\//, "");
  if (!withoutVersion) {
    return "operations/";
  }
  if (withoutVersion.startsWith("operations/") || withoutVersion.includes("/operations/")) {
    return withoutVersion;
  }
  return `operations/${withoutVersion}`;
};

const getAiStudioApiKey = (): string => {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === "PLACEHOLDER_API_KEY") {
    throw new Error("尚未設定有效的 GEMINI_API_KEY（Google AI Studio）。");
  }
  return key;
};

const getVertexApiKey = (): string => {
  const key = process.env.VERTEX_API_KEY?.trim();
  return key && key !== "PLACEHOLDER_API_KEY" ? key : "";
};

const getVertexAccessToken = async (): Promise<string> => {
  const now = Date.now();
  if (cachedVertexAccessToken && cachedVertexAccessToken.expiresAt > now + 60 * 1000) {
    return cachedVertexAccessToken.token;
  }

  if (!googleAuth) {
    googleAuth = new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
  }
  const client = await googleAuth.getClient();
  const accessTokenResult = await client.getAccessToken();
  const token =
    typeof accessTokenResult === "string" ? accessTokenResult : accessTokenResult?.token || null;
  if (!token) {
    throw new Error(
      "無法取得 Vertex AI 存取權杖。請確認服務帳號憑證（GOOGLE_APPLICATION_CREDENTIALS）可用。",
    );
  }

  cachedVertexAccessToken = {
    token,
    expiresAt: now + 50 * 60 * 1000,
  };
  return token;
};

export async function getGoogleAiAuthHeaders(): Promise<Record<string, string>> {
  const provider = resolveGoogleAiProvider();
  if (provider.provider === "aistudio") {
    return {
      "x-goog-api-key": getAiStudioApiKey(),
    };
  }

  const vertexApiKey = getVertexApiKey();
  if (vertexApiKey) {
    return {
      "x-goog-api-key": vertexApiKey,
    };
  }

  const accessToken = await getVertexAccessToken();
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

export const buildGoogleAiModelEndpoint = (model: string, method: string): string => {
  const provider = resolveGoogleAiProvider();
  const normalizedModel = normalizeGoogleModelName(model);
  if (!normalizedModel) {
    throw new Error("模型名稱不可為空。");
  }

  if (provider.provider === "vertex") {
    const baseUrl = `https://${provider.vertexLocation}-aiplatform.googleapis.com`;
    return (
      `${baseUrl}/${provider.vertexApiVersion}/projects/${encodeURIComponent(provider.vertexProjectId || "")}` +
      `/locations/${encodeURIComponent(provider.vertexLocation || "")}` +
      `/publishers/google/models/${encodeURIComponent(normalizedModel)}:${method}`
    );
  }

  return `${AI_STUDIO_BASE_URL}/v1beta/models/${encodeURIComponent(normalizedModel)}:${method}`;
};

export const buildGoogleAiModelsListEndpoint = (pageToken?: string): string => {
  const provider = resolveGoogleAiProvider();
  if (provider.provider === "vertex") {
    const baseUrl = `https://${provider.vertexLocation}-aiplatform.googleapis.com`;
    return (
      `${baseUrl}/${provider.vertexApiVersion}/projects/${encodeURIComponent(provider.vertexProjectId || "")}` +
      `/locations/${encodeURIComponent(provider.vertexLocation || "")}/publishers/google/models` +
      (pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : "")
    );
  }
  return `${AI_STUDIO_BASE_URL}/v1beta/models` + (pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : "");
};

export const buildGoogleAiOperationEndpoint = (operationName: string): string => {
  const provider = resolveGoogleAiProvider();
  const normalized = normalizeOperationName(operationName);
  if (provider.provider === "vertex") {
    const baseUrl = `https://${provider.vertexLocation}-aiplatform.googleapis.com`;
    return `${baseUrl}/${provider.vertexApiVersion}/${normalized}`;
  }
  return `${AI_STUDIO_BASE_URL}/v1beta/${normalized}`;
};

export const isGoogleAiCredentialErrorMessage = (message: string): boolean =>
  /gemini_api_key|vertex|api key|access token|credential|service account|authentication|authorization/i.test(
    message,
  );
