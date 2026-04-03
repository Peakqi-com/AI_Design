import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "./Button";
import {
  Download,
  Film,
  Maximize2,
  Pause,
  Play,
  RefreshCw,
  Settings,
  Upload,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from "lucide-react";
import { resolveClientUserScopeId } from "@/lib/client/user-scope";

type Mode = "image-to-video";
type Style = "japanese" | "industrial" | "modern" | "luxury";
type CameraMotion = "dolly-in" | "pan-right" | "orbit" | "panorama-tour";
type AspectRatio = "9:16" | "1:1" | "4:3" | "16:9";
type SourceFrameMode = "fill" | "original";

interface GeneratedVideoItem {
  id: string;
  videoUrl: string;
  mode: Mode;
  style: Style;
  aspectRatio: AspectRatio;
  sourceType: "image" | "text";
  createdAt: string;
  durationSec: number;
  prompt?: string;
  metaText?: string;
}

interface VeoStartResponse {
  operationName: string;
  model: string;
  remainingCredits?: number | null;
  costDeducted?: number;
}

interface VeoStatusResponse {
  done: boolean;
  operationName: string;
  videoUri?: string;
  videoGcsUri?: string;
  error?: string;
}

interface VeoCancelResponse {
  operationName: string;
  cancelled: boolean;
  message?: string;
}

interface PendingVeoJob {
  userId: string;
  operationName: string;
  model: string;
  mode: Mode;
  style: Style;
  aspectRatio: AspectRatio;
  sourceType: "image" | "text";
  cameraMotion: CameraMotion;
  usePanoramaExpand: boolean;
  frameMode?: SourceFrameMode;
  prompt: string;
  durationSec: number;
  createdAt: string;
  keyframeModel?: string;
}

type PendingVeoJobMeta = Omit<PendingVeoJob, "userId" | "operationName" | "model" | "createdAt">;

interface SocialAssetApiItem {
  id: string;
  userId: string;
  kind: "image" | "video";
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  url: string;
  meta?: {
    mode?: string;
    style?: string;
    aspectRatio?: string;
    sourceType?: string;
    frameMode?: string;
    durationSec?: number;
    prompt?: string;
    summary?: string;
  };
}

interface SocialAssetListResponse {
  items?: SocialAssetApiItem[];
}

interface SocialAssetSaveResponse {
  item?: SocialAssetApiItem;
}

const STYLE_FILTERS: Record<Style, string> = {
  japanese: "brightness(1.06) contrast(1.02) saturate(0.92) sepia(0.12)",
  industrial: "brightness(0.92) contrast(1.16) saturate(0.78)",
  modern: "brightness(1.03) contrast(1.08) saturate(1.03)",
  luxury: "brightness(1.02) contrast(1.12) saturate(1.16)",
};

const STYLE_LABELS: Record<Style, string> = {
  japanese: "柔和日系",
  industrial: "電影對比",
  modern: "都會極簡",
  luxury: "高級精品",
};

const STYLE_PROMPTS: Record<Style, string> = {
  japanese: "柔和光感、自然膚色、乾淨色調，適合社群內容",
  industrial: "高對比光影、情緒色調、故事感鏡頭",
  modern: "中性色調、俐落構圖、時尚社群視覺",
  luxury: "高質感細節、層次燈光、精品廣告感",
};

const CAMERA_LABELS: Record<CameraMotion, string> = {
  "dolly-in": "Dolly In（向前推進）",
  "pan-right": "Pan Right（向右平移）",
  orbit: "Orbit（環繞式）",
  "panorama-tour": "Panorama Cruise（環景巡航）",
};

const ASPECT_RATIO_LABELS: Record<AspectRatio, string> = {
  "9:16": "9:16（Reels / TikTok）",
  "1:1": "1:1（Feed 方形）",
  "4:3": "4:3（Classic）",
  "16:9": "16:9（YouTube / 橫幅）",
};

const SOURCE_FRAME_MODE_OPTIONS: SourceFrameMode[] = ["fill", "original"];

const SOURCE_FRAME_MODE_LABELS: Record<SourceFrameMode, string> = {
  fill: "填滿版（人物更大）",
  original: "保留原比例（完整畫面）",
};

const SOURCE_FRAME_MODE_HINTS: Record<SourceFrameMode, string> = {
  fill: "會依輸出比例裁切背景，讓主體在畫面中更飽滿。",
  original: "完整保留原圖比例，不裁切主體；系統會自動補齊畫幅。",
};

const VEO_MODEL_OPTIONS = [
  { value: "xai/grok-imagine-video", label: "Grok Imagine Video（Replicate）" },
];

const MAX_FILE_MB = 80;
const CANVAS_MAX_EDGE = 1280;
const VIDEO_FPS = 30;
const VEO_DIRECT_BLOB_LIMIT_BYTES = 2_400_000;
const VEO_REQUEST_SOFT_LIMIT_BYTES = 3_200_000;
const VEO_REQUEST_HARD_LIMIT_BYTES = 4_000_000;
const VEO_OPTIMIZED_MAX_EDGE = 1600;
const VEO_OPTIMIZED_MIN_EDGE = 1120;
const VEO_POLL_INTERVAL_MS = 3000;
const VEO_MAX_WAIT_MS = 45 * 60 * 1000;
const PENDING_VEO_JOB_KEY_PREFIX = "aiinterior:video-pending:";
const VIDEO_HISTORY_CACHE_KEY_PREFIX = "aiinterior:video-history:";
const ASPECT_RATIO_VALUES: Record<AspectRatio, number> = {
  "9:16": 9 / 16,
  "1:1": 1,
  "4:3": 4 / 3,
  "16:9": 16 / 9,
};

const DEFAULT_PREVIEW_RATIO = 16 / 9;

const fitFrameToViewport = (
  viewportWidth: number,
  viewportHeight: number,
  aspectValue: number,
): { width: number; height: number } => {
  if (viewportWidth <= 0 || viewportHeight <= 0 || aspectValue <= 0) {
    return { width: 0, height: 0 };
  }
  const viewportRatio = viewportWidth / viewportHeight;
  if (viewportRatio > aspectValue) {
    const height = viewportHeight;
    return { width: Math.round(height * aspectValue), height: Math.round(height) };
  }
  const width = viewportWidth;
  return { width: Math.round(width), height: Math.round(width / aspectValue) };
};

const toCssAspectRatio = (ratio: AspectRatio): string => ratio.replace(":", " / ");

const SAMPLE_IMAGE_URL =
  "https://images.unsplash.com/photo-1519389950473-47ba0277781c?q=80&w=1920&auto=format&fit=crop";

const waitAnimationFrame = (): Promise<number> =>
  new Promise((resolve) => requestAnimationFrame(resolve));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const sleepWithAbort = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("ABORTED"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("ABORTED"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

interface ApiErrorPayload {
  error?: string;
  code?: string;
  hints?: string[];
  supportSummary?: string;
  remainingCredits?: number;
  requiredCredits?: number;
}

interface CreditStatusResponse {
  remainingCredits: number | null;
  shouldEnforce: boolean;
  costs?: {
    image?: number;
    video?: number;
  };
  upgradeMessage?: string;
}

class ApiRequestError extends Error {
  code?: string;
  hints?: string[];
  supportSummary?: string;
  remainingCredits?: number;
  requiredCredits?: number;

  constructor(message: string, payload?: ApiErrorPayload) {
    super(message);
    this.name = "ApiRequestError";
    this.code = payload?.code;
    this.hints = payload?.hints;
    this.supportSummary = payload?.supportSummary;
    this.remainingCredits = payload?.remainingCredits;
    this.requiredCredits = payload?.requiredCredits;
  }
}

const tryParseJson = <T,>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const estimateDataUrlBytes = (dataUrl: string): number => {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) {
    return dataUrl.length;
  }
  const base64 = dataUrl.slice(comma + 1);
  return Math.floor((base64.length * 3) / 4);
};

const summarizeNonJsonResponse = (raw: string, status: number): string => {
  const normalized = raw.trim();
  if (/request entity too large|payload too large/i.test(normalized)) {
    return "請求內容過大（Request Entity Too Large），系統已嘗試壓縮素材。請改用更小圖片或降低解析度後重試。";
  }
  if (/<html|<!doctype/i.test(normalized)) {
    return `伺服器回傳 HTML 錯誤頁（HTTP ${status}），請稍後再試。`;
  }
  const snippet = normalized.slice(0, 180) || "empty response";
  return `伺服器回傳非 JSON 內容（HTTP ${status}）：${snippet}`;
};

const fileToDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("檔案讀取失敗"));
    reader.readAsDataURL(file);
  });

