import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "./Button";
import {
  Download,
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
}

interface UpscaleApiResponse {
  imageDataUrl: string;
  scaleApplied: number;
  format: "jpeg" | "png" | "webp";
}

interface SocialAssetApiItem {
  id: string;
  kind: "image" | "video";
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
    generatedImageUrl?: string;
    summary?: string;
    model?: string;
    note?: string;
    createdAt: string;
    updatedAt?: string;
  }>;
}

interface MultiViewResult {
  slotKey: string;
  label: string;
  status: "idle" | "generating" | "done" | "error";
  imageDataUrl?: string;
  summary?: string;
  error?: string;
}

interface DesignFunctionPreset {
  id: string;
  name: string;
  hint: string;
  prompt: string;
}

const DESIGN_FUNCTION_PRESETS: DesignFunctionPreset[] = [
  {
    id: "photoreal-material",
    name: "寫實材質渲染",
    hint: "把線稿轉成高寫實室內效果圖",
    prompt:
      "將線稿/平面構想轉為可提案的寫實室內渲染圖，建立真實材質、陰影、反射與光感，保留原始空間比例。",
  },
  {
    id: "lighting-mood",
    name: "燈光情境提案",
    hint: "依日夜與氛圍產出燈光方案",
    prompt:
      "優先輸出完整燈光層次（主燈、間接光、重點光），同時呈現白天與夜間可行的照明氛圍與舒適度。",
  },
  {
    id: "storage-optimization",
    name: "收納優化提案",
    hint: "針對收納量體與動線重排",
    prompt:
      "在不破壞主要格局下，優先規劃收納量體、取用動線與生活便利性，重點呈現櫃體整合與整潔視覺。",
  },
  {
    id: "family-safety",
    name: "親子銀髮安全版",
    hint: "兼顧幼童與長者友善設計",
    prompt:
      "加入無障礙與安全設計：圓角、止滑、扶手、夜間導光、低門檻，並維持美感與實用性平衡。",
  },
  {
    id: "budget-friendly",
    name: "預算友善版",
    hint: "以可執行工法與常見材料優化",
    prompt:
      "維持風格質感的前提下，採用常見材料與可執行工法，避免過度昂貴與難施工細節，提供務實可落地畫面。",
  },
];

const ROOM_TYPE_OPTIONS = [
  "客廳",
  "餐廚區",
  "主臥",
  "兒童房",
  "長輩房",
  "玄關",
  "衛浴",
  "多功能室",
  "全室整合",
];

const MODEL_OPTIONS = [
  { value: "auto", label: "自動（畫質優先）" },
  { value: "gemini-3-pro-image-preview", label: "Gemini 3 Pro Image（寫實度高）" },
  { value: "gemini-3.1-flash-image-preview", label: "Gemini 3.1 Flash Image（較快）" },
  { value: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image（平衡）" },
];

const OUTPUT_QUALITY_OPTIONS = [
  { value: "standard", label: "標準（較快）" },
  { value: "detail", label: "細節修復（較清晰）" },
  { value: "hd2x", label: "高清 2x（較清晰）" },
] as const;

const ANALYZE_FLOOR_PLAN_PROMPT =
  "請仔細分析這張建築平面圖，輸出一張清晰的標示版平面圖：(1) 保留所有牆面、門窗、傢具輪廓，以黑白線條呈現俯視圖。(2) 根據平面圖實際內容，在每個空間內用繁體中文標示空間名稱，不要憑空新增不存在的空間。(3) 說明文字最後請加入以下格式的空間清單：SPACES_JSON:{\"spaces\":[\"空間名稱1\",\"空間名稱2\",...]}";

const FIXED_VIEW_SLOTS = [
  {
    slotKey: "vray",
    label: "VRay 全室渲染",
    prompt:
      "根據這張已標示的平面圖，生成整體空間的 VRay 寫實效果圖。嚴格依照平面圖的空間格局、傢具數量與位置，不添加平面圖中沒有的物件，加入精確燈光計算、材質反射與陰影層次，輸出高品質全室視角效果圖。",
  },
  {
    slotKey: "2d5-view",
    label: "2.5D 俯視透視",
    prompt:
      "將此平面圖以 2.5D 等角俯視方式立體化，略微傾斜約 25 度，完整保留平面圖中所有傢具配置、牆面結構與格局，輸出等角投影立體平面圖，不要生成透視室內實景圖。",
  },
] as const;

const SAMPLE_SKETCH_URL =
  "https://images.unsplash.com/photo-1460317442991-0ec209397118?auto=format&fit=crop&q=80&w=1600";

const generatePackageId = (): { packageId: string; packageLabel: string } => {
  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const countKey = `aiinterior:pkg-count:${dateStr}`;
  const current = parseInt(localStorage.getItem(countKey) || "0") + 1;
  localStorage.setItem(countKey, String(current));
  const label = `${dateStr}-Output-${String(current).padStart(3, "0")}`;
  return { packageId: label, packageLabel: label };
};

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

const dataUrlToFile = async (dataUrl: string, fileName: string): Promise<File> => {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error("無法轉換生成圖片檔案。");
  }
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "image/jpeg" });
};

