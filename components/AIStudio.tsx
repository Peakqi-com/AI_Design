import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "./Button";
import {
  CheckCircle2,
  Download,
  History,
  Image as ImageIcon,
  RefreshCw,
  Sliders,
  Sparkles,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { resolveClientUserScopeId } from "@/lib/client/user-scope";

interface RenderHistoryItem {
  id: string;
  imageDataUrl: string;
  summary: string;
  model: string;
  roomType: string;
  style: string;
  createdAt: string;
}

const areRenderHistoryListsEqual = (a: RenderHistoryItem[], b: RenderHistoryItem[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (
      a[i].id !== b[i].id ||
      a[i].imageDataUrl !== b[i].imageDataUrl ||
      a[i].createdAt !== b[i].createdAt
    ) {
      return false;
    }
  }
  return true;
};

interface RenderApiResponse {
  imageDataUrl: string;
  summary: string;
  model: string;
  elapsedMs: number;
}

interface RefineApiResponse {
  imageDataUrl: string;
  summary: string;
  model: string;
  elapsedMs: number;
}

interface UpscaleApiResponse {
  imageDataUrl: string;
  width: number;
  height: number;
  scaleApplied: number;
  format: "jpeg" | "png" | "webp";
}

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
    origin?: string;
    summary?: string;
    style?: string;
    roomType?: string;
    model?: string;
    prompt?: string;
  };
}

interface SocialAssetListResponse {
  items?: SocialAssetApiItem[];
}

interface SocialAssetSaveResponse {
  item?: SocialAssetApiItem;
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

interface DressProfilePayload {
  selectedDressId: string;
  selectedDressName: string;
  selectedDressSpec: string;
  selectedDressPreviewUrl: string;
  dressSourceLabel: string;
  customDressAssetId?: string;
  customDressDataUrl?: string;
}

interface ProjectListItem {
  id: string;
  name: string;
  clientName: string;
}

interface ProjectDetailItem extends ProjectListItem {
  dressSelectionRecords?: Array<{
    id: string;
    dressName: string;
    dressSpec?: string;
    sourceLabel?: string;
    referenceAssetId?: string;
    referenceImageUrl?: string;
    generatedImageUrl?: string;
    summary?: string;
    model?: string;
    note?: string;
    createdAt: string;
    updatedAt?: string;
  }>;
}

interface DressPreset {
  id: string;
  name: string;
  spec: string;
  previewUrl: string;
}

const DRESS_PRESETS: DressPreset[] = [
  {
    id: "dress_ballroom_lace",
    name: "皇室澎裙蕾絲",
    spec: "大澎裙、立體蕾絲刺繡、亮片珠飾、收腰長拖尾",
    previewUrl:
      "https://images.unsplash.com/photo-1520854221256-17451cc331bf?auto=format&fit=crop&q=80&w=900",
  },
  {
    id: "dress_light_a_line",
    name: "輕盈 A-Line",
    spec: "A-Line 裙型、透紗層次、低調腰線、自然垂墜",
    previewUrl:
      "https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&q=80&w=900",
  },
  {
    id: "dress_off_shoulder",
    name: "深 V 公主袖",
    spec: "深 V 胸口、薄紗公主袖、蕾絲胸身、蓬裙輪廓",
    previewUrl:
      "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&q=80&w=900",
  },
  {
    id: "dress_satin_strapless",
    name: "緞面平口澎裙",
    spec: "平口緞面上身、硬挺腰封、極簡澎裙、大面積緞光",
    previewUrl:
      "https://images.unsplash.com/photo-1522673607200-164d1b6ce486?auto=format&fit=crop&q=80&w=900",
  },
  {
    id: "dress_classic_lace",
    name: "經典法式蕾絲",
    spec: "法式蕾絲圖騰、心形領、A 字長裙、細緻珠繡",
    previewUrl:
      "https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&q=80&w=900",
  },
];

const MODEL_OPTIONS = [
  { value: "auto", label: "自動（畫質優先）" },
  { value: "gemini-3-pro-image-preview", label: "Gemini 3 Pro Image（建議，寫實度高）" },
  { value: "gemini-3.1-flash-image-preview", label: "Gemini 3.1 Flash Image（較快）" },
  { value: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image（平衡）" },
  {
    value: "gemini-2.0-flash-exp-image-generation",
    label: "Gemini 2.0 Flash Image（較快）",
  },
];
const OUTPUT_QUALITY_OPTIONS = [
  { value: "standard", label: "標準（較快）" },
  { value: "detail", label: "細節修復（較清晰）" },
  { value: "hd2x", label: "高清 2x（較清晰）" },
] as const;
const SAMPLE_SKETCH_URL =
  "https://images.unsplash.com/photo-1525258946800-98cfd641d0de?auto=format&fit=crop&q=80&w=1600";

const formatTime = (iso: string): string =>
  new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

const formatFileDate = (date = new Date()): string => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

const toDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("圖片讀取失敗"));
    reader.readAsDataURL(blob);
  });

const estimateDataUrlBytes = (dataUrl: string): number => {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) {
    return dataUrl.length;
  }
  const base64 = dataUrl.slice(comma + 1);
  return Math.floor((base64.length * 3) / 4);
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("圖片載入失敗"));
    image.src = src;
  });