const imageBlobToOptimizedDataUrl = async (
  blob: Blob,
  targetAspectRatio: AspectRatio,
  frameMode: SourceFrameMode = "fill",
): Promise<string> => {
  const sourceUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImage(sourceUrl);
    const targetRatio = ASPECT_RATIO_VALUES[targetAspectRatio] || 9 / 16;

    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error("來源圖片尺寸無效。");
    }

    const canvas = document.createElement("canvas");
    if (frameMode === "fill") {
      let sourceWidth = image.naturalWidth;
      let sourceHeight = image.naturalHeight;
      const sourceRatio = sourceWidth / sourceHeight;
      if (sourceRatio > targetRatio) {
        sourceWidth = Math.round(sourceHeight * targetRatio);
      } else if (sourceRatio < targetRatio) {
        sourceHeight = Math.round(sourceWidth / targetRatio);
      }

      let width = sourceWidth;
      let height = sourceHeight;
      const maxEdge = Math.max(width, height);
      if (maxEdge > VEO_OPTIMIZED_MAX_EDGE) {
        const scale = VEO_OPTIMIZED_MAX_EDGE / maxEdge;
        width = Math.max(2, Math.round(width * scale));
        height = Math.max(2, Math.round(height * scale));
      }
      canvas.width = ensureEven(width);
      canvas.height = ensureEven(height);
    } else {
      const canvasHeight = VEO_OPTIMIZED_MAX_EDGE;
      const canvasWidth = Math.max(2, Math.round(canvasHeight * targetRatio));
      canvas.width = ensureEven(canvasWidth);
      canvas.height = ensureEven(canvasHeight);
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("無法初始化圖片壓縮引擎。");
    }

    if (frameMode === "fill") {
      const coverRatio = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
      const drawWidth = image.naturalWidth * coverRatio;
      const drawHeight = image.naturalHeight * coverRatio;
      const drawX = (canvas.width - drawWidth) / 2;
      const drawY = (canvas.height - drawHeight) / 2;
      ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    } else {
      // Keep the original source ratio in the foreground while filling the target frame.
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.filter = "blur(26px) brightness(0.62)";
      drawCover(ctx, image, canvas.width, canvas.height, 1.08);
      ctx.restore();

      const containRatio = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
      const drawWidth = image.naturalWidth * containRatio;
      const drawHeight = image.naturalHeight * containRatio;
      const drawX = (canvas.width - drawWidth) / 2;
      const drawY = (canvas.height - drawHeight) / 2;
      ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    }

    const qualitySteps = [0.9, 0.82, 0.74, 0.66, 0.58];
    let latest = canvas.toDataURL("image/jpeg", qualitySteps[0]);
    if (blob.size <= VEO_DIRECT_BLOB_LIMIT_BYTES && estimateDataUrlBytes(latest) <= VEO_REQUEST_SOFT_LIMIT_BYTES) {
      return latest;
    }
    for (const quality of qualitySteps) {
      const candidate = canvas.toDataURL("image/jpeg", quality);
      latest = candidate;
      if (estimateDataUrlBytes(candidate) <= VEO_REQUEST_SOFT_LIMIT_BYTES) {
        return candidate;
      }
    }

    const currentMaxEdge = Math.max(canvas.width, canvas.height);
    if (currentMaxEdge > VEO_OPTIMIZED_MIN_EDGE) {
      const secondScale = VEO_OPTIMIZED_MIN_EDGE / currentMaxEdge;
      const secondCanvas = document.createElement("canvas");
      secondCanvas.width = ensureEven(Math.max(2, Math.round(canvas.width * secondScale)));
      secondCanvas.height = ensureEven(Math.max(2, Math.round(canvas.height * secondScale)));
      const secondCtx = secondCanvas.getContext("2d");
      if (!secondCtx) {
        return latest;
      }
      secondCtx.drawImage(canvas, 0, 0, secondCanvas.width, secondCanvas.height);
      return secondCanvas.toDataURL("image/jpeg", 0.55);
    }

    return latest;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("圖片載入失敗"));
    image.src = src;
  });

const ensureEven = (value: number): number => {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
};

const calcCanvasSize = (sourceWidth: number, sourceHeight: number): { width: number; height: number } => {
  if (!sourceWidth || !sourceHeight) {
    return { width: 1280, height: 720 };
  }
  if (sourceWidth >= sourceHeight) {
    const width = CANVAS_MAX_EDGE;
    const height = ensureEven((sourceHeight / sourceWidth) * width);
    return { width, height };
  }
  const height = CANVAS_MAX_EDGE;
  const width = ensureEven((sourceWidth / sourceHeight) * height);
  return { width, height };
};

const drawCover = (
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLVideoElement,
  canvasWidth: number,
  canvasHeight: number,
  extraScale = 1,
  offsetX = 0,
  offsetY = 0,
) => {
  const sourceWidth = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const sourceHeight = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
  if (!sourceWidth || !sourceHeight) {
    return;
  }

  const coverRatio = Math.max(canvasWidth / sourceWidth, canvasHeight / sourceHeight) * extraScale;
  const drawWidth = sourceWidth * coverRatio;
  const drawHeight = sourceHeight * coverRatio;
  const drawX = (canvasWidth - drawWidth) / 2 + offsetX;
  const drawY = (canvasHeight - drawHeight) / 2 + offsetY;
  ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
};

const drawVignette = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const gradient = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.15,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.75,
  );
  gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0.18)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
};

const formatClock = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(whole / 60)).padStart(2, "0");
  const ss = String(whole % 60).padStart(2, "0");
  return `${mm}:${ss}`;
};

const formatFileDate = (date = new Date()): string => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

const getPreferredRecorderMime = (): string => {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return "";
  }
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
};

const requestJson = async <T,>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const raw = await response.text();
  const payload = raw ? tryParseJson<T & ApiErrorPayload>(raw) : null;
  if (!response.ok) {
    if (payload) {
      throw new ApiRequestError(payload.error || "Request failed", payload);
    }
    const message = summarizeNonJsonResponse(raw, response.status);
    throw new ApiRequestError(message, { error: message, code: "NON_JSON_RESPONSE" });
  }
  if (!raw) {
    return {} as T;
  }
  if (!payload) {
    const message = summarizeNonJsonResponse(raw, response.status);
    throw new ApiRequestError(message, { error: message, code: "NON_JSON_RESPONSE" });
  }
  return payload;
};

const isBlobUrl = (url: string): boolean => url.startsWith("blob:");

const pendingJobStorageKey = (userId: string): string => `${PENDING_VEO_JOB_KEY_PREFIX}${userId}`;

const readPendingVeoJob = (userId: string): PendingVeoJob | null => {
  if (typeof window === "undefined" || !userId) {
    return null;
  }
  const raw = window.localStorage.getItem(pendingJobStorageKey(userId));
  if (!raw) {
    return null;
  }
  const parsed = tryParseJson<PendingVeoJob>(raw);
  if (!parsed || !parsed.operationName || parsed.userId !== userId) {
    return null;
  }
  return parsed;
};

const writePendingVeoJob = (job: PendingVeoJob): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(pendingJobStorageKey(job.userId), JSON.stringify(job));
};

const clearPendingVeoJob = (userId: string): void => {
  if (typeof window === "undefined" || !userId) {
    return;
  }
  window.localStorage.removeItem(pendingJobStorageKey(userId));
};

const videoHistoryStorageKey = (userId: string): string => `${VIDEO_HISTORY_CACHE_KEY_PREFIX}${userId}`;