const getImageDimensions = (imageDataUrl: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("無法取得圖片尺寸"));
    image.src = imageDataUrl;
  });

const requestJson = async <T,>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const raw = await response.text();
  const payload = raw ? (JSON.parse(raw) as T & { error?: string }) : null;
  if (!response.ok) {
    throw new Error(payload?.error || `請求失敗（${response.status}）`);
  }
  if (!payload) {
    throw new Error("伺服器回傳非 JSON。");
  }
  return payload as T;
};

export const AIStudio: React.FC = () => {
  const { data: session } = useSession();
  const [userScopeId, setUserScopeId] = useState("guest_server");
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState("未命名圖片");
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [resultSummary, setResultSummary] = useState("");
  const [resultMeta, setResultMeta] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [renderHistory, setRenderHistory] = useState<RenderHistoryItem[]>([]);
  const [selectedRoomType, setSelectedRoomType] = useState("客廳");
  const [selectedFunctionId, setSelectedFunctionId] = useState(DESIGN_FUNCTION_PRESETS[0].id);
  const [designerPrompt, setDesignerPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState("gemini-3-pro-image-preview");
  const [outputQuality, setOutputQuality] =
    useState<(typeof OUTPUT_QUALITY_OPTIONS)[number]["value"]>("detail");
  const [creativity, setCreativity] = useState(28);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStatusText, setGenerationStatusText] = useState("AI 渲染中...");
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectRecordNotice, setProjectRecordNotice] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"single" | "multi">("single");
  const [multiViewResults, setMultiViewResults] = useState<MultiViewResult[]>([]);
  const [isMultiGenerating, setIsMultiGenerating] = useState(false);
  const [currentMultiSlot, setCurrentMultiSlot] = useState("");
  // 多視角三階段流程
  const [multiPhase, setMultiPhase] = useState<"setup" | "analyzing" | "review" | "generating" | "done">("setup");
  const [labeledFloorPlan, setLabeledFloorPlan] = useState<string | null>(null);
  const [identifiedSpaces, setIdentifiedSpaces] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [newSpaceInput, setNewSpaceInput] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedFunction = DESIGN_FUNCTION_PRESETS.find((item) => item.id === selectedFunctionId) || DESIGN_FUNCTION_PRESETS[0];

  const stopProgressAnimation = useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setGenerationProgress(0);
  }, []);

  const startProgressAnimation = useCallback(() => {
    setGenerationProgress(12);
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
    }
    progressTimerRef.current = setInterval(() => {
      setGenerationProgress((prev) => {
        if (prev >= 90) {
          return 90;
        }
        return Math.min(90, prev + Math.floor(Math.random() * 7 + 4));
      });
    }, 700);
  }, []);

  useEffect(() => () => stopProgressAnimation(), [stopProgressAnimation]);

  useEffect(() => {
    const sessionUser = session?.user as { id?: string; email?: string | null } | undefined;
    setUserScopeId(resolveClientUserScopeId(sessionUser?.id || null, sessionUser?.email || null));
  }, [session?.user]);

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
      roomType: asset.meta?.roomType || "全室整合",
      style: asset.meta?.style || "室內設計渲染",
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
        .filter((item): item is RenderHistoryItem => Boolean(item))
        .slice(0, 20);
      setRenderHistory(next);
    } catch {
      // ignore history load errors
    }
  }, [toRenderHistoryItem, userScopeId]);

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

  useEffect(() => {
    void loadServerHistory();
  }, [loadServerHistory]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const saveResultToServer = useCallback(
    async (input: {
      imageDataUrl: string;
      summary: string;
      modelTag: string;
      packageId?: string;
      packageLabel?: string;
      slotLabel?: string;
    }) => {
      const file = await dataUrlToFile(input.imageDataUrl, `interior-render-${formatFileDate()}.jpg`);
      const formData = new FormData();
      formData.append("userId", userScopeId);
      formData.append("kind", "image");
      formData.append("file", file);
      formData.append(
        "meta",
        JSON.stringify({
          origin: "ai-studio",
          summary: input.summary,
          style: selectedFunction.name,
          roomType: selectedRoomType,
          model: input.modelTag,
          prompt: designerPrompt.trim(),
          ...(input.packageId
            ? {
                packageId: input.packageId,
                packageLabel: input.packageLabel,
                slotLabel: input.slotLabel,
              }
            : {}),
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
    [designerPrompt, selectedFunction.name, selectedRoomType, userScopeId],
  );

  const appendRenderRecordToProject = useCallback(
    async (input: { generatedImageUrl: string; summary: string; modelTag: string }) => {
      if (!selectedProjectId) {
        return;
      }
      const detail = await requestJson<{ project: ProjectDetailItem }>(`/api/projects/${selectedProjectId}`, {
        method: "GET",
      });
      const now = new Date().toISOString();
      const nextRecords = [
        {
          id: `render_${Date.now()}`,
          dressName: `室內模擬｜${selectedFunction.name}`,
          dressSpec: `空間：${selectedRoomType}`,
          sourceLabel: "AI 室內設計模擬",
          generatedImageUrl: input.generatedImageUrl,
          summary: input.summary,
          model: input.modelTag,
          note: designerPrompt.trim(),
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
      setProjectRecordNotice(`已將本次渲染紀錄存入專案：${targetName}`);
    },
    [designerPrompt, projects, selectedFunction.name, selectedProjectId, selectedRoomType],
  );

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
    setProjectRecordNotice(null);
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
      setProjectRecordNotice(null);
    } catch {
      setErrorMessage("圖片讀取失敗，請改用 JPG / PNG / WebP 格式重試。");
    } finally {
      event.target.value = "";
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
      setUploadedFileName("sample-interior-sketch.jpg");
      setResultImage(null);
      setResultSummary("");
      setResultMeta("");
      setProjectRecordNotice(null);
    } catch {
      setErrorMessage("範例圖載入失敗，請改用本機圖片上傳。");
    }
  };

  const requestUpscale = async (imageDataUrl: string): Promise<UpscaleApiResponse> => {
    const response = await fetch("/api/ai/upscale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageDataUrl, scale: 2 }),
    });
    const raw = await response.text();
    const payload = raw ? (JSON.parse(raw) as Partial<UpscaleApiResponse> & { error?: string }) : {};
    if (!response.ok || !payload.imageDataUrl) {
      throw new Error(payload.error || "高清增強失敗");
    }
    return payload as UpscaleApiResponse;
  };

  const requestRefine = async (imageDataUrl: string): Promise<RefineApiResponse> => {
    const response = await fetch("/api/ai/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageDataUrl,
        lockFace: false,
        roomType: selectedRoomType,
        style: selectedFunction.name,
        preferredModel: selectedModel === "auto" ? undefined : selectedModel,
      }),
    });
    const raw = await response.text();
    const payload = raw ? (JSON.parse(raw) as Partial<RefineApiResponse> & { error?: string }) : {};
    if (!response.ok || !payload.imageDataUrl) {
      throw new Error(payload.error || "細節修復失敗");
    }
    return payload as RefineApiResponse;
  };

  const handleGenerate = async () => {
    if (!uploadedImage || isGenerating) {
      return;
    }
    setIsGenerating(true);
    setErrorMessage(null);
    setGenerationStatusText("AI 渲染中...");
    startProgressAnimation();

    try {
      const mergedPrompt = [selectedFunction.prompt, designerPrompt.trim()].filter(Boolean).join("\n");
      const response = await fetch("/api/ai/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: uploadedImage,
          roomType: selectedRoomType,
          style: selectedFunction.name,
          lockFace: false,
          preserveIdentityStrict: false,
          preferredModel: selectedModel === "auto" ? undefined : selectedModel,
          customPrompt: mergedPrompt,
          creativity,
        }),
      });

      const raw = await response.text();
      const payload = raw ? (JSON.parse(raw) as Partial<RenderApiResponse> & { error?: string }) : {};
      if (!response.ok) {
        throw new Error(payload.error || "AI 渲染失敗，請稍後再試。");
      }
      if (!payload.imageDataUrl) {
        throw new Error("AI 沒有回傳圖片，請調整提示詞後重試。");
      }

      let finalImage = payload.imageDataUrl;
      let qualityTag = "標準";
      let refineInfo: RefineApiResponse | null = null;
      let upscaleInfo: UpscaleApiResponse | null = null;

      if (outputQuality === "detail" || outputQuality === "hd2x") {
        setGenerationStatusText("正在進行細節修復...");
        setGenerationProgress((prev) => Math.max(prev, 86));
        refineInfo = await requestRefine(finalImage);
        finalImage = refineInfo.imageDataUrl;
        qualityTag = "細節修復";
      }

      if (outputQuality === "hd2x") {
        setGenerationStatusText("正在進行高清增強...");
        setGenerationProgress((prev) => Math.max(prev, 92));
        upscaleInfo = await requestUpscale(finalImage);
        finalImage = upscaleInfo.imageDataUrl;
        qualityTag = `細節修復 + 高清 x${upscaleInfo.scaleApplied}`;
      }

      const dimensions = await getImageDimensions(finalImage).catch(() => null);
      const summary =
        refineInfo?.summary ||
        payload.summary ||
        "已完成室內設計渲染，建議確認空間動線、材質落地性與照明舒適度。";
      const modelTag = `${payload.model || "Gemini"} / ${qualityTag}`;

      setGenerationProgress(100);
      setResultImage(finalImage);
      setResultSummary(summary);
      const metaParts = [
        payload.model || "Gemini",
        `耗時 ${Math.max(1, Number(payload.elapsedMs || 0))} ms`,
        qualityTag,
        `空間 ${selectedRoomType}`,
        `任務 ${selectedFunction.name}`,
      ];
      if (upscaleInfo) {
        metaParts.push(`格式 ${upscaleInfo.format.toUpperCase()}`);
      }
      if (dimensions) {
        metaParts.push(`${dimensions.width}×${dimensions.height}`);
      }
      setResultMeta(metaParts.join(" · "));

      try {
        const saved = await saveResultToServer({
          imageDataUrl: finalImage,
          summary,
          modelTag,
        });
        const historyItem = toRenderHistoryItem(saved);
        if (historyItem) {
          setRenderHistory((prev) => [historyItem, ...prev.filter((item) => item.id !== historyItem.id)].slice(0, 20));
        }
      } catch (saveError) {
        setErrorMessage(
          saveError instanceof Error
            ? `${saveError.message}，已保留於目前畫面。`
            : "伺服器儲存失敗，已保留於目前畫面。",
        );
      }

      try {
        await appendRenderRecordToProject({
          generatedImageUrl: finalImage,
          summary,
          modelTag,
        });
      } catch {
        // ignore project sync error
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "AI 渲染失敗，請稍後再試。");
    } finally {
      setTimeout(() => {
        stopProgressAnimation();
        setIsGenerating(false);
        setGenerationStatusText("AI 渲染中...");
      }, 220);
    }
  };

  const handleDownload = () => {
    if (!resultImage) {
      return;
    }
    const link = document.createElement("a");
    link.href = resultImage;
    link.download = `interior-render-${formatFileDate()}.png`;
    link.click();
  };

  const handlePickHistory = (item: RenderHistoryItem) => {
    setResultImage(item.imageDataUrl);
    setResultSummary(item.summary);
    setResultMeta(`${item.model} · ${item.roomType} · ${item.style}`);
  };

  // 第一步：分析平面圖空間
  const handleAnalyzeFloorPlan = async () => {
    if (!uploadedImage || isAnalyzing) return;
    setIsAnalyzing(true);
    setMultiPhase("analyzing");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/ai/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: uploadedImage,
          roomType: "全室整合",
          style: "平面圖分析",
          lockFace: false,
          preserveIdentityStrict: false,
          preferredModel: selectedModel === "auto" ? undefined : selectedModel,
          customPrompt: ANALYZE_FLOOR_PLAN_PROMPT,
          creativity: 10,
        }),
      });
      const raw = await response.text();
      const payload = raw ? (JSON.parse(raw) as Partial<RenderApiResponse> & { error?: string }) : {};
      if (!response.ok || !payload.imageDataUrl) {
        throw new Error(payload.error || "分析失敗，請重試");
      }
      setLabeledFloorPlan(payload.imageDataUrl);

      // 從 summary 解析空間清單
      let spaces: string[] = [];
      try {
        const match = payload.summary?.match(/SPACES_JSON:\s*(\{[^}]*\})/);
        if (match) {
          const parsed = JSON.parse(match[1]) as { spaces?: string[] };
          spaces = parsed.spaces || [];
        }
      } catch {
        // fallback: 使用預設空間
      }
      // 若 AI 無法解析，使用常見預設值
      if (spaces.length === 0) {
        spaces = ["客廳", "主臥室", "廚房", "衛浴"];
      }
      setIdentifiedSpaces(spaces);
      setMultiPhase("review");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "平面圖分析失敗，請重試");
      setMultiPhase("setup");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 第二步：依識別空間生成所有視角
  const handleMultiGenerate = async () => {
    if (!labeledFloorPlan || isMultiGenerating || identifiedSpaces.length === 0) return;

    const { packageId, packageLabel } = generatePackageId();

    const roomSlots = identifiedSpaces.map((space) => ({
      slotKey: `room-${space}`,
      label: space,
      prompt: `根據這張已標示的平面圖，生成「${space}」空間的室內透視效果圖。嚴格按照平面圖中${space}區域的實際位置、大小、傢具數量與類型，不添加平面圖中沒有的傢具或裝飾，整體材質、色調與設計語言統一。`,
    }));

    const allSlots = [...FIXED_VIEW_SLOTS, ...roomSlots];

    // 將已分析的標示平面圖作為第一張（已完成）
    const initialResults: MultiViewResult[] = [
      {
        slotKey: "labeled-floor-plan",
        label: "標示平面圖",
        status: "done",
        imageDataUrl: labeledFloorPlan,
        summary: "AI 已識別空間並標示完成",
      },
      ...allSlots.map((slot) => ({ slotKey: slot.slotKey, label: slot.label, status: "idle" as const })),
    ];
    setMultiViewResults(initialResults);
    setIsMultiGenerating(true);
    setMultiPhase("generating");
    setErrorMessage(null);

    // 先儲存標示平面圖
    try {
      await saveResultToServer({
        imageDataUrl: labeledFloorPlan,
        summary: "AI 標示平面圖",
        modelTag: selectedModel || "Gemini",
        packageId,
        packageLabel,
        slotLabel: "標示平面圖",
      });
    } catch {
      // 忽略儲存錯誤
    }

    for (const slot of allSlots) {
      setCurrentMultiSlot(slot.label);
      setMultiViewResults((prev) =>
        prev.map((r) => (r.slotKey === slot.slotKey ? { ...r, status: "generating" as const } : r))
      );
      try {
        const mergedPrompt = [slot.prompt, designerPrompt.trim()].filter(Boolean).join("\n");
        const response = await fetch("/api/ai/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageDataUrl: labeledFloorPlan,
            roomType: slot.slotKey.startsWith("room-") ? slot.label : "全室整合",
            style: selectedFunction.name,
            lockFace: false,
            preserveIdentityStrict: false,
            preferredModel: selectedModel === "auto" ? undefined : selectedModel,
            customPrompt: mergedPrompt,
            creativity,
          }),
        });
        const raw = await response.text();
        const payload = raw ? (JSON.parse(raw) as Partial<RenderApiResponse> & { error?: string }) : {};
        if (!response.ok || !payload.imageDataUrl) {
          throw new Error(payload.error || "AI 渲染失敗");
        }
        setMultiViewResults((prev) =>
          prev.map((r) =>
            r.slotKey === slot.slotKey
              ? { ...r, status: "done" as const, imageDataUrl: payload.imageDataUrl, summary: payload.summary }
              : r
          )
        );
        try {
          await saveResultToServer({
            imageDataUrl: payload.imageDataUrl!,
            summary: payload.summary || `${slot.label} 渲染完成`,
            modelTag: payload.model || "Gemini",
            packageId,
            packageLabel,
            slotLabel: slot.label,
          });
        } catch {
          // 忽略個別視角的儲存錯誤
        }
      } catch (error) {
        setMultiViewResults((prev) =>
          prev.map((r) =>
            r.slotKey === slot.slotKey
              ? { ...r, status: "error" as const, error: error instanceof Error ? error.message : "生成失敗" }
              : r
          )
        );
      }
    }

    setIsMultiGenerating(false);
    setCurrentMultiSlot("");
    setMultiPhase("done");
  };

  const handleMultiReset = () => {
    setMultiPhase("setup");
    setLabeledFloorPlan(null);
    setIdentifiedSpaces([]);
    setMultiViewResults([]);
    setErrorMessage(null);
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

      <div className="w-full lg:w-80 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Sliders className="w-4 h-4" /> 室內設計模擬設定
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">線稿 / 空間原圖（必傳）</label>
            {!uploadedImage ? (
              <div
                onClick={handleUploadClick}
                className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:bg-brand-50 hover:border-brand-300 transition-colors cursor-pointer group"
              >
                <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2 group-hover:text-brand-500" />
                <p className="text-xs text-gray-500">上傳線稿、草圖或現況照，轉成渲染提案圖</p>
                <p className="text-[10px] text-gray-400 mt-1">支援 JPG, PNG, WebP</p>
              </div>
            ) : (
              <div className="relative rounded-lg border border-gray-200 bg-gray-50 p-2">
                <div className="h-36 w-full rounded-md bg-white flex items-center justify-center overflow-hidden">
                  <img src={uploadedImage} alt="uploaded-sketch" className="max-h-full max-w-full object-contain" />
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
              使用範例線稿
            </Button>
          </div>

          <div className={!uploadedImage ? "opacity-50 pointer-events-none" : ""}>
            <label className="block text-sm font-medium text-gray-700 mb-2">關聯專案（可選）</label>
            <select
              value={selectedProjectId}
              onChange={(event) => {
                setSelectedProjectId(event.target.value);
                setProjectRecordNotice(null);
              }}
              className="w-full border-gray-300 rounded-lg text-sm p-2.5 bg-white border"
            >
              <option value="">不關聯（僅儲存素材）</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}（{project.clientName}）
                </option>
              ))}
            </select>
          </div>

          <div className={!uploadedImage ? "opacity-50 pointer-events-none" : ""}>
            <label className="block text-sm font-medium text-gray-700 mb-2">空間區域</label>
            <select
              value={selectedRoomType}
              onChange={(event) => setSelectedRoomType(event.target.value)}
              className="w-full border-gray-300 rounded-lg text-sm p-2.5 bg-white border"
            >
              {ROOM_TYPE_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div className={!uploadedImage ? "opacity-50 pointer-events-none" : ""}>
            <label className="block text-sm font-medium text-gray-700 mb-2">設計功能模板</label>
            <div className="space-y-2">
              {DESIGN_FUNCTION_PRESETS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedFunctionId(item.id)}
                  className={`w-full rounded-lg border p-2.5 text-left ${
                    item.id === selectedFunctionId
                      ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500"
                      : "border-gray-200 hover:border-brand-300"
                  }`}
                >
                  <p className="text-sm font-semibold text-gray-800">{item.name}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{item.hint}</p>
                </button>
              ))}
            </div>
          </div>

          <div className={!uploadedImage ? "opacity-50 pointer-events-none" : ""}>
            <label className="block text-sm font-medium text-gray-700 mb-2">設計師補充提示詞（選填）</label>
            <textarea
              value={designerPrompt}
              onChange={(event) => setDesignerPrompt(event.target.value)}
              placeholder="例如：北歐風＋溫潤木色，保留現有樑柱，增加餐邊收納與隱藏式燈帶..."
              className="w-full text-sm border-gray-300 rounded-lg p-2.5 bg-white border h-24 resize-none"
            />
            <p className="mt-1 text-[11px] text-gray-500">
              系統會先套用功能模板，再疊加你的提示詞。
            </p>
          </div>

          <div className={!uploadedImage ? "opacity-50 pointer-events-none" : ""}>
            <label className="block text-sm font-medium text-gray-700 mb-2">渲染模型</label>
            <select
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.target.value)}
              className="w-full border-gray-300 rounded-lg text-sm p-2.5 bg-white border"
            >
              {MODEL_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className={!uploadedImage ? "opacity-50 pointer-events-none" : ""}>
            <label className="block text-sm font-medium text-gray-700 mb-2">輸出品質</label>
            <select
              value={outputQuality}
              onChange={(event) =>
                setOutputQuality(
                  event.target.value as (typeof OUTPUT_QUALITY_OPTIONS)[number]["value"],
                )
              }
              className="w-full border-gray-300 rounded-lg text-sm p-2.5 bg-white border"
            >
              {OUTPUT_QUALITY_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className={!uploadedImage ? "opacity-50 pointer-events-none" : ""}>
            <label className="block text-sm font-medium text-gray-700 mb-2">AI 風格創意度</label>
            <input
              type="range"
              value={creativity}
              min={0}
              max={100}
              onChange={(event) => setCreativity(Number(event.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand-600"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>保守落地</span>
              <span>風格延展</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">輸出模式</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setViewMode("single"); handleMultiReset(); }}
                className={`p-2.5 rounded-lg border text-sm font-medium transition-colors ${
                  viewMode === "single"
                    ? "border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500"
                    : "border-gray-200 text-gray-600 hover:border-brand-300"
                }`}
              >
                單張渲染
              </button>
              <button
                onClick={() => setViewMode("multi")}
                className={`p-2.5 rounded-lg border text-sm font-medium transition-colors ${
                  viewMode === "multi"
                    ? "border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500"
                    : "border-gray-200 text-gray-600 hover:border-brand-300"
                }`}
              >
                多視角輸出
              </button>
            </div>
          </div>

          {/* 多視角：review 階段的空間確認 */}
          {viewMode === "multi" && multiPhase === "review" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">已識別空間</label>
              <p className="text-[11px] text-gray-500 mb-2">
                AI 從平面圖識別出以下空間，可新增或移除後再生成
              </p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {identifiedSpaces.map((space) => (
                  <span
                    key={space}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-brand-50 border border-brand-200 text-brand-700 text-xs rounded-full"
                  >
                    {space}
                    <button
                      onClick={() => setIdentifiedSpaces((prev) => prev.filter((s) => s !== space))}
                      className="text-brand-400 hover:text-red-500 transition-colors"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input
                  value={newSpaceInput}
                  onChange={(e) => setNewSpaceInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newSpaceInput.trim()) {
                      setIdentifiedSpaces((prev) => [...prev, newSpaceInput.trim()]);
                      setNewSpaceInput("");
                    }
                  }}
                  placeholder="新增空間名稱..."
                  className="flex-1 text-xs border-gray-300 rounded-lg p-2 bg-white border"
                />
                <button
                  onClick={() => {
                    if (newSpaceInput.trim()) {
                      setIdentifiedSpaces((prev) => [...prev, newSpaceInput.trim()]);
                      setNewSpaceInput("");
                    }
                  }}
                  className="px-3 py-2 bg-brand-600 text-white text-xs rounded-lg hover:bg-brand-700"
                >
                  新增
                </button>
              </div>
            </div>
          )}

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
          {viewMode === "single" ? (
            <>
              <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                <span>估計點數</span>
                <span className="font-bold text-brand-600">2 點</span>
              </div>
              <Button fullWidth onClick={handleGenerate} disabled={!uploadedImage || isGenerating}>
                {isGenerating ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="animate-spin w-4 h-4" />
                    {generationStatusText}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    生成室內渲染圖
                  </span>
                )}
              </Button>
            </>
          ) : multiPhase === "setup" ? (
            <>
              <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                <span>第一步</span>
                <span className="text-gray-400">識別空間後再生成</span>
              </div>
              <Button fullWidth onClick={handleAnalyzeFloorPlan} disabled={!uploadedImage || isAnalyzing}>
                {isAnalyzing ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="animate-spin w-4 h-4" />
                    AI 分析平面圖中...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    分析平面圖空間
                  </span>
                )}
              </Button>
            </>
          ) : multiPhase === "review" ? (
            <>
              <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                <span>第二步</span>
                <span className="font-bold text-brand-600">{(2 + identifiedSpaces.length) * 2} 點</span>
              </div>
              <Button
                fullWidth
                onClick={handleMultiGenerate}
                disabled={identifiedSpaces.length === 0}
              >
                <span className="flex items-center gap-2">
                  <Wand2 className="w-4 h-4" />
                  開始生成（{2 + identifiedSpaces.length} 張）
                </span>
              </Button>
              <button
                onClick={handleMultiReset}
                className="w-full mt-2 text-xs text-gray-400 hover:text-gray-600 py-1"
              >
                重新分析
              </button>
            </>
          ) : multiPhase === "generating" ? (
            <Button fullWidth disabled>
              <span className="flex items-center gap-2">
                <RefreshCw className="animate-spin w-4 h-4" />
                生成中：{currentMultiSlot}
              </span>
            </Button>
          ) : (
            <>
              <div className="text-xs text-green-600 text-center mb-2 font-medium">
                ✓ 全部生成完成，已儲存至媒體庫
              </div>
              <button
                onClick={handleMultiReset}
                className="w-full py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                重新開始
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-gray-900/5 rounded-xl border border-gray-200 flex flex-col overflow-hidden relative">
        {viewMode === "single" ? (
          <>
            {resultImage && !isGenerating && (
              <div className="absolute top-4 right-4 z-10">
                <button
                  onClick={handleDownload}
                  className="p-2 bg-brand-600 rounded-lg shadow-sm hover:bg-brand-700 text-white"
                  title="下載渲染結果"
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
                  <p className="text-lg font-medium">尚未生成渲染圖</p>
                  <p className="text-sm">請先上傳線稿或空間圖</p>
                </div>
              )}

              {uploadedImage && !isGenerating && !resultImage && (
                <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
                  <img
                    src={uploadedImage}
                    alt="Sketch Preview"
                    className="h-full w-auto max-w-full max-h-full rounded-lg shadow-lg object-contain mx-auto"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-lg">
                    <span className="bg-white/90 px-4 py-2 rounded-full text-sm font-medium shadow-sm flex items-center gap-2">
                      <Wand2 className="w-4 h-4 text-brand-600" /> 準備就緒，點擊生成渲染
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
                    <p className="text-xs text-gray-500 text-center animate-pulse">{generationStatusText}</p>
                  </div>
                </div>
              )}

              {resultImage && !isGenerating && (
                <img
                  src={resultImage}
                  alt="Interior Rendered Result"
                  className="h-full w-auto max-w-full max-h-full rounded-lg shadow-2xl object-contain mx-auto"
                />
              )}
            </div>

            {resultSummary && (
              <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3">
                <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 max-h-24 overflow-y-auto">
                  <p className="text-xs font-semibold text-brand-700 mb-1">AI 設計說明</p>
                  <p className="text-xs text-brand-800 leading-relaxed whitespace-pre-wrap">{resultSummary}</p>
                  {resultMeta && <p className="text-[10px] text-brand-600 mt-2">{resultMeta}</p>}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* 頂部狀態列 */}
            <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center justify-between shrink-0">
              <div>
                <p className="text-sm font-semibold text-gray-800">多視角輸出</p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {multiPhase === "setup" && "上傳平面圖 → AI 識別空間 → 依序生成"}
                  {multiPhase === "analyzing" && "AI 正在分析平面圖空間配置..."}
                  {multiPhase === "review" && `已識別 ${identifiedSpaces.length} 個空間，確認後即可生成`}
                  {multiPhase === "generating" && `生成中：${currentMultiSlot}`}
                  {multiPhase === "done" && "全部生成完成，已儲存至媒體庫"}
                </p>
              </div>
              {(multiPhase === "generating" || multiPhase === "done") && multiViewResults.length > 0 && (
                <span className="text-xs text-gray-500 shrink-0">
                  {multiViewResults.filter((r) => r.status === "done").length} / {multiViewResults.length} 完成
                </span>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {/* 初始狀態 */}
              {multiPhase === "setup" && (
                <div className="h-full min-h-[240px] flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <ImageIcon className="w-14 h-14 mx-auto mb-3 opacity-20" />
                    <p className="text-sm font-medium text-gray-600">步驟說明</p>
                    <div className="mt-4 space-y-2 text-left max-w-xs mx-auto">
                      {[
                        { step: "1", text: "上傳平面圖（線稿或 CAD 圖）" },
                        { step: "2", text: "點擊「分析平面圖空間」—— AI 識別空間並標示" },
                        { step: "3", text: "確認空間清單，按下「開始生成」" },
                        { step: "4", text: "AI 依序輸出每個空間的渲染圖" },
                      ].map(({ step, text }) => (
                        <div key={step} className="flex items-start gap-2 text-xs text-gray-500">
                          <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                            {step}
                          </span>
                          {text}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 分析中 */}
              {multiPhase === "analyzing" && (
                <div className="h-full min-h-[240px] flex items-center justify-center">
                  <div className="text-center">
                    <RefreshCw className="w-10 h-10 animate-spin text-brand-600 mx-auto mb-3" />
                    <p className="text-sm font-medium text-gray-700">AI 正在分析平面圖...</p>
                    <p className="text-xs text-gray-400 mt-1">識別空間名稱與配置，約需 20–40 秒</p>
                  </div>
                </div>
              )}

              {/* 審核階段：顯示標示平面圖 */}
              {multiPhase === "review" && labeledFloorPlan && (
                <div className="space-y-4">
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                    <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold flex items-center justify-center">✓</span>
                      <span className="text-sm font-medium text-gray-700">AI 標示平面圖（作為所有視角的參考底圖）</span>
                    </div>
                    <img
                      src={labeledFloorPlan}
                      alt="標示平面圖"
                      className="w-full object-contain max-h-96"
                    />
                  </div>
                  <div className="bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 text-xs text-brand-700">
                    將生成：標示平面圖（已完成）+ VRay 全室渲染 + 2.5D 俯視 + {identifiedSpaces.length} 個空間場景，共 {2 + identifiedSpaces.length + 1} 張
                  </div>
                </div>
              )}

              {/* 生成中 / 完成：顯示結果 grid */}
              {(multiPhase === "generating" || multiPhase === "done") && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {multiViewResults.map((result, index) => (
                    <div
                      key={result.slotKey}
                      className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm"
                    >
                      <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                            {index + 1}
                          </span>
                          <span className="text-sm font-medium text-gray-700">{result.label}</span>
                        </div>
                        {result.status === "generating" && (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-brand-600" />
                        )}
                        {result.status === "done" && result.imageDataUrl && (
                          <button
                            onClick={() => {
                              const link = document.createElement("a");
                              link.href = result.imageDataUrl!;
                              link.download = `${result.label}-${formatFileDate()}.png`;
                              link.click();
                            }}
                            className="p-1 hover:bg-gray-200 rounded text-gray-500 hover:text-gray-700 transition-colors"
                            title="下載此視角圖"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="aspect-[4/3] bg-gray-50 flex items-center justify-center relative overflow-hidden">
                        {result.status === "idle" && <p className="text-xs text-gray-400">等待生成...</p>}
                        {result.status === "generating" && (
                          <div className="text-center text-brand-600">
                            <RefreshCw className="w-7 h-7 animate-spin mx-auto mb-2" />
                            <p className="text-xs">AI 生成中...</p>
                          </div>
                        )}
                        {result.status === "done" && result.imageDataUrl && (
                          <img src={result.imageDataUrl} alt={result.label} className="w-full h-full object-contain" />
                        )}
                        {result.status === "error" && (
                          <div className="text-center text-red-500 px-4">
                            <p className="text-xs font-medium">生成失敗</p>
                            <p className="text-[11px] mt-1 text-red-400">{result.error}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
