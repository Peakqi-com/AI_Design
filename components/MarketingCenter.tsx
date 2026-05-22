import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "./Button";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock,
  Facebook,
  Film,
  Globe,
  Hash,
  Image as ImageIcon,
  Instagram,
  Key,
  Loader2,
  Search,
  Send,
  Sparkles,
  Upload,
  Wand2,
} from "lucide-react";
import { resolveClientUserScopeId } from "@/lib/client/user-scope";
import { useCredits } from "@/lib/client/use-credits";
import {
  getLatestSocialImageTask,
  SocialImageBackgroundTask,
  startSocialImageBackgroundTask,
  subscribeSocialImageBackgroundTasks,
} from "@/lib/client/social-image-background";

type Platform = "instagram" | "facebook" | "threads" | "tiktok";
type AssetFilter = "all" | "image" | "video";
type ScheduleStatus = "draft" | "published";
type PostTone = "professional" | "warm" | "friendly" | "luxury" | "storytelling" | "promo";
type PostTheme = "marketing" | "daily" | "festival" | "expertise";
type PostLength = "short" | "medium" | "long";

interface SocialAssetItem {
  id: string;
  userId: string;
  kind: "image" | "video";
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  url: string;
  meta?: {
    origin?: string;
    mode?: string;
    style?: string;
    aspectRatio?: string;
    sourceType?: string;
    durationSec?: number;
    prompt?: string;
    summary?: string;
  };
}

interface SocialAssetListResponse {
  items?: SocialAssetItem[];
}

interface SocialAssetSaveResponse {
  item?: SocialAssetItem;
}

interface ContentVaultItem {
  id: string;
  userId: string;
  kind: "marketing-state" | "social-post" | "general";
  title: string;
  summary?: string;
  payload?: unknown;
  upsertKey?: string;
  createdAt: string;
  updatedAt: string;
}

interface ContentVaultListResponse {
  items?: ContentVaultItem[];
}

interface ContentVaultSaveResponse {
  item?: ContentVaultItem;
}

interface GenerateSocialPostResponse {
  title: string;
  caption: string;
  hashtags: string[];
  model: string;
}

interface ScheduleItem {
  id: string;
  title: string;
  platforms: Platform[];
  date: string;
  time: string;
  status: ScheduleStatus;
}

interface MarketingStatePayload {
  selectedPlatforms: Platform[];
  postTopic: string;
  postObjective: string;
  postTone: PostTone;
  postTheme: PostTheme;
  postLength: PostLength;
  postTitle: string;
  postCaption: string;
  postHashtagsInput: string;
  postPublishStatus: ScheduleStatus;
  scheduleDate: string;
  scheduleTime: string;
  scheduleItems: ScheduleItem[];
}

const PLATFORM_OPTIONS: Array<{ id: Platform; label: string }> = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "threads", label: "Threads" },
  { id: "tiktok", label: "TikTok" },
];

const IMAGE_STYLE_OPTIONS = [
  { id: "lifestyle", label: "生活感社群圖", style: "自然生活感" },
  { id: "minimal", label: "極簡品牌圖", style: "極簡設計感" },
  { id: "campaign", label: "活動主視覺", style: "廣告主視覺" },
];

const POST_TONE_OPTIONS: Array<{ id: PostTone; label: string; direction: string }> = [
  { id: "professional", label: "專業權威", direction: "條理清楚、重點明確，適合品牌官方帳號。" },
  { id: "warm", label: "溫暖陪伴", direction: "加強情感共鳴與信任，讓讀者感到被理解。" },
  { id: "friendly", label: "活潑親切", direction: "像朋友對話，口語自然、容易互動。" },
  { id: "luxury", label: "高質感精品", direction: "語氣精緻克制，突顯品味與高價值感。" },
  { id: "storytelling", label: "故事敘事", direction: "用情境鋪陳、轉折與收束，帶入感更強。" },
  { id: "promo", label: "活動促銷", direction: "聚焦利益點與 CTA，提高詢問與轉換。" },
];

const POST_THEME_OPTIONS: Array<{ id: PostTheme; label: string; direction: string }> = [
  { id: "marketing", label: "行銷推廣", direction: "突出價值主張、差異化與立即行動。" },
  { id: "daily", label: "日常貼文", direction: "強調真實日常與品牌溫度，維持穩定互動。" },
  { id: "festival", label: "節慶貼文", direction: "結合節慶情境與檔期需求，帶出應景內容。" },
  { id: "expertise", label: "專業介紹", direction: "展現專業方法、流程與可信度。" },
];

const POST_LENGTH_OPTIONS: Array<{ id: PostLength; label: string; direction: string }> = [
  { id: "short", label: "精簡短文", direction: "約 80-120 字，快速傳達一個主訊息。" },
  { id: "medium", label: "標準中長文", direction: "約 140-220 字，兼顧資訊與情感。" },
  { id: "long", label: "完整長文", direction: "約 260-420 字，完整鋪陳價值與 CTA。" },
];

const pad2 = (v: number): string => String(v).padStart(2, "0");
const toDate = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const toTime = (d: Date): string => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const ensureDatePrefix = (value: string, dateLabel: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return `[${dateLabel}] 內容草稿`;
  }
  return /^\[\d{4}-\d{2}-\d{2}\]/.test(trimmed) ? trimmed : `[${dateLabel}] ${trimmed}`;
};
const dateAfterDays = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toDate(d);
};
const nextHour = (): string => {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return toTime(d);
};

const parseHashtags = (input: string): string[] =>
  input
    .split(/[\s,，]+/)
    .map((token) =>
      token
        .replace(/^#+/, "")
        .replace(/[^0-9A-Za-z_\u4e00-\u9fa5]/g, "")
        .trim(),
    )
    .filter(Boolean)
    .map((token) => `#${token}`);

const dedupe = <T,>(list: T[]): T[] => Array.from(new Set(list));

const requestJson = async <T,>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    if (payload && typeof payload === "object" && "error" in payload) {
      throw new Error(String((payload as { error?: unknown }).error || "Request failed"));
    }
    throw new Error(raw.slice(0, 180) || `HTTP ${response.status}`);
  }
  if (!payload) {
    throw new Error("伺服器回傳格式錯誤。");
  }
  return payload as T;
};

const fileToDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("檔案讀取失敗"));
    reader.readAsDataURL(file);
  });