const readVideoHistoryCache = (userId: string): GeneratedVideoItem[] => {
  if (typeof window === "undefined" || !userId) {
    return [];
  }
  const raw = window.localStorage.getItem(videoHistoryStorageKey(userId));
  if (!raw) {
    return [];
  }
  const parsed = tryParseJson<GeneratedVideoItem[]>(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .filter(
      (item) =>
        Boolean(item?.id) &&
        Boolean(item?.videoUrl) &&
        !isBlobUrl(String(item.videoUrl)) &&
        (item.sourceType === "image" || item.sourceType === "text"),
    )
    .slice(0, 8);
};

const writeVideoHistoryCache = (userId: string, items: GeneratedVideoItem[]): void => {
  if (typeof window === "undefined" || !userId) {
    return;
  }
  const persistable = items.filter((item) => !isBlobUrl(item.videoUrl)).slice(0, 8);
  window.localStorage.setItem(videoHistoryStorageKey(userId), JSON.stringify(persistable));
};

export const VideoStudio: React.FC = () => {
  const { data: session } = useSession();

  const mode: Mode = "image-to-video";
  const [selectedStyle, setSelectedStyle] = useState<Style>("japanese");
  const [cameraMotion, setCameraMotion] = useState<CameraMotion>("dolly-in");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [sourceFrameMode, setSourceFrameMode] = useState<SourceFrameMode>("fill");
  const [durationSec, setDurationSec] = useState(6);
  const [customPrompt, setCustomPrompt] = useState("");
  const usePanoramaExpand = false;
  const [useVideoModel, setUseVideoModel] = useState(true);
  const [videoModel, setVideoModel] = useState("xai/grok-imagine-video");
  const [videoResolution, setVideoResolution] = useState<"720p" | "1080p">("720p");
  const [userScopeId, setUserScopeId] = useState("guest_server");

  const [uploadedAssetUrl, setUploadedAssetUrl] = useState<string | null>(null);
  const [uploadedAssetKind, setUploadedAssetKind] = useState<"image" | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState("尚未上傳");

  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [resultMeta, setResultMeta] = useState<string>("");
  const [resultMimeType, setResultMimeType] = useState<string>("video/webm");
  const [history, setHistory] = useState<GeneratedVideoItem[]>([]);
  const [historyPreviewItem, setHistoryPreviewItem] = useState<GeneratedVideoItem | null>(null);
  const [historyPreviewVolume, setHistoryPreviewVolume] = useState(0.8);
  const [historyPreviewMuted, setHistoryPreviewMuted] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [generationStage, setGenerationStage] = useState("待命中");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [veoSupportHint, setVeoSupportHint] = useState<string | null>(null);
  const [creditStatus, setCreditStatus] = useState<CreditStatusResponse | null>(null);

  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrent, setVideoCurrent] = useState(0);
  const [previewFrameSize, setPreviewFrameSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const historyPreviewVideoRef = useRef<HTMLVideoElement>(null);
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const uploadedObjectUrlRef = useRef<string | null>(null);
  const allocatedResultUrlsRef = useRef<string[]>([]);
  const resumeLockRef = useRef(false);
  const lastResumeAttemptAtRef = useRef(0);
  const startRequestAbortRef = useRef<AbortController | null>(null);
  const pollingAbortRef = useRef<AbortController | null>(null);
  const activeOperationNameRef = useRef<string | null>(null);
  const stopRequestedRef = useRef(false);

  const removeBrokenVideo = useCallback((videoUrl: string) => {
    if (!videoUrl) {
      return;
    }
    setHistory((prev) => prev.filter((item) => item.videoUrl !== videoUrl));
    setResultVideoUrl((current) => (current === videoUrl ? null : current));
    setHistoryPreviewItem((current) => (current?.videoUrl === videoUrl ? null : current));
    setErrorMessage((current) => current ?? "偵測到無法播放的影片，已自動從歷史預覽中移除。");
  }, []);

  const resetResult = useCallback(() => {
    setResultVideoUrl(null);
    setResultMeta("");
    setVideoDuration(0);
    setVideoCurrent(0);
    setIsPlaying(false);
  }, []);

  const canGenerate = Boolean(uploadedAssetKind === "image" && uploadedAssetUrl);

  const activePreviewAspectValue = ASPECT_RATIO_VALUES[aspectRatio] || DEFAULT_PREVIEW_RATIO;
  const previewObjectFitClass = sourceFrameMode === "fill" ? "object-cover" : "object-contain";

  const releaseObjectUrl = useCallback((url: string) => {
    if (!isBlobUrl(url)) {
      return;
    }
    URL.revokeObjectURL(url);
    allocatedResultUrlsRef.current = allocatedResultUrlsRef.current.filter((item) => item !== url);
  }, []);

  const trimHistory = useCallback(
    (items: GeneratedVideoItem[]): GeneratedVideoItem[] => {
      if (items.length <= 8) {
        return items;
      }
      const kept = items.slice(0, 8);
      const dropped = items.slice(8);
      dropped.forEach((item) => releaseObjectUrl(item.videoUrl));
      return kept;
    },
    [releaseObjectUrl],
  );

  const areHistoryListsEqual = useCallback((a: GeneratedVideoItem[], b: GeneratedVideoItem[]): boolean => {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (a[i].id !== b[i].id || a[i].videoUrl !== b[i].videoUrl || a[i].createdAt !== b[i].createdAt) {
        return false;
      }
    }
    return true;
  }, []);

  const toGeneratedVideoItem = useCallback((asset: SocialAssetApiItem): GeneratedVideoItem => {
    const meta = asset.meta || {};
    const mode: Mode = "image-to-video";
    const style = (
      meta.style === "industrial" || meta.style === "modern" || meta.style === "luxury"
        ? meta.style
        : "japanese"
    ) as Style;
    const aspectRatio = (
      meta.aspectRatio === "1:1" || meta.aspectRatio === "16:9" || meta.aspectRatio === "4:3"
        ? meta.aspectRatio
        : "9:16"
    ) as AspectRatio;
    const sourceType = (meta.sourceType === "text" ? "text" : "image") as "image" | "text";
    return {
      id: asset.id,
      videoUrl: asset.url,
      mode,
      style,
      aspectRatio,
      sourceType,
      createdAt: asset.createdAt,
      durationSec: typeof meta.durationSec === "number" ? meta.durationSec : 8,
      prompt: typeof meta.prompt === "string" ? meta.prompt : "",
      metaText: typeof meta.summary === "string" ? meta.summary : "",
    };
  }, []);

  const persistHistoryToServer = useCallback(
    async (input: {
      blob: Blob;
      mimeType: string;
      mode: Mode;
      style: Style;
      aspectRatio: AspectRatio;
      sourceType: "image" | "text";
      durationSec: number;
      prompt: string;
      metaText: string;
    }): Promise<GeneratedVideoItem> => {
      if (!userScopeId) {
        throw new Error("使用者識別尚未就緒。");
      }
      const extension = input.mimeType.includes("webm") ? "webm" : "mp4";
      const formData = new FormData();
      formData.append(
        "file",
        new File([input.blob], `ai-social-video-${formatFileDate()}.${extension}`, {
          type: input.mimeType || "video/mp4",
        }),
      );
      formData.append("userId", userScopeId);
      formData.append("kind", "video");
      formData.append(
        "meta",
        JSON.stringify({
          origin: "video-studio",
          mode: input.mode,
          style: input.style,
          aspectRatio: input.aspectRatio,
          sourceType: input.sourceType,
          durationSec: input.durationSec,
          prompt: input.prompt,
          summary: input.metaText,
        }),
      );
      const response = await requestJson<SocialAssetSaveResponse>("/api/social/assets", {
        method: "POST",
        body: formData,
      });
      if (!response.item) {
        throw new Error("伺服器未回傳素材資料。");
      }
      return toGeneratedVideoItem(response.item);
    },
    [toGeneratedVideoItem, userScopeId],
  );

  const loadServerHistory = useCallback(async () => {
    if (!userScopeId) {
      return;
    }
    try {
      const payload = await requestJson<SocialAssetListResponse>(
        `/api/social/assets?userId=${encodeURIComponent(userScopeId)}&kind=video&limit=8`,
        { method: "GET" },
      );
      if (Array.isArray(payload.items)) {
        const next = trimHistory(payload.items.map(toGeneratedVideoItem));
        setHistory((prev) => {
          const unsyncedLocal = prev.filter(
            (item) => isBlobUrl(item.videoUrl) && !next.some((serverItem) => serverItem.id === item.id),
          );
          const merged = trimHistory([...next, ...unsyncedLocal]);
          // Keep existing previews when backend briefly returns an empty list.
          if (merged.length === 0 && prev.length > 0) {
            return prev;
          }
          return areHistoryListsEqual(prev, merged) ? prev : merged;
        });
      }
    } catch {
      // Ignore initial history load failures to avoid blocking generation flows.
    }
  }, [areHistoryListsEqual, toGeneratedVideoItem, trimHistory, userScopeId]);

  const loadCreditStatus = useCallback(async () => {
    if (!userScopeId) {
      return;
    }
    try {
      const payload = await requestJson<CreditStatusResponse>(
        `/api/account/credits?userId=${encodeURIComponent(userScopeId)}`,
        { method: "GET" },
      );
      setCreditStatus(payload);
    } catch {
      // Ignore credit status errors to keep generator usable.
    }
  }, [userScopeId]);

  const finalizeGeneratedVideo = useCallback(
    async (input: {
      outputBlob: Blob;
      outputMimeType: string;
      mode: Mode;
      style: Style;
      aspectRatio: AspectRatio;
      sourceType: "image" | "text";
      durationSec: number;
      prompt: string;
      metaText: string;
    }) => {
      const outputUrl = URL.createObjectURL(input.outputBlob);
      allocatedResultUrlsRef.current.push(outputUrl);
      setResultVideoUrl(outputUrl);
      setResultMimeType(input.outputMimeType);
      setProgress(100);
      setGenerationStage("生成完成");
      setResultMeta(input.metaText);

      const historyItem: GeneratedVideoItem = {
        id: `video_${Date.now()}`,
        videoUrl: outputUrl,
        mode: input.mode,
        style: input.style,
        aspectRatio: input.aspectRatio,
        sourceType: input.sourceType,
        createdAt: new Date().toISOString(),
        durationSec: input.durationSec,
        prompt: input.prompt,
        metaText: input.metaText,
      };

      setHistory((prev) => trimHistory([historyItem, ...prev]));

      let savedItem: GeneratedVideoItem | null = null;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          savedItem = await persistHistoryToServer({
            blob: input.outputBlob,
            mimeType: input.outputMimeType,
            mode: input.mode,
            style: input.style,
            aspectRatio: input.aspectRatio,
            sourceType: input.sourceType,
            durationSec: input.durationSec,
            prompt: input.prompt,
            metaText: input.metaText,
          });
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) {
            await sleep(450 * (attempt + 1));
          }
        }
      }

      if (savedItem) {
        setHistory((prev) => {
          const next = [savedItem!, ...prev.filter((item) => item.id !== historyItem.id && item.id !== savedItem!.id)];
          return trimHistory(next);
        });
        setResultMeta((current) => (current === input.metaText ? savedItem!.metaText || current : current));
        return;
      }

      setErrorMessage((current) =>
        current ??
        `${lastError instanceof Error ? lastError.message : "影片歷史儲存失敗"}（已保留本機歷史）`,
      );
    },
    [persistHistoryToServer, trimHistory],
  );

  const composeMetaText = useCallback(
    (input: {
      mode: Mode;
      style: Style;
      aspectRatio: AspectRatio;
      sourceType: "image" | "text";
      frameMode?: SourceFrameMode;
      cameraMotion: CameraMotion;
      usePanoramaExpand: boolean;
      durationSec: number;
      mimeType: string;
      keyframeModel?: string;
      videoModel?: string;
    }): string => {
      const metaParts = [
        "模式：圖轉影",
        `風格：${STYLE_LABELS[input.style]}`,
        `比例：${input.aspectRatio}`,
        `來源：${input.sourceType === "text" ? "文字描述" : "圖片素材"}`,
        input.sourceType === "image" ? `構圖：${SOURCE_FRAME_MODE_LABELS[input.frameMode || "fill"]}` : "",
        `運鏡：${CAMERA_LABELS[input.cameraMotion]}`,
        input.usePanoramaExpand ? "環景：已啟用" : "",
        `時長：${input.durationSec}s`,
        `解析：${input.mimeType}`,
      ].filter(Boolean);
      if (input.keyframeModel) {
        metaParts.push(`關鍵幀：${input.keyframeModel}`);
      }
      if (input.videoModel) {
        metaParts.push(`影片模型：${input.videoModel}`);
      }
      return metaParts.join(" · ");
    },
    [],
  );

  const replaceUploadedAsset = useCallback(
    (nextUrl: string, kind: "image", fileName: string, keepForCleanup = false) => {
      if (uploadedObjectUrlRef.current) {
        URL.revokeObjectURL(uploadedObjectUrlRef.current);
        uploadedObjectUrlRef.current = null;
      }
      if (!keepForCleanup) {
        uploadedObjectUrlRef.current = nextUrl;
      }
      setUploadedAssetUrl(nextUrl);
      setUploadedAssetKind(kind);
      setUploadedFileName(fileName);
      resetResult();
      setErrorMessage(null);
      setVeoSupportHint(null);
    },
    [resetResult],
  );

  const cleanupAllUrls = useCallback(() => {
    if (uploadedObjectUrlRef.current) {
      URL.revokeObjectURL(uploadedObjectUrlRef.current);
      uploadedObjectUrlRef.current = null;
    }
    allocatedResultUrlsRef.current.filter(isBlobUrl).forEach((url) => URL.revokeObjectURL(url));
    allocatedResultUrlsRef.current = [];
  }, []);

  useEffect(() => cleanupAllUrls, [cleanupAllUrls]);

  const clearActiveRequests = useCallback(() => {
    startRequestAbortRef.current?.abort();
    pollingAbortRef.current?.abort();
    startRequestAbortRef.current = null;
    pollingAbortRef.current = null;
  }, []);

  useEffect(
    () => () => {
      clearActiveRequests();
    },
    [clearActiveRequests],
  );

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video) {
      return;
    }

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => setVideoCurrent(video.currentTime || 0);
    const onLoaded = () => {
      setVideoDuration(video.duration || 0);
      setVideoCurrent(0);
    };
    const onError = () => {
      if (resultVideoUrl) {
        removeBrokenVideo(resultVideoUrl);
      }
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("error", onError);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
  }, [removeBrokenVideo, resultVideoUrl]);

  useEffect(() => {
    const viewport = previewViewportRef.current;
    if (!viewport) {
      return;
    }

    const updateFrame = () => {
      const rect = viewport.getBoundingClientRect();
      const horizontalPadding = 24;
      const verticalPadding = 24;
      const availableWidth = Math.max(0, rect.width - horizontalPadding);
      const availableHeight = Math.max(0, rect.height - verticalPadding);
      const fitted = fitFrameToViewport(availableWidth, availableHeight, activePreviewAspectValue);
      setPreviewFrameSize((prev) =>
        prev.width === fitted.width && prev.height === fitted.height ? prev : fitted,
      );
    };

    updateFrame();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateFrame);
      observer.observe(viewport);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateFrame);
    return () => window.removeEventListener("resize", updateFrame);
  }, [activePreviewAspectValue]);

  useEffect(() => {
    const sessionUser = session?.user as { id?: string; email?: string | null } | undefined;
    setUserScopeId(resolveClientUserScopeId(sessionUser?.id || null, sessionUser?.email || null));
  }, [session?.user]);

  useEffect(() => {
    if (!userScopeId) {
      return;
    }
    const cached = readVideoHistoryCache(userScopeId);
    if (cached.length === 0) {
      return;
    }
    setHistory((prev) => (prev.length > 0 ? prev : trimHistory(cached)));
  }, [trimHistory, userScopeId]);

  useEffect(() => {
    if (!userScopeId) {
      return;
    }
    writeVideoHistoryCache(userScopeId, history);
  }, [history, userScopeId]);

  useEffect(() => {
    if (!resultVideoUrl) {
      return;
    }
    if (!history.some((item) => item.videoUrl === resultVideoUrl)) {
      setResultVideoUrl(null);
    }
  }, [history, resultVideoUrl]);

  useEffect(() => {
    void loadServerHistory();
  }, [loadServerHistory]);

  useEffect(() => {
    void loadCreditStatus();
  }, [loadCreditStatus]);

  const resumePendingVeoJob = useCallback(
    async (job: PendingVeoJob) => {
      setErrorMessage(null);
      setVeoSupportHint(null);
      setGenerationStage("偵測到背景任務，正在續跑...");
      setProgress(18);
      setIsGenerating(true);
      try {
        activeOperationNameRef.current = job.operationName;
        const pollingController = new AbortController();
        pollingAbortRef.current = pollingController;
        const generated = await waitForVeoOperationResult(
          {
            operationName: job.operationName,
            model: job.model,
          },
          { signal: pollingController.signal },
        );
        const metaText = composeMetaText({
          mode: job.mode,
          style: job.style,
          aspectRatio: job.aspectRatio,
          sourceType: job.sourceType,
          frameMode: job.frameMode || "fill",
          cameraMotion: job.cameraMotion,
          usePanoramaExpand: job.usePanoramaExpand,
          durationSec: generated.durationSec || job.durationSec || 8,
          mimeType: generated.blob.type || generated.mimeType,
          keyframeModel: job.keyframeModel,
          videoModel: generated.model,
        });
        await finalizeGeneratedVideo({
          outputBlob: generated.blob,
          outputMimeType: generated.mimeType,
          mode: job.mode,
          style: job.style,
          aspectRatio: job.aspectRatio,
          sourceType: job.sourceType,
          durationSec: generated.durationSec || job.durationSec || 8,
          prompt: job.prompt,
          metaText,
        });
      } catch (error) {
        if (error instanceof ApiRequestError && error.code === "VEO_CANCELLED_BY_USER") {
          setGenerationStage("已停止生成");
          return;
        }
        if (error instanceof ApiRequestError && error.code === "VEO_STILL_RUNNING") {
          setGenerationStage("背景任務仍在進行");
          setErrorMessage(error.message);
          return;
        }
        clearPendingVeoJob(job.userId);
        setGenerationStage("生成失敗");
        setErrorMessage(error instanceof Error ? error.message : "背景任務續跑失敗，請稍後再試。");
      } finally {
        setTimeout(() => {
          setIsGenerating(false);
          setProgress(0);
        }, 180);
        activeOperationNameRef.current = null;
        pollingAbortRef.current = null;
      }
    },
    [composeMetaText, finalizeGeneratedVideo, waitForVeoOperationResult],
  );

  useEffect(() => {
    if (!userScopeId || isGenerating || resumeLockRef.current) {
      return;
    }
    if (Date.now() - lastResumeAttemptAtRef.current < 15000) {
      return;
    }
    const pending = readPendingVeoJob(userScopeId);
    if (!pending) {
      return;
    }
    lastResumeAttemptAtRef.current = Date.now();
    resumeLockRef.current = true;
    void resumePendingVeoJob(pending).finally(() => {
      resumeLockRef.current = false;
    });
  }, [isGenerating, resumePendingVeoJob, userScopeId]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const maxBytes = MAX_FILE_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      setErrorMessage(`檔案過大，請上傳小於 ${MAX_FILE_MB}MB 的素材。`);
      event.target.value = "";
      return;
    }

    if (!file.type.startsWith("image/")) {
      setErrorMessage("目前僅支援圖生影片，請上傳圖片檔（JPG/PNG/WebP）。");
      event.target.value = "";
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    replaceUploadedAsset(objectUrl, "image", file.name);
    event.target.value = "";
  };

  const handleUseSample = async () => {
    try {
      setErrorMessage(null);
      const response = await fetch(SAMPLE_IMAGE_URL);
      if (!response.ok) {
        throw new Error("載入範例圖片失敗");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      replaceUploadedAsset(objectUrl, "image", "sample-social-shot.jpg");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "載入範例圖片失敗");
    }
  };

  const requestVeoCancel = useCallback(
    async (operationName: string): Promise<VeoCancelResponse> =>
      requestJson<VeoCancelResponse>("/api/ai/video/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ operationName }),
      }),
    [],
  );

  const handleStopGeneration = useCallback(async () => {
    if (!isGenerating && !activeOperationNameRef.current) {
      return;
    }
    setIsStopping(true);
    stopRequestedRef.current = true;
    clearActiveRequests();
    setGenerationStage("正在停止生成...");

    const operationName = activeOperationNameRef.current || readPendingVeoJob(userScopeId)?.operationName;
    if (operationName) {
      try {
        await requestVeoCancel(operationName);
      } catch {
        // Ignore cancel API failures; generation loop is already aborted locally.
      }
    }

    activeOperationNameRef.current = null;
    clearPendingVeoJob(userScopeId);
    setGenerationStage("已停止生成");
    setErrorMessage("你已手動停止生成，已送出取消請求。");
    setProgress(0);
    setIsGenerating(false);
    setIsStopping(false);
  }, [clearActiveRequests, isGenerating, requestVeoCancel, userScopeId]);

  const buildVeoPrompt = (input: { frameMode?: SourceFrameMode }): string => {
    const extraRequirement = customPrompt.trim();
    const hasExtraRequirement = Boolean(extraRequirement);
    const cameraInstruction =
      cameraMotion === "dolly-in"
        ? "cinematic dolly in toward key subject, smooth and stable camera"
        : cameraMotion === "pan-right"
          ? "smooth right pan across scene, stable movement"
          : cameraMotion === "orbit"
            ? "cinematic orbit camera around main subject with real parallax"
            : "panorama cruise from left to right with immersive scene traversal and natural parallax";

    const sourceConstraint = [
      "use the uploaded reference image as source of truth",
      "preserve the same room geometry, perspective, furniture scale and material logic",
      "keep one coherent continuous shot and avoid still-photo overlays",
      input.frameMode === "original"
        ? "keep full room framing and preserve original source composition without aggressive crop"
        : "fill the target frame naturally while keeping key space zones fully visible",
      "no added people, no duplicated subjects, no scene switch, no geometry drift",
      hasExtraRequirement
        ? "apply only the explicit extra requirement; keep all non-mentioned parts unchanged"
        : "do not redesign unrelated areas; preserve the original appearance exactly",
    ].join(", ");

    return [
      `風格：${STYLE_PROMPTS[selectedStyle]}`,
      `鏡頭運動：${cameraInstruction}`,
      sourceConstraint,
      "edge-to-edge full-frame composition with no black bars or blank margins",
      "high quality cinematic social short video, photorealistic details, clean edges, stable geometry, no warping, no jitter",
      hasExtraRequirement ? `extra requirement: ${extraRequirement}` : "",
    ]
      .filter(Boolean)
      .join(". ");
  };

  async function waitForVeoOperationResult(
    start: VeoStartResponse,
    options?: { signal?: AbortSignal },
  ): Promise<{ blob: Blob; mimeType: string; model: string; durationSec: number }> {
    const throwCancelled = () => {
      throw new ApiRequestError("已停止生成。", { code: "VEO_CANCELLED_BY_USER" });
    };

    const startedAt = Date.now();
    while (Date.now() - startedAt < VEO_MAX_WAIT_MS) {
      if (stopRequestedRef.current || options?.signal?.aborted) {
        throwCancelled();
      }
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      setGenerationStage(`Replicate 影片生成中（已等待 ${elapsedSec}s）`);
      const progressRatio = Math.min(1, (Date.now() - startedAt) / VEO_MAX_WAIT_MS);
      setProgress((prev) => Math.min(96, Math.max(prev, 24 + Math.round(progressRatio * 68))));

      const status = await requestJson<VeoStatusResponse>(
        `/api/ai/video/status?operationName=${encodeURIComponent(start.operationName)}`,
        { method: "GET", signal: options?.signal },
      );

      if (status.error) {
        clearPendingVeoJob(userScopeId);
        throw new Error(status.error);
      }

      if (status.done) {
        clearPendingVeoJob(userScopeId);
        const downloadUri = status.videoUri || status.videoGcsUri;
        if (!downloadUri) {
          throw new Error("影片任務已完成，但沒有回傳影片位址。");
        }
        setGenerationStage("下載影片中...");
        const downloadResponse = await fetch(
          `/api/ai/video/download?videoUri=${encodeURIComponent(downloadUri)}`,
          { signal: options?.signal },
        );
        if (!downloadResponse.ok) {
          const maybeError = await downloadResponse.text();
          const json = tryParseJson<{ error?: string }>(maybeError);
          const fallback = maybeError.trim().slice(0, 160);
          throw new Error(json?.error || fallback || "下載影片失敗");
        }
        const blob = await downloadResponse.blob();
        return {
          blob,
          mimeType: blob.type || "video/mp4",
          model: start.model,
          durationSec: 8,
        };
      }

      try {
        await sleepWithAbort(VEO_POLL_INTERVAL_MS, options?.signal);
      } catch {
        throwCancelled();
      }
    }

    throw new ApiRequestError("影片任務仍在背景處理，稍後回到本頁會自動續跑。", {
      code: "VEO_STILL_RUNNING",
    });
  }

  const generateImageToVideoByModel = async (input: {
    sourceImageUrl: string;
    pendingJobMeta: PendingVeoJobMeta;
  }): Promise<{ blob: Blob; mimeType: string; model: string; durationSec: number }> => {
    let imageDataUrl: string | undefined;
    const sourceBlob = await fetch(input.sourceImageUrl).then((response) => response.blob());
    setGenerationStage(
      sourceFrameMode === "fill"
        ? "正在等比例放大並滿版處理參考圖..."
        : "正在保留原比例並補齊畫幅處理參考圖...",
    );
    setProgress((prev) => Math.max(prev, 14));
    imageDataUrl = await imageBlobToOptimizedDataUrl(sourceBlob, aspectRatio, sourceFrameMode);
    const requestBytes = estimateDataUrlBytes(imageDataUrl);
    if (requestBytes > VEO_REQUEST_HARD_LIMIT_BYTES) {
      throw new Error("圖片資料仍過大，請改用較小圖片或先降低解析度後再試。");
    }

    setGenerationStage("提交 Replicate 影片任務...");
    setProgress((prev) => Math.max(prev, 18));

    const startController = new AbortController();
    startRequestAbortRef.current = startController;
    let start: VeoStartResponse;
    try {
      start = await requestJson<VeoStartResponse>("/api/ai/video/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: startController.signal,
        body: JSON.stringify({
          userId: userScopeId,
          imageDataUrl,
          model: videoModel,
          aspectRatio,
          resolution: videoResolution,
          durationSec,
          negativePrompt:
          "blurry, jitter, distorted geometry, warped lines, low quality, subject drift, identity change, face replacement, face regeneration, different face, body proportion change, scene switch, duplicated person, added person, still photo overlay, frame collage, black bars, letterboxing, pillarboxing, empty margins, unrequested outfit change, unrequested wardrobe redesign",
          prompt: buildVeoPrompt({
            frameMode: sourceFrameMode,
          }),
        }),
      });
    } finally {
      startRequestAbortRef.current = null;
    }

    if (stopRequestedRef.current) {
      throw new ApiRequestError("已停止生成。", { code: "VEO_CANCELLED_BY_USER" });
    }
    if (typeof start.remainingCredits === "number") {
      const remainingCredits = start.remainingCredits;
      setCreditStatus((prev) =>
        prev
          ? { ...prev, remainingCredits }
          : {
              remainingCredits,
              shouldEnforce: true,
              costs: { video: 20, image: 1 },
              upgradeMessage: "點數不足，請開啟付費會員功能。",
            },
      );
    }
    activeOperationNameRef.current = start.operationName;

    writePendingVeoJob({
      ...input.pendingJobMeta,
      userId: userScopeId,
      operationName: start.operationName,
      model: start.model,
      createdAt: new Date().toISOString(),
    });

    const pollingController = new AbortController();
    pollingAbortRef.current = pollingController;
    try {
      return await waitForVeoOperationResult(start, { signal: pollingController.signal });
    } finally {
      pollingAbortRef.current = null;
    }
  };

  const buildMediaRecorder = (
    stream: MediaStream,
  ): { recorder: MediaRecorder; mimeType: string } => {
    if (typeof MediaRecorder === "undefined") {
      throw new Error("此瀏覽器不支援影片輸出（MediaRecorder）。建議使用 Chrome 或 Edge。");
    }

    const mimeType = getPreferredRecorderMime();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    return { recorder, mimeType: mimeType || recorder.mimeType || "video/webm" };
  };

  const createRecordedBlob = async (
    canvas: HTMLCanvasElement,
    durationMs: number,
    draw: (progressRate: number, elapsedMs: number) => void,
    stageText: string,
  ): Promise<{ blob: Blob; mimeType: string }> => {
    const stream = canvas.captureStream(VIDEO_FPS);
    const { recorder, mimeType } = buildMediaRecorder(stream);
    const chunks: BlobPart[] = [];

    const stopped = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = () => reject(new Error("影片錄製發生錯誤"));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || "video/webm" }));
    });

    recorder.start(200);
    setGenerationStage(stageText);

    const startedAt = performance.now();
    while (true) {
      const elapsedMs = performance.now() - startedAt;
      const progressRate = Math.min(1, elapsedMs / durationMs);
      draw(progressRate, elapsedMs);
      setProgress(Math.round(progressRate * 100));
      if (progressRate >= 1) {
        break;
      }
      await waitAnimationFrame();
    }

    recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    const blob = await stopped;
    return { blob, mimeType };
  };

  const generateImageTour = async (
    sourceImageUrl: string,
    options?: { preferPanorama?: boolean },
  ): Promise<{ blob: Blob; mimeType: string }> => {
    const image = await loadImage(sourceImageUrl);
    const { width, height } = calcCanvasSize(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = ensureEven(width);
    canvas.height = ensureEven(height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("無法初始化影像引擎");
    }

    const durationMs = Math.max(3, Math.min(12, durationSec)) * 1000;
    const sourceAspect = image.naturalWidth / image.naturalHeight;
    const hasPanoramaSource = sourceAspect >= 1.7;
    const panoramaMode =
      cameraMotion === "panorama-tour" || Boolean(options?.preferPanorama && hasPanoramaSource);

    return createRecordedBlob(canvas, durationMs, (progressRate) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.filter = STYLE_FILTERS[selectedStyle];

      if (panoramaMode) {
        const fitByHeight = canvas.height / image.naturalHeight;
        const drawHeight = image.naturalHeight * fitByHeight;
        const drawWidth = image.naturalWidth * fitByHeight;
        const maxPan = Math.max(0, drawWidth - canvas.width);
        const panX = maxPan * progressRate;
        const tinyZoom = 1 + 0.025 * progressRate;
        const scaledWidth = drawWidth * tinyZoom;
        const scaledHeight = drawHeight * tinyZoom;
        const centerShiftX = (scaledWidth - drawWidth) / 2;
        const centerShiftY = (scaledHeight - drawHeight) / 2;
        const drawX = -panX - centerShiftX;
        const drawY = (canvas.height - scaledHeight) / 2 - centerShiftY * 0.3;

        ctx.drawImage(image, drawX, drawY, scaledWidth, scaledHeight);
      } else {
        let scale = 1.08;
        let offsetX = 0;
        let offsetY = 0;
        if (cameraMotion === "dolly-in") {
          scale = 1 + 0.18 * progressRate;
        } else if (cameraMotion === "pan-right") {
          scale = 1.12;
          offsetX = (progressRate - 0.5) * canvas.width * 0.18;
        } else {
          scale = 1.1 + Math.sin(progressRate * Math.PI * 2) * 0.035;
          offsetX = Math.sin(progressRate * Math.PI * 2) * canvas.width * 0.05;
          offsetY = Math.cos(progressRate * Math.PI * 2) * canvas.height * 0.03;
        }

        drawCover(ctx, image, canvas.width, canvas.height, scale, offsetX, offsetY);
      }

      ctx.filter = "none";
      drawVignette(ctx, canvas.width, canvas.height);
    }, "正在生成 AI 社群短影音...");
  };

  const handleGenerate = async () => {
    if (isGenerating) {
      return;
    }
    if (
      creditStatus?.shouldEnforce &&
      typeof creditStatus.remainingCredits === "number" &&
      creditStatus.remainingCredits < (creditStatus.costs?.video ?? 20)
    ) {
      setErrorMessage(creditStatus.upgradeMessage || "點數不足，請開啟付費會員功能。");
      return;
    }

    stopRequestedRef.current = false;
    activeOperationNameRef.current = null;
    clearActiveRequests();
    setIsGenerating(true);
    setIsStopping(false);
    setProgress(0);
    setErrorMessage(null);
    setVeoSupportHint(null);
    setGenerationStage("初始化中...");
    setIsPlaying(false);

    try {
      let outputBlob: Blob;
      let outputMimeType = "video/webm";
      let appliedDuration = durationSec;
      let usedAiKeyframeModel = "";
      let usedVideoModel = "";
      let sourceType: "image" | "text" = "image";

      if (uploadedAssetKind && uploadedAssetKind !== "image") {
        throw new Error("目前僅支援圖生影片，請上傳圖片。");
      }
      if (!uploadedAssetUrl) {
        throw new Error("請先上傳圖片，提示詞僅作輔助，無法單獨生成影片。");
      }

      const sourceForMotion = uploadedAssetKind === "image" ? uploadedAssetUrl : null;
      sourceType = "image";
      if (useVideoModel) {
        if (!sourceForMotion) {
          throw new Error("請先上傳圖片後再使用影片模型生成。");
        }
        const generated = await generateImageToVideoByModel({
          sourceImageUrl: sourceForMotion,
          pendingJobMeta: {
            mode,
            style: selectedStyle,
            aspectRatio,
            sourceType,
            frameMode: sourceFrameMode,
            cameraMotion,
            usePanoramaExpand,
            prompt: customPrompt.trim(),
            durationSec: durationSec,
            keyframeModel: usedAiKeyframeModel || undefined,
          },
        });
        outputBlob = generated.blob;
        outputMimeType = generated.mimeType;
        appliedDuration = generated.durationSec;
        usedVideoModel = generated.model;
      } else {
        if (!sourceForMotion) {
          throw new Error("請先上傳圖片後再生成影片。");
        }
        const generated = await generateImageTour(sourceForMotion, {
          preferPanorama: false,
        });
        outputBlob = generated.blob;
        outputMimeType = generated.mimeType;
      }

      const mergedMetaText = composeMetaText({
        mode,
        style: selectedStyle,
        aspectRatio,
        sourceType,
        frameMode: sourceFrameMode,
        cameraMotion,
        usePanoramaExpand,
        durationSec: appliedDuration,
        mimeType: outputBlob.type || outputMimeType,
        keyframeModel: usedAiKeyframeModel || undefined,
        videoModel: usedVideoModel || undefined,
      });

      await finalizeGeneratedVideo({
        outputBlob,
        outputMimeType,
        mode,
        style: selectedStyle,
        aspectRatio,
        sourceType,
        durationSec: appliedDuration,
        prompt: customPrompt.trim(),
        metaText: mergedMetaText,
      });
    } catch (error) {
      const isAbortLike =
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && /aborted/i.test(error.message));
      if (
        isAbortLike ||
        (error instanceof ApiRequestError && error.code === "VEO_CANCELLED_BY_USER")
      ) {
        clearPendingVeoJob(userScopeId);
        setGenerationStage("已停止生成");
        setErrorMessage("你已手動停止生成。");
      } else if (error instanceof ApiRequestError && error.code === "INSUFFICIENT_CREDITS") {
        if (typeof error.remainingCredits === "number") {
          const remainingCredits = error.remainingCredits;
          setCreditStatus((prev) =>
            prev
              ? { ...prev, remainingCredits }
              : {
                  remainingCredits,
                  shouldEnforce: true,
                  costs: { video: 20, image: 1 },
                },
          );
        }
        clearPendingVeoJob(userScopeId);
        setGenerationStage("點數不足");
        setErrorMessage(error.message || "點數不足，請開啟付費會員功能。");
      } else if (error instanceof ApiRequestError && error.code === "VEO_IMAGE_INPUT_UNSUPPORTED") {
        clearPendingVeoJob(userScopeId);
        setErrorMessage("目前此憑證的 Veo 模型不接受圖片輸入（image-to-video）。");
        const hintLines: string[] = [
          "可能原因：此憑證僅開通 text-to-video，尚未開通 image-to-video。",
          "建議：",
        ];
        (error.hints || []).forEach((hint, index) => {
          hintLines.push(`${index + 1}. ${hint}`);
        });
        if (error.supportSummary) {
          hintLines.push(`可用模型探索：${error.supportSummary}`);
        }
        setVeoSupportHint(hintLines.join("\n"));
      } else if (error instanceof ApiRequestError && error.code === "VEO_IMAGE_INPUT_INVALID") {
        clearPendingVeoJob(userScopeId);
        setErrorMessage("上傳圖片無法被 Veo 解析（image is empty / invalid image）。請換一張 JPG/PNG 再試。");
        const hintLines: string[] = ["建議："];
        (error.hints || []).forEach((hint, index) => {
          hintLines.push(`${index + 1}. ${hint}`);
        });
        if (error.supportSummary) {
          hintLines.push(`可用模型探索：${error.supportSummary}`);
        }
        setVeoSupportHint(hintLines.join("\n"));
      } else if (
        error instanceof ApiRequestError &&
        (error.code === "VEO_API_KEY_INVALID" ||
          error.code === "VEO_AUTH_INVALID" ||
          error.code === "REPLICATE_AUTH_INVALID")
      ) {
        clearPendingVeoJob(userScopeId);
        setErrorMessage("AI 憑證無效或尚未設定（REPLICATE_API_TOKEN），無法使用 Replicate 影片模型。");
      } else if (error instanceof ApiRequestError && error.code === "VEO_RATE_LIMITED") {
        clearPendingVeoJob(userScopeId);
        setErrorMessage(error.message || "Replicate 目前達到速率限制，請稍後再試。");
      } else if (error instanceof ApiRequestError && error.code === "VEO_STILL_RUNNING") {
        setErrorMessage(error.message);
        setGenerationStage("背景任務仍在進行");
      } else {
        setErrorMessage(error instanceof Error ? error.message : "影片生成失敗，請稍後再試。");
        clearPendingVeoJob(userScopeId);
        setGenerationStage("生成失敗");
      }
    } finally {
      clearActiveRequests();
      activeOperationNameRef.current = null;
      setIsStopping(false);
      void loadCreditStatus();
      setTimeout(() => {
        setIsGenerating(false);
        setProgress(0);
      }, 180);
    }
  };

  const handleTogglePlay = async () => {
    const video = previewVideoRef.current;
    if (!video) {
      return;
    }
    if (video.paused) {
      await video.play();
    } else {
      video.pause();
    }
  };

  const handleDownload = () => {
    if (!resultVideoUrl) {
      return;
    }
    const extension = resultMimeType.includes("mp4") ? "mp4" : "webm";
    const link = document.createElement("a");
    link.href = resultVideoUrl;
    link.download = `ai-social-video-${formatFileDate()}.${extension}`;
    link.click();
  };

  const handleCloseHistoryPreview = useCallback(() => {
    const video = historyPreviewVideoRef.current;
    if (video) {
      video.pause();
    }
    setHistoryPreviewItem(null);
  }, []);

  const handleOpenHistoryPreview = useCallback((item: GeneratedVideoItem) => {
    setResultVideoUrl(item.videoUrl);
    setResultMeta(
      item.metaText ||
        `模式：圖轉影 · 風格：${STYLE_LABELS[item.style]} · 比例：${item.aspectRatio} · 來源：${
          item.sourceType === "text" ? "文字描述" : "圖片素材"
        } · 時長：${item.durationSec}s`,
    );
    setHistoryPreviewMuted(false);
    setHistoryPreviewItem(item);
  }, []);

  const handleHistoryPreviewFullscreen = useCallback(async () => {
    const video = historyPreviewVideoRef.current;
    if (!video) {
      return;
    }
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (video.requestFullscreen) {
        await video.requestFullscreen();
      }
    } catch {
      // Ignore fullscreen API failures on unsupported browsers.
    }
  }, []);

  useEffect(() => {
    const video = historyPreviewVideoRef.current;
    if (!video || !historyPreviewItem) {
      return;
    }
    video.volume = historyPreviewVolume;
    video.muted = historyPreviewMuted;
  }, [historyPreviewItem, historyPreviewMuted, historyPreviewVolume]);

  useEffect(() => {
    if (!historyPreviewItem) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleCloseHistoryPreview();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleCloseHistoryPreview, historyPreviewItem]);

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col gap-6">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
        accept="image/*"
      />

      <div className="flex justify-center">
        <div className="bg-white px-4 py-2 rounded-xl border border-gray-200 shadow-sm inline-flex text-sm font-medium text-brand-700">
          圖生影片模式
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-6 overflow-hidden">
        <div className="w-full lg:w-80 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden flex-shrink-0">
          <div className="p-4 border-b border-gray-100 bg-gray-50">
            <h3 className="font-bold text-gray-900 flex items-center gap-2">
              <Settings className="w-4 h-4" /> 影片生成設定
            </h3>
          </div>

          <div className="flex-1 p-4 space-y-6 overflow-y-auto">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-3">1. 素材來源（圖片必傳）</label>
              {!uploadedAssetUrl ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:bg-brand-50 hover:border-brand-300 transition-colors cursor-pointer group"
                >
                  <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2 group-hover:text-brand-500" />
                  <p className="text-xs text-gray-500">上傳圖片素材 (JPG/PNG/WebP)，影片會依圖片生成</p>
                  <>
                    <div className="my-2 text-[10px] text-gray-300">- 或 -</div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleUseSample();
                      }}
                    >
                      使用範例圖片
                    </Button>
                  </>
                </div>
              ) : (
                <div className="relative rounded-lg overflow-hidden border border-gray-200 group">
                  <div className="w-full h-32 bg-gray-100 flex items-center justify-center">
                    <img
                      src={uploadedAssetUrl}
                      className={`w-full h-full ${previewObjectFitClass}`}
                      alt="uploaded-preview"
                    />
                  </div>
                  <div className="absolute bottom-2 left-2 text-[10px] px-2 py-1 rounded bg-black/60 text-white">
                    {uploadedFileName}
                  </div>
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Button size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                      更換素材
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-3">2. 社群視覺風格</label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(STYLE_LABELS) as Style[]).map((style) => (
                  <button
                    key={style}
                    onClick={() => setSelectedStyle(style)}
                    className={`text-xs border rounded-md px-2 py-2 text-left transition-colors ${
                      selectedStyle === style
                        ? "border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500"
                        : "border-gray-200 hover:border-brand-300"
                    }`}
                  >
                    {STYLE_LABELS[style]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">3. 補充提示詞（輔助）</label>
              <textarea
                value={customPrompt}
                onChange={(event) => setCustomPrompt(event.target.value)}
                placeholder="例如：運鏡慢一些、先帶客廳再帶餐廚、強化木紋與燈帶層次..."
                className="w-full h-24 resize-none text-sm border border-gray-300 rounded-lg p-2.5 bg-white focus:ring-brand-500 focus:border-brand-500"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                提示詞僅作微調用途；必須先上傳圖片才可生成影片。
              </p>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-3">4. 鏡頭語言</label>
              <select
                value={cameraMotion}
                onChange={(event) => setCameraMotion(event.target.value as CameraMotion)}
                className="w-full text-sm border-gray-300 rounded-lg p-2.5 bg-gray-50"
              >
                {(Object.keys(CAMERA_LABELS) as CameraMotion[]).map((motion) => (
                  <option key={motion} value={motion}>
                    {CAMERA_LABELS[motion]}
                  </option>
                ))}
              </select>
            </div>

            <div className={useVideoModel ? "" : "opacity-50 pointer-events-none"}>
              <label className="block text-sm font-bold text-gray-700 mb-2">輸出比例</label>
              <select
                value={aspectRatio}
                onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}
                className="w-full text-sm border-gray-300 rounded-lg p-2.5 bg-gray-50"
              >
                {(Object.keys(ASPECT_RATIO_LABELS) as AspectRatio[]).map((ratio) => (
                  <option key={ratio} value={ratio}>
                    {ASPECT_RATIO_LABELS[ratio]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-gray-700">素材比例策略</label>
              <div className="grid grid-cols-1 gap-2">
                {SOURCE_FRAME_MODE_OPTIONS.map((modeOption) => (
                  <button
                    key={modeOption}
                    onClick={() => setSourceFrameMode(modeOption)}
                    className={`rounded-md border px-3 py-2 text-left transition-colors ${
                      sourceFrameMode === modeOption
                        ? "border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500"
                        : "border-gray-200 bg-white hover:border-brand-300"
                    }`}
                  >
                    <p className="text-xs font-semibold">{SOURCE_FRAME_MODE_LABELS[modeOption]}</p>
                    <p className="mt-1 text-[11px] text-gray-600">{SOURCE_FRAME_MODE_HINTS[modeOption]}</p>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-500">
                當素材比例與輸出比例不同（例如 16:9 素材輸出 9:16）時，此設定會決定是否裁切滿版。
              </p>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-semibold text-gray-700">身份鎖定模式（強制）</p>
              <p className="text-[11px] text-gray-600 mt-1">
                預設完整保留原圖（含原本衣服與場景）直接圖生影；若有文字補充，僅追加你指定的內容。
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
              <div>
                <p className="text-xs font-semibold text-gray-700">影片模型（Replicate）</p>
                <p className="text-[11px] text-gray-500">使用 Replicate 模型生成可上架社群的鏡頭運動</p>
              </div>
              <button
                onClick={() => setUseVideoModel((value) => !value)}
                className={`px-2 py-1 text-xs rounded ${
                  useVideoModel ? "bg-brand-600 text-white" : "bg-gray-200 text-gray-600"
                }`}
              >
                {useVideoModel ? "開啟" : "關閉"}
              </button>
            </div>

            <div className={useVideoModel ? "" : "opacity-50 pointer-events-none"}>
              <label className="block text-sm font-bold text-gray-700 mb-2">影片模型版本</label>
              <select
                value={videoModel}
                onChange={(event) => setVideoModel(event.target.value)}
                className="w-full text-sm border-gray-300 rounded-lg p-2.5 bg-gray-50"
              >
                {VEO_MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={useVideoModel ? "" : "opacity-50 pointer-events-none"}>
              <label className="block text-sm font-bold text-gray-700 mb-2">輸出解析度</label>
              <select
                value={videoResolution}
                onChange={(event) =>
                  setVideoResolution(event.target.value as "720p" | "1080p")
                }
                className="w-full text-sm border-gray-300 rounded-lg p-2.5 bg-gray-50"
              >
                <option value="720p">720p（建議，較快）</option>
                <option value="1080p">1080p（較慢，較清晰）</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">5. 影片時長（秒）</label>
              <input
                type="range"
                min={3}
                max={12}
                value={durationSec}
                onChange={(event) => setDurationSec(Number(event.target.value))}
                className="w-full accent-brand-600"
              />
              <div className="mt-1 text-xs text-gray-500">目前：{durationSec} 秒</div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs text-gray-600">
                此頁只專注生成社群影片素材。切到其他分頁或離開此頁後，影片任務會在背景持續，回到本頁會自動續跑並完成儲存。文案、Hashtag、貼文預覽與排程，請至「社群發文中心」使用素材庫進行。
              </p>
            </div>

            {creditStatus?.shouldEnforce && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                剩餘點數：{typeof creditStatus.remainingCredits === "number" ? creditStatus.remainingCredits : "--"} 點
                （每支影片 {creditStatus.costs?.video ?? 20} 點）
              </div>
            )}

            {errorMessage && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 whitespace-pre-line">
                {errorMessage}
              </div>
            )}

            {veoSupportHint && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 whitespace-pre-line">
                <p className="font-semibold mb-1">影片模型狀態說明</p>
                {veoSupportHint}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-gray-100 bg-gray-50">
            <div className="flex justify-between text-xs text-gray-500 mb-2">
              <span>預估時長：{durationSec}s</span>
              <span>消耗：{creditStatus?.costs?.video ?? 20} 點</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                fullWidth
                onClick={handleGenerate}
                disabled={!canGenerate || isGenerating}
                className="gap-2"
              >
                {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {isGenerating ? `AI 運算中 ${progress}%` : "開始生成社群影片（需圖片）"}
              </Button>
              {isGenerating && (
                <Button
                  variant="outline"
                  onClick={() => void handleStopGeneration()}
                  disabled={isStopping}
                  className="whitespace-nowrap"
                >
                  {isStopping ? "停止中..." : "停止"}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 bg-gray-900 rounded-xl overflow-hidden flex flex-col shadow-2xl relative">
          <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/65 to-transparent z-20 flex justify-between items-start">
            <div className="text-white text-xs font-mono">
              {isGenerating ? generationStage : resultVideoUrl ? "PREVIEW MODE" : "STANDBY"}
            </div>
            {resultVideoUrl && (
              <Button
                size="sm"
                className="bg-white/20 hover:bg-white/30 text-white border-none backdrop-blur-md gap-2"
                onClick={handleDownload}
              >
                <Download className="w-4 h-4" /> 下載影片
              </Button>
            )}
          </div>

          <div
            ref={previewViewportRef}
            className="flex-1 relative flex items-center justify-center overflow-hidden bg-black p-3"
          >
            <div
              className="relative rounded-lg border border-white/10 bg-black overflow-hidden shadow-2xl"
              style={{
                width: previewFrameSize.width > 0 ? `${previewFrameSize.width}px` : "100%",
                height: previewFrameSize.height > 0 ? `${previewFrameSize.height}px` : "100%",
                maxWidth: "100%",
                maxHeight: "100%",
              }}
            >
              {!resultVideoUrl && !uploadedAssetUrl ? (
                <div className="w-full h-full text-center text-gray-500 flex flex-col items-center justify-center">
                  <Film className="w-16 h-16 mx-auto mb-4 opacity-30" />
                  <p>請先上傳圖片才能生成動態影片</p>
                </div>
              ) : (
                <>
                  {resultVideoUrl ? (
                    <video
                      ref={previewVideoRef}
                      src={resultVideoUrl}
                      className={`w-full h-full ${previewObjectFitClass}`}
                      loop
                      muted
                      playsInline
                    />
                  ) : (
                    <img
                      src={uploadedAssetUrl || undefined}
                      className={`w-full h-full ${previewObjectFitClass} opacity-70`}
                      alt="preview-still"
                    />
                  )}

                  {isGenerating && (
                    <div className="absolute inset-0 z-30 bg-black/65 flex flex-col items-center justify-center">
                      <div className="w-72 h-2 bg-gray-700 rounded-full mb-4 overflow-hidden">
                        <div className="h-full bg-brand-500 transition-all duration-75" style={{ width: `${progress}%` }} />
                      </div>
                      <p className="text-brand-400 font-mono text-sm animate-pulse">{generationStage}</p>
                    </div>
                  )}

                  {resultVideoUrl && !isGenerating && (
                    <div
                      className={`absolute inset-0 flex items-center justify-center z-10 bg-black/20 cursor-pointer ${
                        isPlaying ? "opacity-0 hover:opacity-100" : "opacity-100"
                      }`}
                      onClick={() => void handleTogglePlay()}
                    >
                      <button className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-md border border-white/40 flex items-center justify-center hover:scale-110 transition-transform shadow-xl">
                        {isPlaying ? (
                          <Pause className="w-8 h-8 text-white fill-current" />
                        ) : (
                          <Play className="w-8 h-8 text-white fill-current ml-1" />
                        )}
                      </button>
                    </div>
                  )}
                </>
              )}

              <div className="absolute left-2 bottom-2 px-2 py-1 rounded bg-black/55 text-[10px] text-white/85">
                預覽比例：{aspectRatio} · 構圖：{SOURCE_FRAME_MODE_LABELS[sourceFrameMode]}
              </div>
            </div>
          </div>

          <div className="h-16 bg-gray-800 border-t border-gray-700 flex items-center px-4 gap-4 z-20">
            <button onClick={() => void handleTogglePlay()} className="text-gray-300 hover:text-white">
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>

            <span className="text-xs font-mono text-gray-400 w-24">
              {formatClock(videoCurrent)} / {formatClock(videoDuration)}
            </span>

            <div className="flex-1 relative h-1.5 bg-gray-600 rounded-full overflow-hidden">
              <div
                className="absolute top-0 left-0 h-full bg-brand-500 rounded-full"
                style={{
                  width:
                    videoDuration > 0
                      ? `${Math.min(100, Math.max(0, (videoCurrent / videoDuration) * 100))}%`
                      : "0%",
                }}
              />
            </div>
          </div>

          {resultMeta && (
            <div className="border-t border-gray-700 bg-gray-900/80 text-[11px] text-gray-300 px-4 py-2">
              {resultMeta}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-2 max-h-[18vh] flex flex-col">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-xs font-semibold text-gray-700">生成歷史</p>
          <p className="text-[10px] text-gray-500">小縮圖（等高）· 點擊開啟彈窗播放器</p>
        </div>
        <div className="flex-1 flex items-center gap-2 overflow-x-auto pb-1">
          {history.length === 0 ? (
            <div className="px-2 text-xs text-gray-400">尚未生成影片</div>
          ) : (
            history.map((item) => (
              <button
                key={item.id}
                onClick={() => handleOpenHistoryPreview(item)}
                className={`relative shrink-0 rounded-md border bg-black/90 text-left transition-colors overflow-hidden ${
                  resultVideoUrl === item.videoUrl
                    ? "border-brand-500 ring-1 ring-brand-300"
                    : "border-gray-300 hover:border-brand-300"
                }`}
                style={{
                  height: "min(15vh, 110px)",
                  aspectRatio: toCssAspectRatio(item.aspectRatio),
                }}
                title={`${item.aspectRatio} · ${new Date(item.createdAt).toLocaleTimeString("zh-TW")}`}
              >
                <video
                  src={item.videoUrl}
                  className="w-full h-full object-contain"
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="metadata"
                  onError={() => removeBrokenVideo(item.videoUrl)}
                />
                <div className="absolute bottom-1 left-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
                  {item.aspectRatio}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
      {historyPreviewItem && (
        <div
          className="fixed inset-0 z-[120] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={handleCloseHistoryPreview}
        >
          <div
            className="w-full max-w-5xl rounded-xl border border-white/20 bg-gray-900 overflow-hidden shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-white">
                影片預覽 · {historyPreviewItem.aspectRatio} · {STYLE_LABELS[historyPreviewItem.style]}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setHistoryPreviewMuted((value) => !value)}
                  className="h-9 w-9 rounded-md border border-white/20 text-white hover:bg-white/10 flex items-center justify-center"
                  title={historyPreviewMuted ? "取消靜音" : "靜音"}
                >
                  {historyPreviewMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={historyPreviewMuted ? 0 : historyPreviewVolume}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setHistoryPreviewMuted(next <= 0);
                    setHistoryPreviewVolume(next);
                  }}
                  className="w-28 accent-brand-500"
                  title="音量"
                />
                <button
                  onClick={() => void handleHistoryPreviewFullscreen()}
                  className="h-9 w-9 rounded-md border border-white/20 text-white hover:bg-white/10 flex items-center justify-center"
                  title="全螢幕"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
                <button
                  onClick={handleCloseHistoryPreview}
                  className="h-9 w-9 rounded-md border border-white/20 text-white hover:bg-white/10 flex items-center justify-center"
                  title="關閉"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="bg-black flex items-center justify-center p-3">
              <div
                className="w-full max-h-[78vh] flex items-center justify-center"
                style={{ aspectRatio: toCssAspectRatio(historyPreviewItem.aspectRatio) }}
              >
                <video
                  ref={historyPreviewVideoRef}
                  src={historyPreviewItem.videoUrl}
                  className="w-full h-full object-contain"
                  controls
                  autoPlay
                  playsInline
                  onError={() => removeBrokenVideo(historyPreviewItem.videoUrl)}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};