const optimizeImageDataUrl = async (
  sourceDataUrl: string,
  options?: { maxEdge?: number; softLimitBytes?: number },
): Promise<string> => {
  const maxEdge = Math.max(720, Math.min(2200, options?.maxEdge ?? 1600));
  const softLimitBytes = Math.max(400_000, options?.softLimitBytes ?? 2_200_000);
  const image = await loadImage(sourceDataUrl);
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const width = Math.max(2, Math.round((image.naturalWidth || 1) * scale));
  const height = Math.max(2, Math.round((image.naturalHeight || 1) * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return sourceDataUrl;
  }
  ctx.drawImage(image, 0, 0, width, height);

  const qualitySteps = [0.9, 0.82, 0.74, 0.66, 0.58];
  let latest = canvas.toDataURL("image/jpeg", qualitySteps[0]);
  if (estimateDataUrlBytes(latest) <= softLimitBytes) {
    return latest;
  }
  for (const quality of qualitySteps) {
    const candidate = canvas.toDataURL("image/jpeg", quality);
    latest = candidate;
    if (estimateDataUrlBytes(candidate) <= softLimitBytes) {
      return candidate;
    }
  }
  return latest;
};

const dataUrlToFile = async (dataUrl: string, fileName: string): Promise<File> => {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error("無法轉換生成圖片檔案。");
  }
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "image/jpeg" });
};

const tryParseJson = <T,>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const requestJson = async <T,>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const raw = await response.text();
  const payload = raw ? tryParseJson<T & { error?: string }>(raw) : null;
  if (!response.ok) {
    throw new Error(payload?.error || `請求失敗（${response.status}）`);
  }
  if (!payload) {
    throw new Error("伺服器回傳非 JSON。");
  }
  return payload as T;
};

const getImageDimensions = (imageDataUrl: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("無法取得圖片尺寸"));
    image.src = imageDataUrl;
  });