const createPromptSeedImage = (prompt: string): string => {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("無法建立圖片種子。");
  }

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#334155");
  gradient.addColorStop(1, "#7C3AED");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fillRect(80, 160, 920, 760);

  ctx.fillStyle = "white";
  ctx.font = "bold 64px sans-serif";
  ctx.fillText("SOCIAL IMAGE", 110, 260);

  ctx.font = "42px sans-serif";
  const text = prompt.trim() || "社群圖片主題";
  const lines: string[] = [];
  let current = "";
  for (const char of text) {
    const candidate = current + char;
    if (ctx.measureText(candidate).width > 760 && current) {
      lines.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) {
    lines.push(current);
  }
  lines.slice(0, 8).forEach((line, idx) => {
    ctx.fillText(line, 110, 360 + idx * 56);
  });

  return canvas.toDataURL("image/jpeg", 0.9);
};

const platformIcon = (platform: Platform, className = "w-4 h-4"): React.ReactElement => {
  switch (platform) {
    case "instagram":
      return <Instagram className={className} />;
    case "facebook":
      return <Facebook className={className} />;
    case "threads":
      return <Hash className={className} />;
    case "tiktok":
      return <Film className={className} />;
    default:
      return <Globe className={className} />;
  }
};

export const MarketingCenter: React.FC = () => {
  const { data: session } = useSession();
  const credits = useCredits();

  const [userScopeId, setUserScopeId] = useState("guest_server");
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
  const [assetSearch, setAssetSearch] = useState("");
  const [assets, setAssets] = useState<SocialAssetItem[]>([]);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState("");

  const [imagePrompt, setImagePrompt] = useState("");
  const [selectedImageStyleId, setSelectedImageStyleId] = useState(IMAGE_STYLE_OPTIONS[0].id);
  const [referenceImageDataUrl, setReferenceImageDataUrl] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [generatedImagePreviewUrl, setGeneratedImagePreviewUrl] = useState<string | null>(null);
  const [generatedImagePreviewFallbackUrl, setGeneratedImagePreviewFallbackUrl] = useState<string | null>(null);
  const [generatedImagePreviewSummary, setGeneratedImagePreviewSummary] = useState("");
  const [generatedImagePreviewFileName, setGeneratedImagePreviewFileName] = useState("");
  const [socialImageTask, setSocialImageTask] = useState<SocialImageBackgroundTask | null>(null);
  const [socialImageTaskNotice, setSocialImageTaskNotice] = useState("");
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [assetImageFallbackUrls, setAssetImageFallbackUrls] = useState<Record<string, string>>({});
  const [brokenAssetImageIds, setBrokenAssetImageIds] = useState<Record<string, boolean>>({});

  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(["instagram", "facebook"]);
  const [postTopic, setPostTopic] = useState("");
  const [postObjective, setPostObjective] = useState("");
  const [postTone, setPostTone] = useState<PostTone>("professional");
  const [postTheme, setPostTheme] = useState<PostTheme>("marketing");
  const [postLength, setPostLength] = useState<PostLength>("medium");
  const [isGeneratingCopy, setIsGeneratingCopy] = useState(false);
  const [lastGeneratedModel, setLastGeneratedModel] = useState("");
  const [copyModelChoice, setCopyModelChoice] = useState<"gemini" | "gpt" | "both">("both");
  const [altResult, setAltResult] = useState<{ title: string; caption: string; hashtags: string; model: string } | null>(null);
  const [copyHistory, setCopyHistory] = useState<Array<{ id: string; title: string; caption: string; hashtags: string; model: string; createdAt: string }>>([]);
  const [showCopyHistory, setShowCopyHistory] = useState(false);

  const [postTitle, setPostTitle] = useState("");
  const [postCaption, setPostCaption] = useState("");
  const [postHashtagsInput, setPostHashtagsInput] = useState("");
  const [postPublishStatus, setPostPublishStatus] = useState<ScheduleStatus>("draft");
  const [scheduleDate, setScheduleDate] = useState(dateAfterDays(1));
  const [scheduleTime, setScheduleTime] = useState(nextHour());
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([
    {
      id: "seed_1",
      title: "內容行銷貼文｜案例拆解",
      platforms: ["instagram", "facebook"],
      date: dateAfterDays(1),
      time: "11:00",
      status: "draft",
    },
  ]);
  const [marketingStateItemId, setMarketingStateItemId] = useState("");
  const [marketingStateReady, setMarketingStateReady] = useState(false);

  // Social API settings
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [fbPageId, setFbPageId] = useState(() => typeof window !== "undefined" ? localStorage.getItem("social:fb:pageId") || "" : "");
  const [fbAccessToken, setFbAccessToken] = useState(() => typeof window !== "undefined" ? localStorage.getItem("social:fb:accessToken") || "" : "");
  const [igBusinessId, setIgBusinessId] = useState(() => typeof window !== "undefined" ? localStorage.getItem("social:ig:businessId") || "" : "");
  const [igAccessToken, setIgAccessToken] = useState(() => typeof window !== "undefined" ? localStorage.getItem("social:ig:accessToken") || "" : "");
  const [apiSettingsSaved, setApiSettingsSaved] = useState(false);

  const handleSaveApiSettings = () => {
    localStorage.setItem("social:fb:pageId", fbPageId);
    localStorage.setItem("social:fb:accessToken", fbAccessToken);
    localStorage.setItem("social:ig:businessId", igBusinessId);
    localStorage.setItem("social:ig:accessToken", igAccessToken);
    setApiSettingsSaved(true);
    setTimeout(() => setApiSettingsSaved(false), 2000);
  };

  const fbConnected = Boolean(fbPageId && fbAccessToken);
  const igConnected = Boolean(igBusinessId && igAccessToken);

  const libraryUploadRef = useRef<HTMLInputElement>(null);
  const referenceUploadRef = useRef<HTMLInputElement>(null);

  const selectedAsset = useMemo(
    () => assets.find((item) => item.id === selectedAssetId) || null,
    [assets, selectedAssetId],
  );
  const hashtags = useMemo(() => dedupe(parseHashtags(postHashtagsInput)), [postHashtagsInput]);
  const selectedToneOption = useMemo(
    () => POST_TONE_OPTIONS.find((item) => item.id === postTone) || POST_TONE_OPTIONS[0],
    [postTone],
  );
  const selectedThemeOption = useMemo(
    () => POST_THEME_OPTIONS.find((item) => item.id === postTheme) || POST_THEME_OPTIONS[0],
    [postTheme],
  );
  const selectedLengthOption = useMemo(
    () => POST_LENGTH_OPTIONS.find((item) => item.id === postLength) || POST_LENGTH_OPTIONS[1],
    [postLength],
  );

  const visibleAssets = useMemo(() => {
    const searchKey = assetSearch.trim().toLowerCase();
    return assets
      .filter((item) => (assetFilter === "all" ? true : item.kind === assetFilter))
      .filter((item) => (!searchKey ? true : item.fileName.toLowerCase().includes(searchKey)));
  }, [assetFilter, assetSearch, assets]);

  const rememberAssetImageFallback = useCallback((assetId: string, dataUrl?: string | null) => {
    const normalized = (dataUrl || "").trim();
    if (!assetId || !/^data:image\//i.test(normalized)) {
      return;
    }
    setAssetImageFallbackUrls((prev) => (prev[assetId] === normalized ? prev : { ...prev, [assetId]: normalized }));
  }, []);

  const resolveAssetImageSrc = useCallback(
    (asset: SocialAssetItem): string => {
      if (asset.kind !== "image") {
        return asset.url;
      }
      const fallback = assetImageFallbackUrls[asset.id];
      if (brokenAssetImageIds[asset.id] && fallback) {
        return fallback;
      }
      return asset.url;
    },
    [assetImageFallbackUrls, brokenAssetImageIds],
  );

  const handleAssetImageError = useCallback(
    (asset: SocialAssetItem) => {
      if (asset.kind !== "image") {
        return;
      }
      const fallback = assetImageFallbackUrls[asset.id];
      if (!fallback) {
        return;
      }
      setBrokenAssetImageIds((prev) => (prev[asset.id] ? prev : { ...prev, [asset.id]: true }));
    },
    [assetImageFallbackUrls],
  );

  const loadAssets = useCallback(async () => {
    if (!userScopeId) {
      return;
    }
    setIsLoadingAssets(true);
    try {
      const payload = await requestJson<SocialAssetListResponse>(
        `/api/social/assets?userId=${encodeURIComponent(userScopeId)}&limit=80`,
        { method: "GET" },
      );
      const next = Array.isArray(payload.items) ? payload.items : [];
      setAssets(next);
      setSelectedAssetId((prev) => prev || next[0]?.id || "");
    } finally {
      setIsLoadingAssets(false);
    }
  }, [userScopeId]);

  const loadMarketingState = useCallback(async () => {
    if (!userScopeId) {
      return;
    }
    try {
      const payload = await requestJson<ContentVaultListResponse>(
        `/api/content/vault?userId=${encodeURIComponent(userScopeId)}&kind=marketing-state&limit=1`,
        { method: "GET" },
      );
      const item = Array.isArray(payload.items) ? payload.items[0] : undefined;
      if (!item || !item.payload || typeof item.payload !== "object") {
        setMarketingStateReady(true);
        return;
      }

      const state = item.payload as Partial<MarketingStatePayload>;
      const validPlatformSet = new Set<Platform>(["instagram", "facebook", "threads", "tiktok"]);
      const nextPlatforms = Array.isArray(state.selectedPlatforms)
        ? state.selectedPlatforms.filter((p): p is Platform => validPlatformSet.has(p as Platform))
        : [];
      const nextScheduleItems = Array.isArray(state.scheduleItems)
        ? state.scheduleItems
            .map((entry, idx) => ({
              id: String(entry.id || `sched_restored_${idx}`),
              title: String(entry.title || "").trim() || "未命名排程",
              platforms: (() => {
                const next = Array.isArray(entry.platforms)
                  ? entry.platforms.filter((p): p is Platform => validPlatformSet.has(p as Platform))
                  : [];
                return next.length > 0 ? next : (["instagram"] as Platform[]);
              })(),
              date: String(entry.date || "").trim() || dateAfterDays(1),
              time: String(entry.time || "").trim() || "10:00",
              status: (entry.status === "published" ? "published" : "draft") as ScheduleStatus,
            }))
            .slice(0, 200)
        : [];

      setMarketingStateItemId(item.id);
      if (nextPlatforms.length > 0) {
        setSelectedPlatforms(nextPlatforms);
      }
      if (typeof state.postTopic === "string") {
        setPostTopic(state.postTopic);
      }
      if (typeof state.postObjective === "string") {
        setPostObjective(state.postObjective);
      }
      if (state.postTone && POST_TONE_OPTIONS.some((option) => option.id === state.postTone)) {
        setPostTone(state.postTone);
      }
      if (state.postTheme && POST_THEME_OPTIONS.some((option) => option.id === state.postTheme)) {
        setPostTheme(state.postTheme);
      }
      if (state.postLength && POST_LENGTH_OPTIONS.some((option) => option.id === state.postLength)) {
        setPostLength(state.postLength);
      }
      if (typeof state.postTitle === "string") {
        setPostTitle(state.postTitle);
      }
      if (typeof state.postCaption === "string") {
        setPostCaption(state.postCaption);
      }
      if (typeof state.postHashtagsInput === "string") {
        setPostHashtagsInput(state.postHashtagsInput);
      }
      if (state.postPublishStatus === "published" || state.postPublishStatus === "draft") {
        setPostPublishStatus(state.postPublishStatus);
      }
      if (typeof state.scheduleDate === "string" && state.scheduleDate.trim()) {
        setScheduleDate(state.scheduleDate);
      }
      if (typeof state.scheduleTime === "string" && state.scheduleTime.trim()) {
        setScheduleTime(state.scheduleTime);
      }
      if (nextScheduleItems.length > 0) {
        setScheduleItems(nextScheduleItems);
      }
    } catch {
      // ignore state load errors and keep editor usable
    } finally {
      setMarketingStateReady(true);
    }
  }, [userScopeId]);

  useEffect(() => {
    const sessionUser = session?.user as { id?: string; email?: string | null } | undefined;
    setUserScopeId(resolveClientUserScopeId(sessionUser?.id || null, sessionUser?.email || null));
  }, [session?.user]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  useEffect(() => {
    if (!userScopeId) {
      return;
    }
    const latest = getLatestSocialImageTask(userScopeId);
    if (latest) {
      setSocialImageTask(latest);
      setIsGeneratingImage(latest.status === "running");
      if (latest.savedAsset?.id) {
        rememberAssetImageFallback(latest.savedAsset.id, latest.imageDataUrl);
      }
      if (latest.savedAsset?.url) {
        setGeneratedImagePreviewUrl(latest.savedAsset.url);
      } else if (latest.imageDataUrl) {
        setGeneratedImagePreviewUrl(latest.imageDataUrl);
      }
      if (latest.imageDataUrl) {
        setGeneratedImagePreviewFallbackUrl(latest.imageDataUrl);
      }
      if (latest.summary) {
        setGeneratedImagePreviewSummary(latest.summary);
      }
      if (latest.savedAsset?.fileName) {
        setGeneratedImagePreviewFileName(latest.savedAsset.fileName);
      }
    }

    const unsubscribe = subscribeSocialImageBackgroundTasks((task) => {
      if (task.userId !== userScopeId) {
        return;
      }
      setSocialImageTask(task);
      if (task.status === "running") {
        setIsGeneratingImage(true);
        setSocialImageTaskNotice("社群圖片背景生成中，可切換到其他介面繼續作業。");
        if (task.imageDataUrl) {
          setGeneratedImagePreviewUrl(task.imageDataUrl);
          setGeneratedImagePreviewFallbackUrl(task.imageDataUrl);
        }
        if (task.summary) {
          setGeneratedImagePreviewSummary(task.summary);
        }
        return;
      }
      if (task.status === "completed") {
        setIsGeneratingImage(false);
        setSocialImageTaskNotice("背景生成完成，已自動存入素材庫。");
        if (task.savedAsset) {
          rememberAssetImageFallback(task.savedAsset.id, task.imageDataUrl);
          setBrokenAssetImageIds((prev) => {
            if (!prev[task.savedAsset!.id]) {
              return prev;
            }
            const next = { ...prev };
            delete next[task.savedAsset!.id];
            return next;
          });
          setAssets((prev) => [task.savedAsset!, ...prev.filter((item) => item.id !== task.savedAsset!.id)]);
          setSelectedAssetId(task.savedAsset.id);
          setGeneratedImagePreviewUrl(task.savedAsset.url);
          setGeneratedImagePreviewFallbackUrl(task.imageDataUrl || null);
          setGeneratedImagePreviewSummary(task.summary || "");
          setGeneratedImagePreviewFileName(task.savedAsset.fileName);
        } else if (task.imageDataUrl) {
          setGeneratedImagePreviewUrl(task.imageDataUrl);
          setGeneratedImagePreviewFallbackUrl(task.imageDataUrl);
        }
        return;
      }
      setIsGeneratingImage(false);
      setSocialImageTaskNotice(`背景生成失敗：${task.error || "請稍後重試"}`);
    });

    return unsubscribe;
  }, [rememberAssetImageFallback, userScopeId]);

  useEffect(() => {
    setMarketingStateReady(false);
    void loadMarketingState();
  }, [loadMarketingState]);

  // Load copy history
  const loadCopyHistory = useCallback(async () => {
    if (!userScopeId) return;
    try {
      const data = await requestJson<ContentVaultListResponse>(
        `/api/content/vault?userId=${encodeURIComponent(userScopeId)}&kind=social-post&limit=20`,
        { method: "GET" },
      );
      setCopyHistory(
        (data.items || []).map((item) => {
          const p = (item.payload || {}) as Record<string, unknown>;
          return {
            id: item.id,
            title: String(p.title || item.title || ""),
            caption: String(p.caption || ""),
            hashtags: Array.isArray(p.hashtags) ? (p.hashtags as string[]).join(" ") : "",
            model: String(p.model || ""),
            createdAt: item.createdAt,
          };
        }),
      );
    } catch { /* ignore */ }
  }, [userScopeId]);

  useEffect(() => {
    void loadCopyHistory();
  }, [loadCopyHistory]);

  const uploadAsset = useCallback(
    async (file: File, meta: Record<string, unknown>): Promise<SocialAssetItem> => {
      const kind = file.type.startsWith("video/") ? "video" : "image";
      const formData = new FormData();
      formData.append("userId", userScopeId);
      formData.append("kind", kind);
      formData.append("file", file);
      formData.append("meta", JSON.stringify(meta));
      const payload = await requestJson<SocialAssetSaveResponse>("/api/social/assets", {
        method: "POST",
        body: formData,
      });
      if (!payload.item) {
        throw new Error("伺服器未回傳素材資料。");
      }
      return payload.item;
    },
    [userScopeId],
  );

  const saveMarketingState = useCallback(async () => {
    if (!userScopeId || !marketingStateReady) {
      return;
    }
    const payload: MarketingStatePayload = {
      selectedPlatforms,
      postTopic,
      postObjective,
      postTone,
      postTheme,
      postLength,
      postTitle,
      postCaption,
      postHashtagsInput,
      postPublishStatus,
      scheduleDate,
      scheduleTime,
      scheduleItems,
    };
    try {
      const result = await requestJson<ContentVaultSaveResponse>("/api/content/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: marketingStateItemId || undefined,
          userId: userScopeId,
          kind: "marketing-state",
          title: "社群發文中心草稿",
          summary: `排程 ${scheduleItems.length} 筆`,
          upsertKey: "marketing_state_main",
          payload,
        }),
      });
      if (result.item?.id && result.item.id !== marketingStateItemId) {
        setMarketingStateItemId(result.item.id);
      }
    } catch {
      // ignore autosave errors
    }
  }, [
    marketingStateItemId,
    marketingStateReady,
    postCaption,
    postHashtagsInput,
    postLength,
    postObjective,
    postPublishStatus,
    postTheme,
    postTitle,
    postTone,
    postTopic,
    scheduleDate,
    scheduleItems,
    scheduleTime,
    selectedPlatforms,
    userScopeId,
  ]);

  useEffect(() => {
    if (!marketingStateReady) {
      return;
    }
    const timer = window.setTimeout(() => {
      void saveMarketingState();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [
    marketingStateReady,
    postCaption,
    postHashtagsInput,
    postLength,
    postObjective,
    postPublishStatus,
    postTheme,
    postTitle,
    postTone,
    postTopic,
    saveMarketingState,
    scheduleDate,
    scheduleItems,
    scheduleTime,
    selectedPlatforms,
  ]);

  const handleLibraryUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    event.target.value = "";
    setIsUploadingAsset(true);
    try {
      const item = await uploadAsset(file, { origin: "manual-upload", summary: "手動上傳素材" });
      setAssets((prev) => [item, ...prev.filter((asset) => asset.id !== item.id)]);
      setSelectedAssetId(item.id);
    } catch (error) {
      alert(error instanceof Error ? error.message : "上傳素材失敗");
    } finally {
      setIsUploadingAsset(false);
    }
  };

  const handleReferenceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    setReferenceImageDataUrl(dataUrl);
    event.target.value = "";
  };

  const handleGenerateSocialImage = async () => {
    if (!imagePrompt.trim()) {
      alert("請先輸入社群圖片需求");
      return;
    }
    const styleOption = IMAGE_STYLE_OPTIONS.find((item) => item.id === selectedImageStyleId) || IMAGE_STYLE_OPTIONS[0];
    const seedImageDataUrl = referenceImageDataUrl || createPromptSeedImage(imagePrompt);
    const task = startSocialImageBackgroundTask({
      userId: userScopeId,
      prompt: imagePrompt.trim(),
      style: styleOption.style,
      imageDataUrl: seedImageDataUrl,
    });
    setSocialImageTask(task);
    setIsGeneratingImage(true);
    setSocialImageTaskNotice("已轉為背景生成，可切換其他介面，完成後自動存入素材庫。");
    setGeneratedImagePreviewUrl(seedImageDataUrl);
    setGeneratedImagePreviewFallbackUrl(seedImageDataUrl);
    setGeneratedImagePreviewSummary("背景生成已啟動，完成後將自動更新預覽。");
    setGeneratedImagePreviewFileName("");
    setImagePrompt("");
    setReferenceImageDataUrl(null);
  };

  const togglePlatform = (platform: Platform) => {
    if (selectedPlatforms.includes(platform)) {
      if (selectedPlatforms.length === 1) {
        return;
      }
      setSelectedPlatforms((prev) => prev.filter((item) => item !== platform));
      return;
    }
    setSelectedPlatforms((prev) => [...prev, platform]);
  };

  const handleGenerateCopy = async () => {
    if (!selectedAsset) {
      alert("請先從素材庫選擇圖片或影片");
      return;
    }
    const platformCount = Math.max(1, selectedPlatforms.length);
    const deduction = await credits.tryDeduct("ai-social-post", platformCount);
    if (!deduction.ok) {
      alert(deduction.error || "點數不足");
      return;
    }
    setIsGeneratingCopy(true);
    setAltResult(null);
    try {
      const assetSummary =
        selectedAsset.meta?.prompt ||
        selectedAsset.meta?.summary ||
        `${selectedAsset.kind === "video" ? "影片素材" : "圖片素材"}：${selectedAsset.fileName}`;

      let imageDataUrl: string | undefined;
      if (selectedAsset.kind === "image") {
        try {
          const blob = await fetch(selectedAsset.url).then((response) => response.blob());
          imageDataUrl = await fileToDataUrl(blob);
        } catch {
          imageDataUrl = undefined;
        }
      }

      const gptPrompt =
        `你是資深社群行銷企劃，請根據以下資訊產生『可立即發佈』的繁體中文社群貼文。\n` +
        `不要給教學、不要給說明步驟、不要提到你是 AI。直接輸出可發佈內容。\n\n` +
        `目標平台：${selectedPlatforms.join(", ")}\n` +
        `素材描述：${assetSummary}\n` +
        (postTopic.trim() ? `貼文主題：${postTopic.trim()}\n` : "") +
        (postObjective.trim() ? `貼文目標：${postObjective.trim()}\n` : "") +
        `口吻設定：${selectedToneOption.label}。方向：${selectedToneOption.direction}\n` +
        `主題方向：${selectedThemeOption.label}。方向：${selectedThemeOption.direction}\n` +
        `貼文長度：${selectedLengthOption.label}。要求：${selectedLengthOption.direction}\n\n` +
        `caption 內容要求：\n` +
        `- 第一段：以目標客群痛點或期待切入\n` +
        `- 中段：描述使用者能得到的價值與差異化\n` +
        `- 結尾：明確 CTA（預約、私訊、留言）\n` +
        `- 嚴格遵守長度要求，不要過短也不要過長\n\n` +
        `輸出 JSON：{"title":"標題","caption":"貼文完整內容","hashtags":["#tag1","#tag2",...]}` +
        `\nhashtags 數量 10 個，不要重複。只輸出 JSON，不要其他文字。`;

      const callGpt = async () => {
        const res = await fetch("/api/ai/text-gpt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: gptPrompt, imageDataUrl, temperature: 0.6, jsonMode: true }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "DeepSeek 生成失敗");
        const rawText = (data.text || "{}").replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
        const jsonCandidate = rawText.match(/\{[\s\S]*\}/)?.[0] || rawText;
        const p = JSON.parse(jsonCandidate);
        return { title: ensureDatePrefix(p.title || "", toDate(new Date())), caption: p.caption || "", hashtags: (p.hashtags || []) as string[], model: `DeepSeek (${data.model || "deepseek-v3"})` };
      };

      const callGemini = async () => {
        const g = await requestJson<GenerateSocialPostResponse>("/api/ai/social/post", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platforms: selectedPlatforms, topic: postTopic.trim(), objective: postObjective.trim(),
            tone: postTone, theme: postTheme, length: postLength, hashtagCount: 10,
            asset: { kind: selectedAsset.kind, fileName: selectedAsset.fileName, summary: assetSummary, imageDataUrl },
          }),
        });
        return { title: ensureDatePrefix(g.title, toDate(new Date())), caption: g.caption, hashtags: g.hashtags, model: `Gemini (${g.model})` };
      };

      let resultTitle = "";
      let resultCaption = "";
      let resultHashtags: string[] = [];
      let resultModel = "";

      if (copyModelChoice === "both") {
        // 同時呼叫兩個模型，Gemini 為主、GPT 為對比
        const [geminiResult, gptResult] = await Promise.all([
          callGemini().catch(() => null),
          callGpt().catch(() => null),
        ]);
        if (geminiResult) {
          resultTitle = geminiResult.title;
          resultCaption = geminiResult.caption;
          resultHashtags = geminiResult.hashtags;
          resultModel = geminiResult.model;
        } else if (gptResult) {
          resultTitle = gptResult.title;
          resultCaption = gptResult.caption;
          resultHashtags = gptResult.hashtags;
          resultModel = gptResult.model;
        }
        if (gptResult) {
          setAltResult({ title: gptResult.title, caption: gptResult.caption, hashtags: gptResult.hashtags.join(" "), model: gptResult.model });
        }
      } else if (copyModelChoice === "gpt") {
        const r = await callGpt();
        resultTitle = r.title; resultCaption = r.caption; resultHashtags = r.hashtags; resultModel = r.model;
      } else {
        const r = await callGemini();
        resultTitle = r.title; resultCaption = r.caption; resultHashtags = r.hashtags; resultModel = r.model;
      }

      setPostTitle(resultTitle);
      setPostCaption(resultCaption);
      setPostHashtagsInput(resultHashtags.join(" "));
      setLastGeneratedModel(resultModel);

      void requestJson<ContentVaultSaveResponse>("/api/content/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userScopeId,
          kind: "social-post",
          title: resultTitle,
          summary: resultCaption.slice(0, 120),
          payload: {
            title: resultTitle,
            caption: resultCaption,
            hashtags: resultHashtags,
            model: resultModel,
            selectedAssetId: selectedAsset.id,
            selectedAssetFileName: selectedAsset.fileName,
            tone: postTone,
            theme: postTheme,
            length: postLength,
            platforms: selectedPlatforms,
            generatedAt: new Date().toISOString(),
          },
        }),
      }).then(() => void loadCopyHistory()).catch(() => undefined);
    } catch (error) {
      alert(error instanceof Error ? error.message : "文案生成失敗");
    } finally {
      setIsGeneratingCopy(false);
    }
  };

  const handleSchedulePost = () => {
    if (!postTitle.trim() || !postCaption.trim()) {
      alert("請先完成標題與內文");
      return;
    }
    if (!selectedAsset) {
      alert("請先選擇素材");
      return;
    }

    const item: ScheduleItem = {
      id: `sched_${Date.now()}`,
      title: ensureDatePrefix(postTitle, toDate(new Date())),
      platforms: selectedPlatforms,
      date: scheduleDate,
      time: scheduleTime,
      status: postPublishStatus,
    };
    setScheduleItems((prev) =>
      [item, ...prev].sort(
        (a, b) =>
          new Date(`${a.date}T${a.time}:00`).getTime() -
          new Date(`${b.date}T${b.time}:00`).getTime(),
      ),
    );
    setPostPublishStatus("draft");
    alert(`已排程：${scheduleDate} ${scheduleTime}`);
    void saveMarketingState();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <input
        ref={libraryUploadRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(event) => {
          void handleLibraryUpload(event);
        }}
      />
      <input
        ref={referenceUploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void handleReferenceUpload(event);
        }}
      />

      <div className="bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 rounded-2xl p-6 text-white shadow-lg">
        <h2 className="text-2xl font-bold">社群發文中心（素材庫驅動）</h2>
        <p className="text-sm text-white/90 mt-1">
          先在素材工具生成圖片/影片，再回到此中心選素材，讓 AI 讀取素材後生成文案、Hashtag 與社群預覽。
        </p>
      </div>

      {/* Social API Settings */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <button
          onClick={() => setShowApiSettings(!showApiSettings)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-semibold text-gray-800">社群平台 API 設定</span>
            <div className="flex gap-1.5 ml-2">
              {fbConnected && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] rounded-full">
                  <Facebook className="w-2.5 h-2.5" /> 已連接
                </span>
              )}
              {igConnected && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-pink-100 text-pink-700 text-[10px] rounded-full">
                  <Instagram className="w-2.5 h-2.5" /> 已連接
                </span>
              )}
              {!fbConnected && !igConnected && (
                <span className="text-[10px] text-gray-400">未設定</span>
              )}
            </div>
          </div>
          {showApiSettings ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </button>

        {showApiSettings && (
          <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-4">
            <p className="text-[11px] text-gray-500">
              填入 Facebook / Instagram API 憑證，即可從此頁直接發布貼文。憑證僅儲存於本機瀏覽器。
            </p>

            {/* Facebook */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Facebook className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-semibold text-gray-700">Facebook Page</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-gray-500">Page ID</label>
                  <input
                    value={fbPageId}
                    onChange={(e) => setFbPageId(e.target.value)}
                    placeholder="1234567890"
                    className="w-full text-xs border-gray-200 rounded-lg p-2 bg-white border"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">Page Access Token</label>
                  <input
                    value={fbAccessToken}
                    onChange={(e) => setFbAccessToken(e.target.value)}
                    type="password"
                    placeholder="EAAx..."
                    className="w-full text-xs border-gray-200 rounded-lg p-2 bg-white border"
                  />
                </div>
              </div>
            </div>

            {/* Instagram */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Instagram className="w-4 h-4 text-pink-600" />
                <span className="text-xs font-semibold text-gray-700">Instagram Business</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-gray-500">Business Account ID</label>
                  <input
                    value={igBusinessId}
                    onChange={(e) => setIgBusinessId(e.target.value)}
                    placeholder="17841234567890"
                    className="w-full text-xs border-gray-200 rounded-lg p-2 bg-white border"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">Access Token</label>
                  <input
                    value={igAccessToken}
                    onChange={(e) => setIgAccessToken(e.target.value)}
                    type="password"
                    placeholder="IGQx..."
                    className="w-full text-xs border-gray-200 rounded-lg p-2 bg-white border"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveApiSettings}
                className="px-4 py-1.5 bg-brand-600 text-white text-xs font-medium rounded-lg hover:bg-brand-700 transition-colors"
              >
                儲存設定
              </button>
              {apiSettingsSaved && (
                <span className="text-xs text-green-600 font-medium">已儲存</span>
              )}
              <a
                href="https://developers.facebook.com/docs/pages-api/getting-started"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-brand-600 hover:underline ml-auto"
              >
                如何取得 API Token？
              </a>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-900">素材庫（依使用者）</h3>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => libraryUploadRef.current?.click()}
                disabled={isUploadingAsset}
              >
                {isUploadingAsset ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                上傳
              </Button>
            </div>
            <div className="flex gap-2 mb-3">
              {(["all", "image", "video"] as AssetFilter[]).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setAssetFilter(filter)}
                  className={`px-2.5 py-1 rounded text-xs ${
                    assetFilter === filter ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {filter === "all" ? "全部" : filter === "image" ? "圖片" : "影片"}
                </button>
              ))}
            </div>
            <div className="relative mb-3">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" />
              <input
                value={assetSearch}
                onChange={(event) => setAssetSearch(event.target.value)}
                placeholder="搜尋檔案名稱"
                className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-xs"
              />
            </div>
            <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-2">
              <p className="mb-1 text-[11px] font-semibold text-gray-600">素材預覽</p>
              <div className="h-56 w-full overflow-hidden rounded bg-black flex items-center justify-center">
                {selectedAsset ? (
                  selectedAsset.kind === "video" ? (
                    <video
                      src={selectedAsset.url}
                      className="h-full w-full object-contain"
                      muted
                      controls
                      playsInline
                    />
                  ) : (
                    <img
                      src={resolveAssetImageSrc(selectedAsset)}
                      alt={selectedAsset.fileName}
                      className="h-full w-full object-contain bg-white"
                      onError={() => handleAssetImageError(selectedAsset)}
                    />
                  )
                ) : (
                  <span className="text-[11px] text-gray-400">尚未選擇素材</span>
                )}
              </div>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
              {isLoadingAssets ? (
                <p className="text-xs text-gray-500">讀取素材中...</p>
              ) : visibleAssets.length === 0 ? (
                <p className="text-xs text-gray-400">目前沒有素材，先到影片中心生成或在此上傳</p>
              ) : (
                visibleAssets.map((asset) => (
                  <button
                    key={asset.id}
                    onClick={() => setSelectedAssetId(asset.id)}
                    className={`w-full text-left rounded-lg border p-2.5 transition-colors ${
                      selectedAssetId === asset.id
                        ? "border-purple-500 bg-purple-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded border border-gray-200 bg-white">
                        {asset.kind === "video" ? (
                          <video
                            src={asset.url}
                            className="h-full w-full object-cover"
                            muted
                            playsInline
                            preload="metadata"
                          />
                        ) : (
                          <img
                            src={resolveAssetImageSrc(asset)}
                            alt={asset.fileName}
                            className="h-full w-full object-cover"
                            onError={() => handleAssetImageError(asset)}
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-gray-800 line-clamp-1">{asset.fileName}</p>
                          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                            {asset.kind === "video" ? "影片" : "圖片"}
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1">
                          {new Date(asset.createdAt).toLocaleString("zh-TW", {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
            <h3 className="font-bold text-gray-900">社群圖片生成</h3>
            <textarea
              value={imagePrompt}
              onChange={(event) => setImagePrompt(event.target.value)}
              placeholder="輸入想要的社群圖片內容（例如：新品預告、活動倒數、案例前後對比）"
              className="w-full h-24 border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
            />
            <select
              value={selectedImageStyleId}
              onChange={(event) => setSelectedImageStyleId(event.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {IMAGE_STYLE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => referenceUploadRef.current?.click()}
                className="gap-1"
              >
                <Upload className="w-3.5 h-3.5" />
                上傳參考圖（選填）
              </Button>
              {referenceImageDataUrl && <span className="text-[11px] text-gray-500 self-center">已載入參考圖</span>}
            </div>
            <Button
              onClick={() => void handleGenerateSocialImage()}
              disabled={isGeneratingImage}
              className="gap-2 bg-pink-600 hover:bg-pink-700"
            >
              {isGeneratingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {isGeneratingImage ? "背景生成中（可切換介面）" : "生成圖片並存入素材庫"}
            </Button>
            {socialImageTaskNotice && (
              <p className="text-[11px] text-blue-700 rounded border border-blue-200 bg-blue-50 px-2 py-1.5">
                {socialImageTaskNotice}
                {socialImageTask?.model ? `（模型：${socialImageTask.model}）` : ""}
              </p>
            )}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
              <p className="mb-1 text-[11px] font-semibold text-gray-600">生活感社群圖預覽</p>
              <div className="h-44 w-full overflow-hidden rounded bg-white flex items-center justify-center border border-gray-200">
                {generatedImagePreviewUrl ? (
                  <img
                    src={generatedImagePreviewUrl}
                    alt="generated-social-preview"
                    className="h-full w-full object-contain"
                    onError={() => {
                      if (
                        generatedImagePreviewFallbackUrl &&
                        generatedImagePreviewUrl !== generatedImagePreviewFallbackUrl
                      ) {
                        setGeneratedImagePreviewUrl(generatedImagePreviewFallbackUrl);
                      }
                    }}
                  />
                ) : (
                  <span className="text-[11px] text-gray-400">生成後會在此顯示預覽</span>
                )}
              </div>
              {generatedImagePreviewSummary && (
                <p className="mt-2 text-[11px] text-gray-600 line-clamp-3">{generatedImagePreviewSummary}</p>
              )}
              {generatedImagePreviewFileName && (
                <p className="mt-1 text-[11px] text-green-700">
                  已存入素材庫：{generatedImagePreviewFileName}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="xl:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4">
            <h3 className="font-bold text-gray-900">1. 發文目標與平台</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {PLATFORM_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  onClick={() => togglePlatform(option.id)}
                  className={`p-3 rounded-lg border text-left ${
                    selectedPlatforms.includes(option.id)
                      ? "border-purple-500 bg-purple-50 text-purple-700"
                      : "border-gray-200 text-gray-600"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {platformIcon(option.id)}
                    <span className="text-sm font-semibold">{option.label}</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <input
                value={postTopic}
                onChange={(event) => setPostTopic(event.target.value)}
                placeholder="貼文主題"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <input
                value={postObjective}
                onChange={(event) => setPostObjective(event.target.value)}
                placeholder="內容目標（例如：導流、教育、轉換）"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900">2. AI 讀取素材後生成文案</h3>
              <span className="text-xs text-gray-500">
                {selectedAsset ? `已選素材：${selectedAsset.kind === "video" ? "影片" : "圖片"}` : "尚未選擇素材"}
              </span>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
              系統會直接根據你選的素材（圖片/影片）自動判斷合適篇幅與語氣，產生可直接發布的貼文內容。
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">口吻</label>
                <select
                  value={postTone}
                  onChange={(event) => setPostTone(event.target.value as PostTone)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  {POST_TONE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">貼文主題面向</label>
                <select
                  value={postTheme}
                  onChange={(event) => setPostTheme(event.target.value as PostTheme)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  {POST_THEME_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">貼文長度</label>
                <select
                  value={postLength}
                  onChange={(event) => setPostLength(event.target.value as PostLength)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  {POST_LENGTH_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="rounded-lg border border-purple-100 bg-purple-50 p-3 text-xs text-purple-800 space-y-1">
              <p className="font-semibold">本次撰寫方向建議</p>
              <p>口吻：{selectedToneOption.direction}</p>
              <p>主題：{selectedThemeOption.direction}</p>
              <p>長度：{selectedLengthOption.direction}</p>
            </div>
            <div className="flex gap-1.5 mb-2">
              <button
                onClick={() => setCopyModelChoice("both")}
                className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  copyModelChoice === "both"
                    ? "border-purple-500 bg-purple-50 text-purple-700 ring-1 ring-purple-500"
                    : "border-gray-200 text-gray-600 hover:border-purple-300"
                }`}
              >
                雙模型對比
              </button>
              <button
                onClick={() => setCopyModelChoice("gemini")}
                className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  copyModelChoice === "gemini"
                    ? "border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-500"
                    : "border-gray-200 text-gray-600 hover:border-blue-300"
                }`}
              >
                Gemini
              </button>
              <button
                onClick={() => setCopyModelChoice("gpt")}
                className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  copyModelChoice === "gpt"
                    ? "border-green-500 bg-green-50 text-green-700 ring-1 ring-green-500"
                    : "border-gray-200 text-gray-600 hover:border-green-300"
                }`}
              >
                DeepSeek
              </button>
            </div>
            <Button
              onClick={() => void handleGenerateCopy()}
              disabled={isGeneratingCopy}
              className="gap-2 bg-purple-600 hover:bg-purple-700"
            >
              {isGeneratingCopy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              AI 讀取素材並生成文案
            </Button>

            <input
              value={postTitle}
              onChange={(event) => setPostTitle(event.target.value)}
              placeholder="貼文標題"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-semibold"
            />
            <textarea
              value={postCaption}
              onChange={(event) => setPostCaption(event.target.value)}
              placeholder="貼文內文"
              className="w-full h-36 border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
            />
            <div className="relative">
              <Hash className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
              <input
                value={postHashtagsInput}
                onChange={(event) => setPostHashtagsInput(event.target.value)}
                placeholder="Hashtags（空白分隔）"
                className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm text-blue-700 bg-gray-50"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-3">社群預覽（素材 + 文案）</h3>
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="p-3 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                    {platformIcon(selectedPlatforms[0] || "instagram")}
                    {PLATFORM_OPTIONS.find((item) => item.id === (selectedPlatforms[0] || "instagram"))?.label}
                  </div>
                  <span className="text-[10px] text-gray-400">Preview</span>
                </div>
                <div className="aspect-square bg-gray-50 flex items-center justify-center">
                  {selectedAsset ? (
                    selectedAsset.kind === "video" ? (
                      <video src={selectedAsset.url} className="w-full h-full object-contain" controls muted />
                    ) : (
                      <img
                        src={resolveAssetImageSrc(selectedAsset)}
                        className="w-full h-full object-contain"
                        alt="selected-asset"
                        onError={() => handleAssetImageError(selectedAsset)}
                      />
                    )
                  ) : (
                    <ImageIcon className="w-10 h-10 text-gray-300" />
                  )}
                </div>
                <div className="p-3">
                  <p className="text-sm font-bold text-gray-900">{postTitle || "尚未輸入標題"}</p>
                  <p className="text-xs text-gray-700 mt-2 whitespace-pre-wrap line-clamp-5">
                    {postCaption || "這裡會顯示貼文內容預覽。"}
                  </p>
                  <p className="text-xs text-blue-700 mt-2">{hashtags.join(" ")}</p>
                </div>
              </div>
            </div>

            {/* GPT 對比結果 */}
            {altResult && (
              <div className="bg-white rounded-xl border-2 border-green-200 p-4 shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-green-700 text-sm flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    DeepSeek 對比版本
                    <span className="text-[10px] font-normal text-green-500">({altResult.model})</span>
                  </h3>
                  <button
                    onClick={() => {
                      setPostTitle(altResult.title);
                      setPostCaption(altResult.caption);
                      setPostHashtagsInput(altResult.hashtags);
                      setLastGeneratedModel(altResult.model);
                      setAltResult(null);
                    }}
                    className="text-[11px] text-green-600 border border-green-300 px-2 py-0.5 rounded hover:bg-green-50"
                  >
                    採用此版本
                  </button>
                </div>
                <p className="text-sm font-bold text-gray-800">{altResult.title}</p>
                <p className="text-xs text-gray-600 whitespace-pre-wrap line-clamp-5">{altResult.caption}</p>
                <p className="text-[11px] text-blue-600">{altResult.hashtags}</p>
              </div>
            )}

            {/* 文案歷史 */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <button
                onClick={() => setShowCopyHistory(!showCopyHistory)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <span className="text-sm font-bold text-gray-900">文案歷史（{copyHistory.length}）</span>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showCopyHistory ? "rotate-180" : ""}`} />
              </button>
              {showCopyHistory && copyHistory.length > 0 && (
                <div className="border-t border-gray-100 max-h-80 overflow-y-auto divide-y divide-gray-100">
                  {copyHistory.map((item) => (
                    <div key={item.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-semibold text-gray-800 truncate flex-1">{item.title}</p>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className="text-[9px] text-gray-400">{item.model}</span>
                          <button
                            onClick={() => {
                              setPostTitle(item.title);
                              setPostCaption(item.caption);
                              setPostHashtagsInput(item.hashtags);
                              setLastGeneratedModel(item.model);
                            }}
                            className="text-[10px] text-brand-600 border border-brand-200 px-1.5 py-0.5 rounded hover:bg-brand-50"
                          >
                            套用
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-gray-600 line-clamp-2">{item.caption}</p>
                      <p className="text-[10px] text-gray-400 mt-1">
                        {new Date(item.createdAt).toLocaleString("zh-TW")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {showCopyHistory && copyHistory.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-gray-400 border-t border-gray-100">
                  尚無歷史文案，生成文案後會自動儲存
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
              <h3 className="font-bold text-gray-900">排程</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="relative">
                  <Calendar className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={(event) => setScheduleDate(event.target.value)}
                    className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm"
                  />
                </div>
                <div className="relative">
                  <Clock className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={(event) => setScheduleTime(event.target.value)}
                    className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm"
                  />
                </div>
              </div>
              <Button onClick={handleSchedulePost} className="gap-2 bg-brand-600 hover:bg-brand-700">
                <Send className="w-4 h-4" />
                加入排程
              </Button>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                <p className="text-[11px] text-gray-600 mb-1">貼文狀態（預設：草稿）</p>
                <div className="flex items-center gap-4 text-sm">
                  <label className="inline-flex items-center gap-2 text-gray-700">
                    <input
                      type="checkbox"
                      checked={postPublishStatus === "draft"}
                      onChange={() => setPostPublishStatus("draft")}
                    />
                    草稿
                  </label>
                  <label className="inline-flex items-center gap-2 text-gray-700">
                    <input
                      type="checkbox"
                      checked={postPublishStatus === "published"}
                      onChange={() => setPostPublishStatus("published")}
                    />
                    已發布
                  </label>
                </div>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                {scheduleItems.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-lg border p-3 ${
                      item.status === "published" ? "border-green-200 bg-green-50/70" : "border-gray-200 bg-gray-50/50"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-semibold text-gray-800 line-clamp-1">{item.title}</p>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded ${
                          item.status === "published"
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-200 text-gray-700"
                        }`}
                      >
                        {item.status === "published" ? "已發布" : "草稿"}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500">
                      {item.date} {item.time}
                    </p>
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {item.platforms.map((platform) => (
                        <span key={`${item.id}_${platform}`} className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                          {PLATFORM_OPTIONS.find((opt) => opt.id === platform)?.label}
                        </span>
                      ))}
                    </div>
                    <label className="mt-2 text-[11px] text-brand-700 inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={item.status === "published"}
                        onChange={(event) =>
                          setScheduleItems((prev) =>
                            prev.map((entry) =>
                              entry.id === item.id
                                ? { ...entry, status: event.target.checked ? "published" : "draft" }
                                : entry,
                            ),
                          )
                        }
                      />
                      已發布
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {lastGeneratedModel && (
            <div className="text-xs text-gray-500">
              最近一次文案模型：{lastGeneratedModel}。素材來源：{selectedAsset?.meta?.origin || "未知來源"}。
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