export const AIStudio: React.FC = () => {
  const { data: session } = useSession();
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>("未命名圖片");
  const [selectedDressId, setSelectedDressId] = useState<string>(DRESS_PRESETS[0].id);
  const [selectedDressName, setSelectedDressName] = useState<string>(DRESS_PRESETS[0].name);
  const [selectedDressSpec, setSelectedDressSpec] = useState<string>(DRESS_PRESETS[0].spec);
  const [selectedDressPreviewUrl, setSelectedDressPreviewUrl] = useState<string>(
    DRESS_PRESETS[0].previewUrl,
  );
  const [selectedDressDataUrl, setSelectedDressDataUrl] = useState<string | null>(null);
  const [customDressAssetId, setCustomDressAssetId] = useState<string | null>(null);
  const [isDressLoading, setIsDressLoading] = useState(false);
  const [dressSourceLabel, setDressSourceLabel] = useState("預設婚紗");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [resultSummary, setResultSummary] = useState<string>("");
  const [resultMeta, setResultMeta] = useState<string>("");
  const [viewMode, setViewMode] = useState<"result" | "compare">("result");
  const [roomType, setRoomType] = useState("宴客主視覺");
  const [selectedModel, setSelectedModel] = useState("gemini-3-pro-image-preview");
  const [outputQuality, setOutputQuality] =
    useState<(typeof OUTPUT_QUALITY_OPTIONS)[number]["value"]>("hd2x");
  const [customPrompt, setCustomPrompt] = useState("");
  const [creativity, setCreativity] = useState(10);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [generationStatusText, setGenerationStatusText] = useState("AI 運算中...");
  const [renderHistory, setRenderHistory] = useState<RenderHistoryItem[]>([]);
  const [userScopeId, setUserScopeId] = useState("guest_server");
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectRecordNotice, setProjectRecordNotice] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dressInputRef = useRef<HTMLInputElement>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dressDataCacheRef = useRef<Record<string, string>>({});
  const dressProfileLoadedRef = useRef(false);

  const toRenderHistoryItem = useCallback((asset: SocialAssetApiItem): RenderHistoryItem | null => {
    if (asset.kind !== "image") {
      return null;
    }
    if ((asset.meta?.origin || "") !== "ai-studio") {
      return null;
    }
    return {
      id: asset.id,
      imageDataUrl: asset.url,
      summary: asset.meta?.summary || "",
      model: asset.meta?.model || "AI Studio",
      roomType: asset.meta?.roomType || "婚禮場景",
      style: asset.meta?.style || "婚紗試穿",
      createdAt: asset.createdAt,
    };
  }, []);

  const loadServerHistory = useCallback(async () => {
    if (!userScopeId) {
      return;
    }
    try {
      const payload = await requestJson<SocialAssetListResponse>(
        `/api/social/assets?userId=${encodeURIComponent(userScopeId)}&kind=image&limit=30`,
        { method: "GET" },
      );
      const next = (payload.items || [])
        .map((item) => toRenderHistoryItem(item))
        .filter((item): item is RenderHistoryItem => Boolean(item));
      const trimmed = next.slice(0, 20);
      setRenderHistory((prev) => {
        // Avoid flicker when backend briefly returns empty history.
        if (trimmed.length === 0 && prev.length > 0) {
          return prev;
        }
        return areRenderHistoryListsEqual(prev, trimmed) ? prev : trimmed;
      });
    } catch {
      // ignore history load error to avoid blocking generation
    }
  }, [toRenderHistoryItem, userScopeId]);

  const saveResultToServer = useCallback(
    async (input: { imageDataUrl: string; summary: string; modelTag: string; roomType: string; style: string }) => {
      const file = await dataUrlToFile(input.imageDataUrl, `ai-studio-${formatFileDate()}.jpg`);
      const formData = new FormData();
      formData.append("userId", userScopeId);
      formData.append("kind", "image");
      formData.append("file", file);
      formData.append(
        "meta",
        JSON.stringify({
          origin: "ai-studio",
          summary: input.summary,
          style: input.style,
          roomType: input.roomType,
          model: input.modelTag,
          prompt: customPrompt.trim(),
        }),
      );
      const payload = await requestJson<SocialAssetSaveResponse>("/api/social/assets", {
        method: "POST",
        body: formData,
      });
      if (!payload.item) {
        throw new Error("伺服器未回傳已儲存素材。");
      }
      return payload.item;
    },
    [customPrompt, userScopeId],
  );

  const uploadDressToServer = useCallback(
    async (file: File, dressName: string, dressSpec: string): Promise<SocialAssetApiItem> => {
      const formData = new FormData();
      formData.append("userId", userScopeId);
      formData.append("kind", "image");
      formData.append("file", file);
      formData.append(
        "meta",
        JSON.stringify({
          origin: "ai-studio",
          style: dressName,
          summary: `婚紗參考圖：${dressSpec}`,
          prompt: "ai-studio-dress-reference",
        }),
      );
      const payload = await requestJson<SocialAssetSaveResponse>("/api/social/assets", {
        method: "POST",
        body: formData,
      });
      if (!payload.item) {
        throw new Error("伺服器未回傳婚紗素材。");
      }
      return payload.item;
    },
    [userScopeId],
  );

  const saveDressProfileToServer = useCallback(
    async (payload: DressProfilePayload) => {
      if (!userScopeId) {
        return;
      }
      await requestJson<ContentVaultSaveResponse>("/api/content/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userScopeId,
          kind: "general",
          title: "AI Studio 婚紗設定",
          summary: `${payload.selectedDressName}（${payload.dressSourceLabel}）`,
          upsertKey: "ai_studio_dress_profile",
          payload,
        }),
      });
    },
    [userScopeId],
  );

  const restoreDressProfileFromServer = useCallback(async () => {
    if (!userScopeId || dressProfileLoadedRef.current) {
      return;
    }
    dressProfileLoadedRef.current = true;
    try {
      const [vaultResult, assetResult] = await Promise.allSettled([
        requestJson<ContentVaultListResponse>(
          `/api/content/vault?userId=${encodeURIComponent(userScopeId)}&kind=general&limit=20`,
          { method: "GET" },
        ),
        requestJson<SocialAssetListResponse>(
          `/api/social/assets?userId=${encodeURIComponent(userScopeId)}&kind=image&limit=120`,
          { method: "GET" },
        ),
      ]);
      const vaultPayload =
        vaultResult.status === "fulfilled" ? vaultResult.value : ({ items: [] } as ContentVaultListResponse);
      const assetPayload =
        assetResult.status === "fulfilled" ? assetResult.value : ({ items: [] } as SocialAssetListResponse);

      const profileItem = (vaultPayload.items || []).find(
        (item) => item.upsertKey === "ai_studio_dress_profile",
      );
      if (!profileItem?.payload || typeof profileItem.payload !== "object") {
        return;
      }

      const profile = profileItem.payload as Partial<DressProfilePayload>;
      const nextId = profile.selectedDressId?.trim() || DRESS_PRESETS[0].id;
      const nextName = profile.selectedDressName?.trim() || DRESS_PRESETS[0].name;
      const nextSpec = profile.selectedDressSpec?.trim() || DRESS_PRESETS[0].spec;
      const nextLabel = profile.dressSourceLabel?.trim() || "預設婚紗";
      const nextPreview = profile.selectedDressPreviewUrl?.trim() || DRESS_PRESETS[0].previewUrl;
      const nextCustomAssetId = profile.customDressAssetId?.trim() || "";
      const nextCustomDressDataUrl =
        typeof profile.customDressDataUrl === "string" ? profile.customDressDataUrl.trim() : "";

      setSelectedDressId(nextId);
      setSelectedDressName(nextName);
      setSelectedDressSpec(nextSpec);
      setDressSourceLabel(nextLabel);
      setSelectedDressPreviewUrl(nextPreview);
      setCustomDressAssetId(nextCustomAssetId || null);
      setIsDressLoading(true);

      try {
        const asset = nextCustomAssetId
          ? (assetPayload.items || []).find((item) => item.id === nextCustomAssetId)
          : undefined;
        const sourceUrl = asset?.url || nextPreview;
        const response = await fetch(sourceUrl);
        if (!response.ok) {
          throw new Error("婚紗圖片載入失敗");
        }
        const blob = await response.blob();
        const dataUrl = await toDataUrl(blob);
        dressDataCacheRef.current[nextId] = dataUrl;
        setSelectedDressDataUrl(dataUrl);
        if (asset?.url) {
          setSelectedDressPreviewUrl(asset.url);
        }
      } catch {
        if (nextCustomDressDataUrl.startsWith("data:image/")) {
          dressDataCacheRef.current[nextId] = nextCustomDressDataUrl;
          setSelectedDressDataUrl(nextCustomDressDataUrl);
          setSelectedDressPreviewUrl(nextCustomDressDataUrl);
        }
      } finally {
        setIsDressLoading(false);
      }
    } catch {
      // ignore restore failure and keep default preset
    }
  }, [userScopeId]);

  const loadProjects = useCallback(async () => {
    try {
      const payload = await requestJson<{ projects?: ProjectListItem[] }>("/api/projects?includeFiled=1", {
        method: "GET",
      });
      const next = Array.isArray(payload.projects) ? payload.projects : [];
      setProjects(next);
      setSelectedProjectId((current) => (current && next.some((project) => project.id === current) ? current : ""));
    } catch {
      setProjects([]);
    }
  }, []);

  const appendDressRecordToProject = useCallback(
    async (input: {
      generatedImageUrl: string;
      summary: string;
      modelTag: string;
    }) => {
      if (!selectedProjectId) {
        return;
      }
      const detail = await requestJson<{ project: ProjectDetailItem }>(`/api/projects/${selectedProjectId}`, {
        method: "GET",
      });
      const now = new Date().toISOString();
      const nextRecords = [
        {
          id: `dress_${Date.now()}`,
          dressName: selectedDressName,
          dressSpec: selectedDressSpec,
          sourceLabel: dressSourceLabel,
          referenceAssetId: customDressAssetId || "",
          referenceImageUrl: selectedDressPreviewUrl,
          generatedImageUrl: input.generatedImageUrl,
          summary: input.summary,
          model: input.modelTag,
          note: "",
          createdAt: now,
          updatedAt: now,
        },
        ...((detail.project.dressSelectionRecords || []).slice(0, 199)),
      ];
      await requestJson<{ project: ProjectDetailItem }>(`/api/projects/${selectedProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dressSelectionRecords: nextRecords,
        }),
      });
      const targetName = projects.find((project) => project.id === selectedProjectId)?.name || "專案";
      setProjectRecordNotice(`已將本次婚紗試穿紀錄存入專案：${targetName}`);
    },
    [
      customDressAssetId,
      dressSourceLabel,
      projects,
      selectedDressName,
      selectedDressPreviewUrl,
      selectedDressSpec,
      selectedProjectId,
    ],
  );

  const stopProgressAnimation = useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setGenerationProgress(0);
  }, []);

  const startProgressAnimation = useCallback(() => {
    setGenerationProgress(18);
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
    }
    progressTimerRef.current = setInterval(() => {
      setGenerationProgress((prev) => {
        if (prev >= 90) {
          return 90;
        }
        return Math.min(90, prev + Math.floor(Math.random() * 8 + 3));
      });
    }, 650);
  }, []);

  useEffect(() => () => stopProgressAnimation(), [stopProgressAnimation]);

  useEffect(() => {
    const sessionUser = session?.user as { id?: string; email?: string | null } | undefined;
    setUserScopeId(resolveClientUserScopeId(sessionUser?.id || null, sessionUser?.email || null));
  }, [session?.user]);

  useEffect(() => {
    dressProfileLoadedRef.current = false;
  }, [userScopeId]);

  useEffect(() => {
    void loadServerHistory();
  }, [loadServerHistory]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void restoreDressProfileFromServer();
  }, [restoreDressProfileFromServer]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleClear = () => {
    setUploadedImage(null);
    setUploadedFileName("未命名圖片");
    setResultImage(null);
    setResultSummary("");
    setResultMeta("");
    setErrorMessage(null);
    setViewMode("result");
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const dataUrl = await toDataUrl(file);
      setUploadedImage(dataUrl);
      setUploadedFileName(file.name || "uploaded-image");
      setResultImage(null);
      setResultSummary("");
      setResultMeta("");
      setErrorMessage(null);
      setViewMode("result");
    } catch {
      setErrorMessage("圖片讀取失敗，請改用 JPG / PNG / WebP 格式重試。");
    } finally {
      event.target.value = "";
    }
  };

  const selectDressPreset = useCallback(
    async (preset: DressPreset, options?: { persist?: boolean }) => {
      const shouldPersist = options?.persist ?? true;
      setSelectedDressId(preset.id);
      setSelectedDressName(preset.name);
      setSelectedDressSpec(preset.spec);
      setSelectedDressPreviewUrl(preset.previewUrl);
      setDressSourceLabel("預設婚紗");
      setCustomDressAssetId(null);
      setErrorMessage(null);

      const cached = dressDataCacheRef.current[preset.id];
      if (cached) {
        setSelectedDressDataUrl(cached);
        if (shouldPersist) {
          void saveDressProfileToServer({
            selectedDressId: preset.id,
            selectedDressName: preset.name,
            selectedDressSpec: preset.spec,
            selectedDressPreviewUrl: preset.previewUrl,
            dressSourceLabel: "預設婚紗",
          });
        }
        return;
      }

      setIsDressLoading(true);
      try {
        const response = await fetch(preset.previewUrl);
        if (!response.ok) {
          throw new Error("婚紗參考圖載入失敗");
        }
        const blob = await response.blob();
        const dataUrl = await toDataUrl(blob);
        dressDataCacheRef.current[preset.id] = dataUrl;
        setSelectedDressDataUrl(dataUrl);
        if (shouldPersist) {
          void saveDressProfileToServer({
            selectedDressId: preset.id,
            selectedDressName: preset.name,
            selectedDressSpec: preset.spec,
            selectedDressPreviewUrl: preset.previewUrl,
            dressSourceLabel: "預設婚紗",
          });
        }
      } catch {
        setSelectedDressDataUrl(null);
        setErrorMessage("預設婚紗圖載入失敗，請改用「上傳自訂婚紗圖」重試。");
      } finally {
        setIsDressLoading(false);
      }
    },
    [saveDressProfileToServer],
  );

  useEffect(() => {
    void selectDressPreset(DRESS_PRESETS[0], { persist: false });
  }, [selectDressPreset]);

  const handleCustomDressUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setErrorMessage("自訂婚紗圖只接受圖片格式（JPG/PNG/WebP）。");
      return;
    }

    setIsDressLoading(true);
    setErrorMessage(null);
    try {
      const rawDataUrl = await toDataUrl(file);
      const dataUrl = await optimizeImageDataUrl(rawDataUrl, {
        maxEdge: 1600,
        softLimitBytes: 2_200_000,
      });
      const optimizedFile = await dataUrlToFile(dataUrl, `${file.name || "custom-dress"}.jpg`);
      const dressName = file.name || "自訂婚紗";
      const dressSpec = "使用者上傳婚紗參考圖，請精準套用同款婚紗版型與細節。";
      setSelectedDressId("custom_upload");
      setSelectedDressName(dressName);
      setSelectedDressSpec(dressSpec);
      setSelectedDressPreviewUrl(dataUrl);
      setSelectedDressDataUrl(dataUrl);
      setDressSourceLabel("自訂婚紗");
      setCustomDressAssetId(null);

      let savedAsset: SocialAssetApiItem | null = null;
      try {
        let uploadError: unknown = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            savedAsset = await uploadDressToServer(optimizedFile, dressName, dressSpec);
            break;
          } catch (error) {
            uploadError = error;
            if (attempt < 2) {
              await new Promise((resolve) => setTimeout(resolve, 360 * (attempt + 1)));
            }
          }
        }
        if (!savedAsset) {
          throw (uploadError instanceof Error ? uploadError : new Error("婚紗素材儲存失敗"));
        }
        if (savedAsset?.url) {
          setSelectedDressPreviewUrl(savedAsset.url);
        }
        setCustomDressAssetId(savedAsset.id);
      } catch (saveError) {
        setErrorMessage(
          saveError instanceof Error
            ? `${saveError.message}，婚紗已套用但尚未成功儲存到伺服器。`
            : "婚紗已套用但尚未成功儲存到伺服器。",
        );
      }

      await saveDressProfileToServer({
        selectedDressId: "custom_upload",
        selectedDressName: dressName,
        selectedDressSpec: dressSpec,
        selectedDressPreviewUrl: savedAsset?.url || dataUrl,
        dressSourceLabel: "自訂婚紗",
        customDressAssetId: savedAsset?.id,
        customDressDataUrl: dataUrl,
      });
    } catch {
      setErrorMessage("自訂婚紗圖讀取失敗，請更換圖片後重試。");
    } finally {
      setIsDressLoading(false);
    }
  };

  const loadSampleImage = async () => {
    setErrorMessage(null);
    try {
      const response = await fetch(SAMPLE_SKETCH_URL);
      if (!response.ok) {
        throw new Error("載入範例圖失敗");
      }
      const blob = await response.blob();
      const dataUrl = await toDataUrl(blob);
      setUploadedImage(dataUrl);
      setUploadedFileName("sample-wedding-look.jpg");
      setResultImage(null);
      setResultSummary("");
      setResultMeta("");
      setViewMode("result");
    } catch {
      setErrorMessage("範例圖載入失敗，請改用本機圖片上傳。");
    }
  };

  const toggleViewMode = () => {
    setViewMode((prev) => (prev === "result" ? "compare" : "result"));
  };

  const requestUpscale = async (imageDataUrl: string): Promise<UpscaleApiResponse> => {
    const response = await fetch("/api/ai/upscale", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imageDataUrl,
        scale: 2,
      }),
    });

    const raw = await response.text();
    const payload = raw
      ? (JSON.parse(raw) as Partial<UpscaleApiResponse> & { error?: string })
      : {};

    if (!response.ok || !payload.imageDataUrl) {
      throw new Error(payload.error || "高清增強失敗");
    }

    return payload as UpscaleApiResponse;
  };

  const requestRefine = async (imageDataUrl: string): Promise<RefineApiResponse> => {
    const response = await fetch("/api/ai/refine", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imageDataUrl,
        sourceIdentityImageDataUrl: uploadedImage,
        lockFace: true,
        roomType,
        style: selectedDressName,
        preferredModel: selectedModel === "auto" ? undefined : selectedModel,
      }),
    });

    const raw = await response.text();
    const payload = raw
      ? (JSON.parse(raw) as Partial<RefineApiResponse> & { error?: string })
      : {};

    if (!response.ok || !payload.imageDataUrl) {
      throw new Error(payload.error || "AI 細節修復失敗");
    }

    return payload as RefineApiResponse;
  };

  const handleDressPreviewError = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      if (selectedDressDataUrl) {
        event.currentTarget.src = selectedDressDataUrl;
        setSelectedDressPreviewUrl(selectedDressDataUrl);
        return;
      }
      setErrorMessage((prev) => prev ?? "婚紗預覽載入失敗，請重新上傳自訂婚紗圖。");
    },
    [selectedDressDataUrl],
  );

  const handleGenerate = async () => {
    if (!uploadedImage || isGenerating) {
      return;
    }
    if (!selectedDressDataUrl) {
      setErrorMessage("請先選擇一套婚紗（或上傳自訂婚紗圖）再生成。");
      return;
    }

    setIsGenerating(true);
    setErrorMessage(null);
    setGenerationStatusText("AI 套用婚紗中...");
    startProgressAnimation();

    try {
      const response = await fetch("/api/ai/render", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageDataUrl: uploadedImage,
          roomType,
          style: selectedDressName,
          referenceDressImageDataUrl: selectedDressDataUrl,
          dressSpec: selectedDressSpec,
          lockFace: true,
          preserveIdentityStrict: true,
          preferredModel: selectedModel === "auto" ? undefined : selectedModel,
          customPrompt,
          creativity,
        }),
      });

      const raw = await response.text();
      const payload = raw ? (JSON.parse(raw) as Partial<RenderApiResponse> & { error?: string }) : {};

      if (!response.ok) {
        throw new Error(payload.error || "AI 試穿生成失敗，請稍後再試。");
      }

      const nextImage = payload.imageDataUrl;
      if (!nextImage) {
        throw new Error("AI 沒有回傳圖片，請調整提示詞後重試。");
      }

      let finalImage = nextImage;
      let qualityTag = "標準";
      let upscaleInfo: UpscaleApiResponse | null = null;
      let refineInfo: RefineApiResponse | null = null;

      if (outputQuality === "detail" || outputQuality === "hd2x") {
        setGenerationStatusText("正在進行細節修復...");
        setGenerationProgress((prev) => Math.max(prev, 86));
        try {
          refineInfo = await requestRefine(finalImage);
          finalImage = refineInfo.imageDataUrl;
          qualityTag = "細節修復";
        } catch (refineError) {
          setErrorMessage(
            refineError instanceof Error
              ? `${refineError.message}，已保留原始試穿結果。`
              : "細節修復失敗，已保留原始試穿結果。",
          );
          qualityTag = "標準（修復失敗）";
        }
      }

      if (outputQuality === "hd2x") {
        setGenerationStatusText("正在進行高清增強...");
        setGenerationProgress((prev) => Math.max(prev, 92));
        try {
          upscaleInfo = await requestUpscale(finalImage);
          finalImage = upscaleInfo.imageDataUrl;
          qualityTag = `細節修復 + 高清 x${upscaleInfo.scaleApplied}`;
        } catch (upscaleError) {
          setErrorMessage(
            upscaleError instanceof Error
              ? `${upscaleError.message}，已保留原始試穿結果。`
              : "高清增強失敗，已保留原始試穿結果。",
          );
          qualityTag = "標準（增強失敗）";
        }
      }

      const dimensions = await getImageDimensions(finalImage).catch(() => null);

      setGenerationProgress(100);
      const finalSummary =
        refineInfo?.summary ||
        payload.summary ||
        "已完成 AI 試穿，建議檢查禮服版型、材質細節與整體婚禮風格是否一致。";
      const modelTag = `${payload.model || "Gemini"} / ${qualityTag}`;

      setResultImage(finalImage);
      setResultSummary(finalSummary);
      const resultMetaParts = [
        payload.model || "Gemini",
        `耗時 ${Math.max(1, Number(payload.elapsedMs || 0))} ms`,
        qualityTag,
        `婚紗 ${selectedDressName}`,
        "人臉鎖定",
      ];
      if (refineInfo) {
        resultMetaParts.push(`Refine: ${refineInfo.model}`);
      }
      if (upscaleInfo) {
        resultMetaParts.push(`格式 ${upscaleInfo.format.toUpperCase()}`);
      }
      if (dimensions) {
        resultMetaParts.push(`${dimensions.width}×${dimensions.height}`);
      }
      setResultMeta(resultMetaParts.join(" · "));
      setViewMode("result");

      try {
        let lastSaveError: unknown = null;
        let savedItem: SocialAssetApiItem | null = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            savedItem = await saveResultToServer({
              imageDataUrl: finalImage,
              summary: finalSummary,
              modelTag,
              roomType,
              style: selectedDressName,
            });
            break;
          } catch (error) {
            lastSaveError = error;
            if (attempt < 2) {
              await new Promise((resolve) => setTimeout(resolve, 450 * (attempt + 1)));
            }
          }
        }
        if (!savedItem) {
          throw lastSaveError instanceof Error ? lastSaveError : new Error("儲存生成結果失敗");
        }
        const savedHistory = toRenderHistoryItem(savedItem);
        if (savedHistory) {
          setRenderHistory((prev) => [savedHistory, ...prev.filter((item) => item.id !== savedHistory.id)].slice(0, 20));
        }
      } catch (saveError) {
        const historyItem: RenderHistoryItem = {
          id: `render_${Date.now()}`,
          imageDataUrl: finalImage,
          summary: finalSummary,
          model: modelTag,
          roomType,
          style: selectedDressName,
          createdAt: new Date().toISOString(),
        };
        setRenderHistory((prev) => [historyItem, ...prev].slice(0, 20));
        setErrorMessage(
          saveError instanceof Error
            ? `${saveError.message}，已保留於目前畫面，請稍後再試儲存。`
            : "伺服器儲存失敗，已保留於目前畫面，請稍後再試儲存。",
        );
      }

      try {
        await appendDressRecordToProject({
          generatedImageUrl: finalImage,
          summary: finalSummary,
          modelTag,
        });
      } catch (projectSaveError) {
        setErrorMessage(
          projectSaveError instanceof Error
            ? `${projectSaveError.message}，專案婚紗紀錄未同步。`
            : "專案婚紗紀錄同步失敗。",
        );
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "AI 試穿生成失敗，請稍後再試。");
    } finally {
      setTimeout(() => {
        stopProgressAnimation();
        setIsGenerating(false);
        setGenerationStatusText("AI 運算中...");
      }, 220);
    }
  };

  const handleDownload = () => {
    if (!resultImage) {
      return;
    }
    const link = document.createElement("a");
    link.href = resultImage;
    link.download = `ai-wedding-look-${formatFileDate()}.png`;
    link.click();
  };

  const handlePickHistory = (item: RenderHistoryItem) => {
    setResultImage(item.imageDataUrl);
    setResultSummary(item.summary);
    setResultMeta(`${item.model} · ${item.roomType} · ${item.style} · ${formatTime(item.createdAt)}`);
    setViewMode("result");
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col lg:flex-row gap-6">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
      />
      <input
        type="file"
        ref={dressInputRef}
        onChange={handleCustomDressUpload}
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
      />

      <div className="w-full lg:w-80 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col flex-shrink-0 overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Sliders className="w-4 h-4" /> 試穿參數設定
          </h3>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">新人照片（身份鎖定）</label>
            {!uploadedImage ? (
              <div
                onClick={handleUploadClick}
                className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:bg-brand-50 hover:border-brand-300 transition-colors cursor-pointer group"
              >
                <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2 group-hover:text-brand-500" />
                <p className="text-xs text-gray-500">點擊上傳單人照或情侶照，生成禮服試穿結果</p>
                <p className="text-[10px] text-gray-400 mt-1">支援 JPG, PNG, WebP（Max 10MB）</p>
              </div>
            ) : (
              <div className="relative rounded-lg border border-gray-200 bg-gray-50 group p-2">
                <div className="h-36 w-full rounded-md bg-white flex items-center justify-center overflow-hidden">
                  <img
                    src={uploadedImage}
                    alt="Uploaded"
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <button
                  onClick={handleClear}
                  className="absolute top-2 right-2 p-1 bg-white rounded-full shadow-sm hover:bg-red-50 hover:text-red-600 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="absolute bottom-4 left-4 px-2 py-1 bg-black/60 text-white text-[10px] rounded">
                  {uploadedFileName}
                </div>
              </div>
            )}
            <Button variant="outline" size="sm" className="mt-2 w-full" onClick={loadSampleImage}>
              使用範例照片
            </Button>
          </div>

          <div className={!uploadedImage ? "opacity-50 pointer-events-none" : ""}>
            <label className="block text-sm font-medium text-gray-700 mb-2">關聯婚禮專案（保存婚紗紀錄）</label>
            <select
              value={selectedProjectId}
              onChange={(event) => {
                setSelectedProjectId(event.target.value);
                setProjectRecordNotice(null);
              }}
              className="w-full border-gray-300 rounded-lg text-sm focus:ring-brand-500 focus:border-brand-500 p-2.5 bg-white border"
            >
              <option value="">不關聯（僅儲存素材）</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}（{project.clientName}）
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-gray-500">生成完成後將自動寫入專案「婚紗選擇紀錄」。</p>
          </div>

          <div className={!uploadedImage ? "opacity-50 pointer-events-none" : ""}>
            <label className="block text-sm font-medium text-gray-700 mb-2">婚禮情境</label>
            <select
              value={roomType}
              onChange={(event) => setRoomType(event.target.value)}
              className="w-full border-gray-300 rounded-lg text-sm focus:ring-brand-500 focus:border-brand-500 p-2.5 bg-white border"
            >
              <option value="宴客主視覺">宴客主視覺</option>
              <option value="戶外證婚">戶外證婚</option>
              <option value="棚拍婚紗">棚拍婚紗</option>
              <option value="海島婚禮">海島婚禮</option>
              <option value="飯店晚宴">飯店晚宴</option>
              <option value="訂婚儀式">訂婚儀式</option>
            </select>
          </div>

          <div className={!uploadedImage ? "opacity-50 pointer-events-none" : ""}>
            <label className="block text-sm font-medium text-gray-700 mb-2">婚紗款式（必選）</label>
            <div className="grid grid-cols-2 gap-2">
              {DRESS_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => void selectDressPreset(preset)}
                  className={`rounded-lg border p-1.5 text-left transition-colors ${
                    selectedDressId === preset.id
                      ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500"
                      : "border-gray-200 hover:border-brand-300"
                  }`}
                >
                  <div className="h-24 w-full rounded-md bg-white flex items-center justify-center overflow-hidden">
                    <img
                      src={preset.previewUrl}
                      alt={preset.name}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <p className="mt-1 text-[11px] font-medium text-gray-700 line-clamp-1">{preset.name}</p>
                </button>
              ))}
            </div>
            <div className="mt-2 space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => dressInputRef.current?.click()}
              >
                上傳自訂婚紗圖
              </Button>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-700">目前套用：{selectedDressName}</p>
                  <span className="text-[10px] text-brand-700">{dressSourceLabel}</span>
                </div>
                <p className="mt-1 text-[11px] text-gray-500">{selectedDressSpec}</p>
                {(selectedDressPreviewUrl || selectedDressDataUrl) && (
                  <div className="mt-2 h-24 w-full rounded-md bg-white flex items-center justify-center overflow-hidden">
                    <img
                      src={selectedDressPreviewUrl || selectedDressDataUrl || ""}
                      alt="selected-dress-preview"
                      className="max-h-full max-w-full object-contain"
                      onError={handleDressPreviewError}
                    />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 text-[11px] text-green-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>已啟用同人臉鎖定：只替換衣著，不換人物、不新增其他人像或拼貼照片。</span>
              </div>
              {isDressLoading && <p className="text-[11px] text-gray-500">婚紗參考圖載入中...</p>}
            </div>
          </div>

          <div className={!uploadedImage ? "opacity-50 pointer-events-none" : ""}>
            <label className="block text-sm font-medium text-gray-700 mb-2">試穿生成模型</label>
            <select
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.target.value)}
              className="w-full border-gray-300 rounded-lg text-sm focus:ring-brand-500 focus:border-brand-500 p-2.5 bg-white border"
            >
              {MODEL_OPTIONS.map((model) => (
                <option key={model.value} value={model.value}>
                  {model.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-gray-500">
              建議使用 Gemini 3 Pro + 高清 2x，可獲得較高寫實度與細節。
            </p>
          </div>

          <div className={!uploadedImage ? "opacity-50 pointer-events-none" : ""}>
            <label className="block text-sm font-medium text-gray-700 mb-2">輸出解析度</label>
            <select
              value={outputQuality}
              onChange={(event) =>
                setOutputQuality(
                  event.target.value as (typeof OUTPUT_QUALITY_OPTIONS)[number]["value"],
                )
              }
              className="w-full border-gray-300 rounded-lg text-sm focus:ring-brand-500 focus:border-brand-500 p-2.5 bg-white border"
            >
              {OUTPUT_QUALITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className={!uploadedImage ? "opacity-50 pointer-events-none" : ""}>
            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
              自定義提示詞 <span className="text-[10px] text-gray-400 font-normal">(選填)</span>
            </label>
            <textarea
              value={customPrompt}
              onChange={(event) => setCustomPrompt(event.target.value)}
              placeholder="例如：保留人物臉型與髮型，改為緞面長拖尾，加入同色系頭紗與捧花..."
              className="w-full text-sm border-gray-300 rounded-lg p-2.5 bg-white border h-24 resize-none focus:ring-brand-500 focus:border-brand-500"
            />
          </div>

          <div className={!uploadedImage ? "opacity-50 pointer-events-none" : ""}>
            <label className="block text-sm font-medium text-gray-700 mb-2">AI 創意度 (Creativity)</label>
            <input
              type="range"
              value={creativity}
              onChange={(event) => setCreativity(Number(event.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand-600"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>忠於原始穿搭</span>
              <span>AI 風格延展</span>
            </div>
          </div>

          {errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {errorMessage}
            </div>
          )}
          {projectRecordNotice && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
              {projectRecordNotice}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
            <span>消耗點數</span>
            <span className="font-bold text-brand-600">2 點</span>
          </div>
          <Button
            fullWidth
            onClick={handleGenerate}
            disabled={!uploadedImage || !selectedDressDataUrl || isGenerating || isDressLoading}
          >
            {isGenerating ? (
              <span className="flex items-center gap-2">
                <RefreshCw className="animate-spin w-4 h-4" />
                {generationStatusText}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                {outputQuality === "hd2x"
                  ? "立即生成高清試穿圖"
                  : outputQuality === "detail"
                    ? "立即生成細節修復圖"
                    : "立即生成試穿圖"}
              </span>
            )}
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-gray-900/5 rounded-xl border border-gray-200 flex flex-col overflow-hidden relative group">
        {resultImage && !isGenerating && (
          <div className="absolute top-4 right-4 z-10 flex gap-2">
            <button
              onClick={toggleViewMode}
              className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg shadow-sm hover:bg-gray-50 text-gray-700 text-sm font-medium"
            >
              {viewMode === "result" ? (
                <>
                  <History className="w-4 h-4" /> 原始圖比對
                </>
              ) : (
                <>
                  <ImageIcon className="w-4 h-4" /> 查看結果
                </>
              )}
            </button>
            <button
              onClick={handleDownload}
              className="p-2 bg-brand-600 rounded-lg shadow-sm hover:bg-brand-700 text-white"
              title="下載試穿結果"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 flex items-center justify-center p-4 lg:p-8 relative overflow-hidden">
          {!uploadedImage && !isGenerating && !resultImage && (
            <div className="text-center text-gray-400">
              <div className="w-20 h-20 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <ImageIcon className="w-10 h-10" />
              </div>
              <p className="text-lg font-medium">尚未生成影像</p>
              <p className="text-sm">請在左側設定參數並上傳新人照片</p>
            </div>
          )}

          {uploadedImage && !isGenerating && !resultImage && (
            <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
              <img
                src={uploadedImage}
                alt="Preview"
                className="h-full w-auto max-w-full max-h-full rounded-lg shadow-lg object-contain mx-auto"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-lg">
                <span className="bg-white/90 px-4 py-2 rounded-full text-sm font-medium shadow-sm flex items-center gap-2">
                  <Wand2 className="w-4 h-4 text-brand-600" /> 準備就緒，請點擊生成
                </span>
              </div>
            </div>
          )}

          {isGenerating && (
            <div className="flex flex-col items-center z-20 w-full max-w-md">
              <div className="w-full bg-white p-6 rounded-xl shadow-lg border border-gray-100">
                <div className="flex justify-between text-sm font-medium text-gray-900 mb-2">
                  <span>AI 運算中...</span>
                  <span>{Math.min(99, Math.max(8, generationProgress))}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2 mb-4">
                  <div
                    className="bg-brand-600 h-2 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${Math.min(99, Math.max(8, generationProgress))}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 text-center animate-pulse">
                  {generationStatusText}
                </p>
              </div>
            </div>
          )}

          {resultImage && !isGenerating && (
            <div className="relative w-full h-full flex items-center justify-center">
              {viewMode === "result" ? (
                <img
                  src={resultImage}
                  alt="Generated Wedding Look"
                  className="h-full w-auto max-w-full max-h-full rounded-lg shadow-2xl object-contain mx-auto"
                />
              ) : (
                <div className="relative w-full h-full flex items-center justify-center gap-4">
                  <div className="relative flex-1 min-h-0 flex flex-col items-center">
                    <span className="mb-2 text-xs font-bold text-gray-500 bg-white px-2 py-1 rounded shadow-sm">
                      原始照片 (Original)
                    </span>
                    <div className="w-full flex-1 min-h-0">
                      <img
                        src={uploadedImage!}
                        alt="Original Portrait"
                        className="h-full w-auto max-w-full max-h-full rounded-lg shadow-lg object-contain mx-auto"
                      />
                    </div>
                  </div>
                  <div className="relative flex-1 min-h-0 flex flex-col items-center">
                    <span className="mb-2 text-xs font-bold text-brand-600 bg-white px-2 py-1 rounded shadow-sm">
                      試穿後 (Generated)
                    </span>
                    <div className="w-full flex-1 min-h-0">
                      <img
                        src={resultImage}
                        alt="Generated Wedding Look"
                        className="h-full w-auto max-w-full max-h-full rounded-lg shadow-lg object-contain mx-auto"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3">
          {resultSummary && (
            <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 mb-3 max-h-24 overflow-y-auto">
              <p className="text-xs font-semibold text-brand-700 mb-1">AI 試穿說明</p>
              <p className="text-xs text-brand-800 leading-relaxed whitespace-pre-wrap">{resultSummary}</p>
              {resultMeta && <p className="text-[10px] text-brand-600 mt-2">{resultMeta}</p>}
            </div>
          )}
          <div className="h-24 flex items-center gap-2 overflow-x-auto">
            {renderHistory.length === 0 ? (
              <div className="text-xs text-gray-400">試穿歷史會顯示在這裡，並自動儲存至伺服器（依使用者）。</div>
            ) : (
              renderHistory.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handlePickHistory(item)}
                  className="w-24 h-20 flex-shrink-0 bg-gray-100 rounded-lg border border-gray-200 hover:ring-2 hover:ring-brand-500 cursor-pointer overflow-hidden group relative"
                  title={`${item.style} · ${item.roomType} · ${formatTime(item.createdAt)}`}
                >
                  <img
                    src={item.imageDataUrl}
                    alt={`history-${item.id}`}
                    className="w-full h-full object-contain opacity-85 group-hover:opacity-100 transition-opacity bg-white"
                  />
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};