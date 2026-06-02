import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "./Button";
import {
  Download,
  Edit3,
  Image as ImageIcon,
  RefreshCw,
  Sliders,
  Sparkles,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { SlotImageEditor } from "./SlotImageEditor";
import { resolveClientUserScopeId } from "@/lib/client/user-scope";
import { useCredits } from "@/lib/client/use-credits";

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
  generationPrompt?: string;
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
  "請仔細分析這張建築平面圖，輸出一張清晰的標示版平面圖：保留所有牆面、門窗、傢具輪廓，以黑白線條呈現正上方俯視圖，根據平面圖實際內容在每個空間內用繁體中文標示空間名稱，不要新增不存在的空間，確保格局與原圖完全一致。";

const AREA_ESTIMATION_PROMPT =
  "你是一位專業的室內設計估算師。請仔細分析這張建築平面圖，根據圖面比例與空間配置，估算以下資訊。" +
  "即使無法精確測量，也請根據常見台灣住宅尺寸合理推估。" +
  "請嚴格以下列 JSON 格式輸出（不要輸出其他內容）：\n" +
  'AREA_JSON:{"totalPing":數字,"totalSqm":數字,"spaces":[{"name":"空間名","sqm":數字,"ping":數字}],' +
  '"floorArea":數字,"ceilingArea":數字,"wallArea":數字,"doors":數字,"windows":數字}\n' +
  "其中：totalPing=總坪數, totalSqm=總平方公尺, spaces=各空間明細(sqm+ping), " +
  "floorArea=地板總面積(sqm), ceilingArea=天花板總面積(sqm), wallArea=牆面總面積(sqm, 假設樓高2.8m), " +
  "doors=門的總數量, windows=窗戶總數量。所有數字保留一位小數。";

interface AreaEstimation {
  totalPing: number;
  totalSqm: number;
  spaces: Array<{ name: string; sqm: number; ping: number }>;
  floorArea: number;
  ceilingArea: number;
  wallArea: number;
  doors: number;
  windows: number;
}

/**
 * 在圖片上疊加面積標註，回傳新的 data URL。
 */
const overlayAreaAnnotations = (
  imageDataUrl: string,
  area: AreaEstimation,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("canvas not supported")); return; }

      ctx.drawImage(img, 0, 0);
      const w = canvas.width;
      const h = canvas.height;
      const scale = Math.max(1, Math.min(w, h) / 800);

      // 右上角總面積方塊
      const boxW = 180 * scale;
      const boxH = 60 * scale;
      const boxX = w - boxW - 12 * scale;
      const boxY = 12 * scale;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 8 * scale);
      ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `bold ${18 * scale}px "Microsoft JhengHei", sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(`${area.totalPing} 坪`, boxX + boxW / 2, boxY + 24 * scale);
      ctx.font = `${12 * scale}px "Microsoft JhengHei", sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillText(`${area.totalSqm} m²`, boxX + boxW / 2, boxY + 44 * scale);

      // 左下角施工面積表
      const tableX = 12 * scale;
      const tableY = h - 12 * scale;
      const lineH = 18 * scale;
      const rows = [
        `地板 ${area.floorArea} m²  |  天花板 ${area.ceilingArea} m²  |  牆面 ${area.wallArea} m²`,
        `門 ${area.doors} 個  |  窗 ${area.windows} 個`,
      ];
      const tableH = (rows.length + 0.5) * lineH;
      const tableW = 340 * scale;

      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.beginPath();
      ctx.roundRect(tableX, tableY - tableH, tableW, tableH, 8 * scale);
      ctx.fill();

      ctx.fillStyle = "#FFFFFF";
      ctx.font = `${11 * scale}px "Microsoft JhengHei", sans-serif`;
      ctx.textAlign = "left";
      rows.forEach((text, i) => {
        ctx.fillText(text, tableX + 10 * scale, tableY - tableH + (i + 1) * lineH);
      });

      // 各空間標註（分散排列在圖片上方）
      if (area.spaces.length > 0) {
        const tagH = 22 * scale;
        const gap = 6 * scale;
        const startY = boxY + boxH + 16 * scale;
        let curX = w - 12 * scale;
        area.spaces.forEach((space) => {
          const label = `${space.name} ${space.ping}坪`;
          ctx.font = `${11 * scale}px "Microsoft JhengHei", sans-serif`;
          const tw = ctx.measureText(label).width + 14 * scale;
          curX -= tw + gap;
          if (curX < 0) { curX = w - 12 * scale - tw - gap; }

          ctx.fillStyle = "rgba(59,130,246,0.8)";
          ctx.beginPath();
          ctx.roundRect(curX, startY, tw, tagH, 4 * scale);
          ctx.fill();

          ctx.fillStyle = "#FFFFFF";
          ctx.textAlign = "left";
          ctx.fillText(label, curX + 7 * scale, startY + 15 * scale);
        });
      }

      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => reject(new Error("圖片載入失敗"));
    img.src = imageDataUrl;
  });

interface ViewSlotDef {
  slotKey: string;
  label: string;
  group: "colored" | "section";
  referenceSource: string; // "labeled-floor-plan" 或前一個 slotKey
  referenceExampleUrl: string; // 參考案例圖 URL
  prompt: string;
}

const FIXED_VIEW_SLOTS: ViewSlotDef[] = [
  // ── 彩色平面圖系列（全部嚴格 2D 俯視，禁止 3D） ──
  {
    slotKey: "colored-handdrawn",
    label: "彩色平面圖-手繪",
    group: "colored",
    referenceSource: "labeled-floor-plan",
    referenceExampleUrl: "/ref/colored-handdrawn.jpg",
    prompt:
      "Convert this labeled floor plan into a hand-drawn watercolor architectural floor plan (彩色手繪平面圖). " +
      "STRICT RULES: " +
      "(1) This is a FLAT 2D drawing — absolutely NO 3D perspective, NO wall height, NO depth. " +
      "Think of it as a paper document, not a 3D render. " +
      "(2) Keep every wall, door, window, and furniture piece in the EXACT same position and quantity as the input. " +
      "Do NOT add, remove, or move any object. " +
      "(3) Walls = thick black lines. Fill each room with soft watercolor washes (warm beige for living room, " +
      "light blue-green for bedrooms, pale yellow for kitchen, light blue for bathrooms). " +
      "(4) Furniture shown as 2D top-down icons with watercolor fill — beds, sofas, tables are flat shapes viewed from directly above. " +
      "(5) Camera = perfectly orthographic top-down at exactly 90°. The output must look like a flat architectural plan printed on paper.",
  },
  {
    slotKey: "colored-cartoon",
    label: "彩色平面圖-卡通",
    group: "colored",
    referenceSource: "colored-handdrawn",
    referenceExampleUrl: "/ref/colored-cartoon.jpg",
    prompt:
      "Convert this hand-drawn floor plan into a colorful cartoon floor plan illustration (卡通平面圖). " +
      "STRICT RULES: " +
      "(1) This is a FLAT 2D illustration — absolutely NO 3D, NO perspective, NO depth, NO wall height visible. " +
      "(2) Keep every wall, door, window, and furniture piece in the EXACT same position. " +
      "(3) Use bright, saturated, flat colors — red, blue, green, yellow, orange. Bold clean outlines. " +
      "(4) Furniture as simplified cartoon 2D top-down icons (like clip art viewed from above). " +
      "(5) Style reference: children's book illustration of a floor plan, vector-art quality, fun and colorful. " +
      "(6) Camera = perfectly orthographic top-down at exactly 90°.",
  },
  {
    slotKey: "colored-noshadow",
    label: "彩色平面圖-無陰影",
    group: "colored",
    referenceSource: "colored-handdrawn",
    referenceExampleUrl: "/ref/colored-noshadow.jpg",
    prompt:
      "Convert this hand-drawn floor plan into a clean CAD-style colored floor plan with NO shadows (無陰影彩色平面圖). " +
      "STRICT RULES: " +
      "(1) This is a FLAT 2D plan — absolutely NO 3D, NO perspective, NO depth, NO wall height. " +
      "(2) Keep every wall, door, window, and furniture piece in the EXACT same position. " +
      "(3) Remove ALL shadows, ALL gradients. Use ONLY flat solid fills — muted professional earth tones " +
      "(gray-brown walls, tan/beige floors, olive furniture, slate bathrooms). " +
      "(4) Clean thin lines, professional architectural presentation style like AutoCAD output with solid color fills. " +
      "(5) Camera = perfectly orthographic top-down at exactly 90°.",
  },
  {
    slotKey: "colored-realistic",
    label: "彩色平面圖-擬真",
    group: "colored",
    referenceSource: "colored-handdrawn",
    referenceExampleUrl: "/ref/colored-realistic.jpg",
    prompt:
      "Convert this hand-drawn floor plan into a photorealistic top-down rendered floor plan (擬真俯視平面渲染圖). " +
      "STRICT RULES: " +
      "(1) Keep every wall, door, window, and furniture piece in the EXACT same position. " +
      "(2) Replace all fills with photorealistic material textures viewed from directly above — real wood grain floors, " +
      "stone tiles in bathrooms, fabric textures on sofas/beds, metal fixtures. " +
      "(3) Add subtle natural lighting shadows cast downward. Walls show slight 3D depth/thickness. " +
      "(4) Style reference: high-end real estate marketing top-down 3D floor plan with Chinese room labels (主臥室, 客廳, 廚房 etc.). " +
      "(5) Camera = top-down view, nearly 90° but slight depth allowed for material realism. " +
      "This should look like a Lumion/3ds Max top-view rendering, NOT a hand drawing.",
  },
  // ── 剖透圖系列（3D 渲染，不同相機角度） ──
  {
    slotKey: "section-top",
    label: "剖透圖-上視角度",
    group: "section",
    referenceSource: "colored-handdrawn",
    referenceExampleUrl: "/ref/section-top.jpg",
    prompt:
      "Create a 3D cutaway floor plan viewed from DIRECTLY ABOVE (剖透圖-上視角度). " +
      "STRICT RULES: " +
      "(1) Keep every room, wall, door, window, and furniture piece in the EXACT same position as the input plan. " +
      "(2) Walls are cut horizontally at 1 meter height — you can see inside all rooms. " +
      "Wall material = white or light gray. Wall thickness clearly visible. " +
      "(3) All furniture is rendered as 3D objects (beds have pillows/blankets, sofas have cushions, tables have items on them) " +
      "but viewed from STRAIGHT ABOVE at exactly 90°. " +
      "(4) Realistic floor materials (wood, tile). " +
      "(5) Style = standard '3D Floor Plan' product used in real estate marketing. Clean white background. " +
      "(6) Camera angle = EXACTLY 90° straight down. No tilt, no perspective distortion.",
  },
  {
    slotKey: "section-birds-eye",
    label: "剖透圖-俯視角度",
    group: "section",
    referenceSource: "colored-handdrawn",
    referenceExampleUrl: "/ref/section-birds-eye.jpg",
    prompt:
      "Create a 3D bird's-eye perspective view of this floor plan (剖透圖-俯視角度). " +
      "STRICT RULES: " +
      "(1) Keep every room and furniture piece in the EXACT same position as the input plan. " +
      "(2) Camera elevation = approximately 50-55° from horizontal (looking down at a steep angle from one side). " +
      "This means the camera is NOT directly above — it is clearly offset to one side, showing a STRONG perspective effect: " +
      "rooms closer to camera appear LARGER, rooms farther away appear SMALLER. " +
      "The BACK walls are clearly visible as vertical surfaces. Front walls are cut low or removed. " +
      "(3) All walls rendered at full 2.7m height (not cut at 1m). Roof removed. " +
      "You can see the TOP of furniture AND the FRONT/SIDE of furniture simultaneously. " +
      "(4) This MUST look dramatically different from a flat top-down view. " +
      "Imagine standing on a tall ladder at the edge of the apartment looking down and across. " +
      "(5) Clean white/beige background. Photorealistic 3D rendering quality.",
  },
  {
    slotKey: "section-oblique",
    label: "剖透圖-斜角度",
    group: "section",
    referenceSource: "colored-handdrawn",
    referenceExampleUrl: "/ref/section-oblique.webp",
    prompt:
      "Create a 3D isometric cutaway view of this floor plan from a DIAGONAL CORNER ANGLE (剖透圖-斜角度). " +
      "STRICT RULES: " +
      "(1) Keep every room and furniture piece in the EXACT same position as the input plan. " +
      "(2) Camera is positioned at approximately 45° elevation, looking from one corner diagonally across the apartment. " +
      "The building is viewed from a low-angle corner — you can clearly see FULL wall heights (2.7m), " +
      "room interiors, furniture from the SIDE, and the floor. " +
      "(3) Front walls are removed or cut to reveal interior. Back walls remain at full height. " +
      "(4) The building sits on a clean platform/base. Background = white or light gray. " +
      "(5) Style = isometric architectural cutaway model, like a SketchUp or Lumion render. " +
      "(6) This must look DRAMATICALLY different from a top-down view — it's like looking into a dollhouse from across a table.",
  },
  {
    slotKey: "section-3d",
    label: "剖透圖-立體模型",
    group: "section",
    referenceSource: "colored-handdrawn",
    referenceExampleUrl: "/ref/section-3d.jpg",
    prompt:
      "Create a photorealistic 3D architectural dollhouse model of this floor plan (剖透圖-立體模型). " +
      "STRICT RULES: " +
      "(1) Keep every room and furniture piece in the EXACT same position as the input plan. " +
      "(2) Camera at 30-45° elevation from one corner, viewing the ENTIRE apartment as a miniature architectural model. " +
      "Roof removed. All four walls partially visible, front walls lower or removed to show interior. " +
      "(3) MAXIMUM 3D detail: realistic furniture, lighting effects, plants, decor items, material textures. " +
      "This should look like a professional CGI render of an architectural scale model. " +
      "(4) Dramatic lighting — warm interior lights visible, subtle shadows. " +
      "(5) Background = dark gray gradient or studio backdrop, making the model stand out. " +
      "(6) Quality = V-Ray / Unreal Engine photorealistic render. " +
      "Think: luxury real estate marketing 3D model visualization.",
  },
];

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

interface AIStudioProps {
  restore?: {
    prompt?: string;
    generationPrompt?: string;
    roomType?: string;
    imageUrl?: string;
  };
}

export const AIStudio: React.FC<AIStudioProps> = ({ restore }) => {
  const { data: session } = useSession();
  const credits = useCredits();
  const [insufficientCreditsMsg, setInsufficientCreditsMsg] = useState<string | null>(null);
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
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);

  /* 從媒體庫帶回生成設定（提示詞、空間類型） */
  const restoreAppliedRef = useRef(false);
  useEffect(() => {
    if (!restore || restoreAppliedRef.current) return;
    restoreAppliedRef.current = true;
    const text = restore.prompt || restore.generationPrompt || "";
    if (text) setDesignerPrompt(text);
    if (restore.roomType) setSelectedRoomType(restore.roomType);
    setRestoreNotice("已帶入原生成設定，請上傳線稿/空間圖後重新生成");
    setTimeout(() => setRestoreNotice(null), 7000);
  }, [restore]);
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
  const [multiPhase, setMultiPhase] = useState<"setup" | "analyzing" | "review" | "steps" | "done">("setup");
  const [sessionPackageId, setSessionPackageId] = useState("");
  const [sessionPackageLabel, setSessionPackageLabel] = useState("");
  const [slotCustomPrompts, setSlotCustomPrompts] = useState<Record<string, string>>({});
  const [slotPromptExpanded, setSlotPromptExpanded] = useState<Record<string, boolean>>({});
  const [labeledFloorPlan, setLabeledFloorPlan] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeCustomPrompt, setAnalyzeCustomPrompt] = useState("");
  const [areaEstimation, setAreaEstimation] = useState<AreaEstimation | null>(null);
  const [isEstimatingArea, setIsEstimatingArea] = useState(false);
  const [annotatedPreview, setAnnotatedPreview] = useState<string | null>(null);
  const [editingSlot, setEditingSlot] = useState<{ slotKey: string; imageDataUrl: string; label: string } | null>(null);

  /* Q7：AI 空間設計清單（平面圖 → 各空間設計項目） */
  interface RoomDesignPlan {
    room: string;
    purpose: string;
    items: string[];
  }
  const [designPlan, setDesignPlan] = useState<RoomDesignPlan[] | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);

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
      generationPrompt?: string;
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
          generationPrompt: input.generationPrompt || "",
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

  // 取得某個 slotKey 的所有下游 slot（遞迴）
  const getDownstreamSlotKeys = useCallback((slotKey: string): string[] => {
    const direct = FIXED_VIEW_SLOTS.filter((s) => s.referenceSource === slotKey);
    const all: string[] = [];
    for (const s of direct) {
      all.push(s.slotKey);
      all.push(...getDownstreamSlotKeys(s.slotKey));
    }
    return all;
  }, []);

  const getCompletedImageDataUrl = useCallback((slotKey: string): string | null => {
    if (slotKey === "labeled-floor-plan") return labeledFloorPlan;
    const r = multiViewResults.find((x) => x.slotKey === slotKey);
    return r?.status === "done" && r.imageDataUrl ? r.imageDataUrl : null;
  }, [labeledFloorPlan, multiViewResults]);

  const handleOverlayArea = useCallback(async (imageDataUrl: string) => {
    if (!areaEstimation) return;
    try {
      const annotated = await overlayAreaAnnotations(imageDataUrl, areaEstimation);
      setAnnotatedPreview(annotated);
    } catch {
      // ignore
    }
  }, [areaEstimation]);

  const handleDownloadAnnotated = useCallback(() => {
    if (!annotatedPreview) return;
    const link = document.createElement("a");
    link.href = annotatedPreview;
    link.download = `floor-plan-annotated-${Date.now()}.jpg`;
    link.click();
  }, [annotatedPreview]);

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
    // 扣點檢查（先 confirm 預估費用）
    const deduction = await credits.confirmAndDeduct("生成室內渲染", "ai-render");
    if (!deduction.ok) {
      if (!deduction.cancelled) setInsufficientCreditsMsg(deduction.error || "點數不足");
      return;
    }
    setIsGenerating(true);
    setErrorMessage(null);
    setInsufficientCreditsMsg(null);
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
        const refineDeduct = await credits.tryDeduct("ai-render");
        if (!refineDeduct.ok) {
          setInsufficientCreditsMsg(refineDeduct.error || "點數不足（細節修復）");
        } else {
          setGenerationStatusText("正在進行細節修復...");
          setGenerationProgress((prev) => Math.max(prev, 86));
          refineInfo = await requestRefine(finalImage);
          finalImage = refineInfo.imageDataUrl;
          qualityTag = "細節修復";
        }
      }

      if (outputQuality === "hd2x") {
        const upscaleDeduct = await credits.tryDeduct("ai-render");
        if (!upscaleDeduct.ok) {
          setInsufficientCreditsMsg(upscaleDeduct.error || "點數不足（高清增強）");
        } else {
          setGenerationStatusText("正在進行高清增強...");
          setGenerationProgress((prev) => Math.max(prev, 92));
          upscaleInfo = await requestUpscale(finalImage);
          finalImage = upscaleInfo.imageDataUrl;
          qualityTag = `細節修復 + 高清 x${upscaleInfo.scaleApplied}`;
        }
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
    const deduction = await credits.confirmAndDeduct("分析平面圖", "ai-render-analyze");
    if (!deduction.ok) {
      if (!deduction.cancelled) setInsufficientCreditsMsg(deduction.error || "點數不足");
      return;
    }
    setIsAnalyzing(true);
    setMultiPhase("analyzing");
    setErrorMessage(null);
    setInsufficientCreditsMsg(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 110_000); // 110 秒前端逾時

    try {
      const response = await fetch("/api/ai/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          imageDataUrl: uploadedImage,
          roomType: "全室整合",
          style: "平面圖分析",
          lockFace: false,
          preserveIdentityStrict: false,
          preferredModel: selectedModel === "auto" ? undefined : selectedModel,
          customPrompt: [ANALYZE_FLOOR_PLAN_PROMPT, analyzeCustomPrompt.trim()].filter(Boolean).join("\n"),
          creativity: 10,
        }),
      });
      const raw = await response.text();
      const payload = raw ? (JSON.parse(raw) as Partial<RenderApiResponse> & { error?: string }) : {};
      if (!response.ok || !payload.imageDataUrl) {
        throw new Error(payload.error || "分析失敗，請重試");
      }
      setLabeledFloorPlan(payload.imageDataUrl);
      setMultiPhase("review");

      // 同時啟動面積估算（內含在平面圖分析扣點裡，這裡不重複扣）
      setIsEstimatingArea(true);
      fetch("/api/ai/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: uploadedImage,
          roomType: "全室整合",
          style: "面積估算",
          lockFace: false,
          preserveIdentityStrict: false,
          preferredModel: selectedModel === "auto" ? undefined : selectedModel,
          customPrompt: AREA_ESTIMATION_PROMPT,
          creativity: 5,
        }),
      })
        .then((res) => res.text())
        .then((raw) => {
          const p = raw ? (JSON.parse(raw) as { summary?: string }) : {};
          const match = p.summary?.match(/AREA_JSON:\s*(\{[^}]*(?:\{[^}]*\}[^}]*)*\})/);
          if (match) {
            const parsed = JSON.parse(match[1]) as AreaEstimation;
            setAreaEstimation(parsed);
          }
        })
        .catch(() => {})
        .finally(() => setIsEstimatingArea(false));
    } catch (err) {
      const msg = err instanceof Error
        ? (err.name === "AbortError" ? "分析超時（逾 110 秒），請重試或換較小的圖片" : err.message)
        : "平面圖分析失敗，請重試";
      setErrorMessage(msg);
      setMultiPhase("setup");
    } finally {
      clearTimeout(timeoutId);
      setIsAnalyzing(false);
    }
  };

  // Q7：AI 依平面圖列出各空間設計項目
  const handleGenerateDesignPlan = async () => {
    if (!uploadedImage || isPlanning) return;
    const deduction = await credits.confirmAndDeduct("AI 空間設計清單", "ai-render-analyze");
    if (!deduction.ok) {
      if (!deduction.cancelled) setInsufficientCreditsMsg(deduction.error || "點數不足");
      return;
    }
    setIsPlanning(true);
    setErrorMessage(null);
    try {
      const prompt =
        "你是資深室內設計師。請看這張住宅平面圖，辨識每個空間（如玄關、客廳、餐廳、廚房、主臥、次臥、衛浴、書房、陽台等），" +
        "並為每個空間說明它的用途，以及建議的設計／裝修項目（例如客廳：電視主牆、收納櫃、間接照明）。" +
        "只輸出 JSON 陣列，不要其他文字。格式：" +
        '[{"room":"空間名","purpose":"用途說明(20字內)","items":["設計項目1","設計項目2"]}]';
      const res = await fetch("/api/ai/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: uploadedImage, prompt, temperature: 0.4, jsonMode: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "分析失敗");
      const text = (data.text || "").trim();
      const m = text.match(/\[[\s\S]*\]/);
      const parsed: RoomDesignPlan[] = m ? JSON.parse(m[0]) : [];
      const cleaned = parsed
        .map((p) => ({
          room: String(p.room || "").trim(),
          purpose: String(p.purpose || "").trim(),
          items: Array.isArray(p.items) ? p.items.map((i) => String(i).trim()).filter(Boolean) : [],
        }))
        .filter((p) => p.room);
      if (cleaned.length === 0) throw new Error("AI 未能辨識空間，請換清晰的平面圖");
      setDesignPlan(cleaned);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "空間設計清單生成失敗");
    } finally {
      setIsPlanning(false);
    }
  };

  // 第二步：確認標示圖後進入逐步生成模式
  const handleStartSteps = useCallback(() => {
    if (!labeledFloorPlan) return;
    const { packageId, packageLabel } = generatePackageId();
    setSessionPackageId(packageId);
    setSessionPackageLabel(packageLabel);
    const initialResults: MultiViewResult[] = [
      {
        slotKey: "labeled-floor-plan",
        label: "標示平面圖",
        status: "done",
        imageDataUrl: labeledFloorPlan,
        summary: "AI 已識別空間並標示完成",
      },
      ...FIXED_VIEW_SLOTS.map((slot) => ({ slotKey: slot.slotKey, label: slot.label, status: "idle" as const })),
    ];
    setMultiViewResults(initialResults);
    setMultiPhase("steps");
    setErrorMessage(null);
    void saveResultToServer({
      imageDataUrl: labeledFloorPlan,
      summary: "AI 標示平面圖",
      modelTag: selectedModel || "Gemini",
      packageId,
      packageLabel,
      slotLabel: "標示平面圖",
    }).catch(() => {});
  }, [labeledFloorPlan, saveResultToServer, selectedModel]);

  // 生成單一視角
  const handleGenerateSingleSlot = useCallback(async (slot: ViewSlotDef) => {
    if (isMultiGenerating) return;
    const referenceImage = getCompletedImageDataUrl(slot.referenceSource);
    if (!referenceImage) return;

    const deduction = await credits.confirmAndDeduct(`生成視角：${slot.label}`, "ai-render");
    if (!deduction.ok) {
      if (!deduction.cancelled) setInsufficientCreditsMsg(deduction.error || "點數不足");
      return;
    }
    setInsufficientCreditsMsg(null);
    setIsMultiGenerating(true);
    setCurrentMultiSlot(slot.slotKey);
    setMultiViewResults((prev) =>
      prev.map((r) => (r.slotKey === slot.slotKey ? { ...r, status: "generating" as const } : r))
    );

    const customExtra = (slotCustomPrompts[slot.slotKey] || "").trim();
    const styleRef = slot.referenceExampleUrl
      ? `\nIMPORTANT STYLE REFERENCE: Generate the output to match the exact visual style, camera angle, and rendering quality shown at this reference URL: ${slot.referenceExampleUrl}. Copy the same perspective, color palette, and level of detail.`
      : "";
    const mergedPrompt = [slot.prompt, styleRef, customExtra, designerPrompt.trim()].filter(Boolean).join("\n");

    // 嘗試將參考案例圖轉為 base64 傳給 AI 作為風格引導
    let refExampleBase64: string | undefined;
    if (slot.referenceExampleUrl) {
      try {
        const refRes = await fetch(slot.referenceExampleUrl);
        if (refRes.ok) {
          const refBlob = await refRes.blob();
          refExampleBase64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => resolve("");
            reader.readAsDataURL(refBlob);
          });
        }
      } catch { /* ignore */ }
    }

    try {
      const response = await fetch("/api/ai/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: referenceImage,
          referenceDressImageDataUrl: refExampleBase64 || undefined,
          roomType: "全室整合",
          style: slot.label,
          lockFace: false,
          preserveIdentityStrict: false,
          preferredModel: selectedModel === "auto" ? undefined : selectedModel,
          customPrompt: mergedPrompt,
          creativity: 5,
        }),
      });
      const raw = await response.text();
      const payload = raw ? (JSON.parse(raw) as Partial<RenderApiResponse> & { error?: string }) : {};
      if (!response.ok || !payload.imageDataUrl) throw new Error(payload.error || "AI 渲染失敗");

      setMultiViewResults((prev) =>
        prev.map((r) =>
          r.slotKey === slot.slotKey
            ? { ...r, status: "done" as const, imageDataUrl: payload.imageDataUrl, summary: payload.summary, generationPrompt: mergedPrompt }
            : r
        )
      );
      void saveResultToServer({
        imageDataUrl: payload.imageDataUrl!,
        summary: payload.summary || `${slot.label} 完成`,
        modelTag: payload.model || "Gemini",
        packageId: sessionPackageId,
        packageLabel: sessionPackageLabel,
        slotLabel: slot.label,
        generationPrompt: mergedPrompt,
      }).catch(() => {});
    } catch (error) {
      setMultiViewResults((prev) =>
        prev.map((r) =>
          r.slotKey === slot.slotKey
            ? { ...r, status: "error" as const, error: error instanceof Error ? error.message : "生成失敗" }
            : r
        )
      );
    } finally {
      setIsMultiGenerating(false);
      setCurrentMultiSlot("");
    }
  }, [isMultiGenerating, getCompletedImageDataUrl, slotCustomPrompts, designerPrompt, selectedModel, saveResultToServer, sessionPackageId, sessionPackageLabel]);

  // 重新生成已完成的 slot：先重置自身 + 所有下游，再觸發生成
  const handleRegenerateSingleSlot = useCallback(async (slot: ViewSlotDef) => {
    if (isMultiGenerating) return;
    const downstreamKeys = getDownstreamSlotKeys(slot.slotKey);
    setMultiViewResults((prev) =>
      prev.map((r) =>
        r.slotKey === slot.slotKey || downstreamKeys.includes(r.slotKey)
          ? { ...r, status: "idle" as const, imageDataUrl: undefined, summary: undefined, error: undefined }
          : r
      )
    );
    // 等 state 更新後再觸發（nextTick）
    setTimeout(() => void handleGenerateSingleSlot(slot), 50);
  }, [isMultiGenerating, getDownstreamSlotKeys, handleGenerateSingleSlot]);

  // 重新分析標示平面圖（steps 階段）：重置所有 slot
  const handleRegenerateAnalysis = useCallback(async () => {
    if (isAnalyzing || isMultiGenerating) return;
    // 重置所有 slot 到 idle
    setMultiViewResults((prev) =>
      prev.map((r) =>
        r.slotKey === "labeled-floor-plan"
          ? r
          : { ...r, status: "idle" as const, imageDataUrl: undefined, summary: undefined, error: undefined }
      )
    );
    setIsAnalyzing(true);
    setErrorMessage(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 110_000);

    try {
      const response = await fetch("/api/ai/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          imageDataUrl: uploadedImage,
          roomType: "全室整合",
          style: "平面圖分析",
          lockFace: false,
          preserveIdentityStrict: false,
          preferredModel: selectedModel === "auto" ? undefined : selectedModel,
          customPrompt: [ANALYZE_FLOOR_PLAN_PROMPT, analyzeCustomPrompt.trim()].filter(Boolean).join("\n"),
          creativity: 10,
        }),
      });
      const raw = await response.text();
      const payload = raw ? (JSON.parse(raw) as Partial<RenderApiResponse> & { error?: string }) : {};
      if (!response.ok || !payload.imageDataUrl) throw new Error(payload.error || "分析失敗，請重試");

      setLabeledFloorPlan(payload.imageDataUrl);
      // 更新 multiViewResults 中的標示平面圖
      setMultiViewResults((prev) =>
        prev.map((r) =>
          r.slotKey === "labeled-floor-plan"
            ? { ...r, imageDataUrl: payload.imageDataUrl, summary: payload.summary || "AI 標示完成" }
            : r
        )
      );
      // 重新儲存
      void saveResultToServer({
        imageDataUrl: payload.imageDataUrl,
        summary: "AI 標示平面圖（重新分析）",
        modelTag: selectedModel || "Gemini",
        packageId: sessionPackageId,
        packageLabel: sessionPackageLabel,
        slotLabel: "標示平面圖",
      }).catch(() => {});
    } catch (err) {
      const msg = err instanceof Error
        ? (err.name === "AbortError" ? "分析超時，請重試" : err.message)
        : "平面圖分析失敗";
      setErrorMessage(msg);
    } finally {
      clearTimeout(timeoutId);
      setIsAnalyzing(false);
    }
  }, [isAnalyzing, isMultiGenerating, uploadedImage, selectedModel, analyzeCustomPrompt, saveResultToServer, sessionPackageId, sessionPackageLabel]);

  // 局部調整：將帶標記的圖片送回 AI 重新生成
  const handleApplySlotEdit = useCallback(
    async (annotatedImageDataUrl: string, editPrompt: string) => {
      if (!editingSlot) return;
      const slotKey = editingSlot.slotKey;

      setMultiViewResults((prev) =>
        prev.map((r) => (r.slotKey === slotKey ? { ...r, status: "generating" as const } : r))
      );

      const slotDef = FIXED_VIEW_SLOTS.find((s) => s.slotKey === slotKey);
      const style = slotDef?.label || editingSlot.label;

      try {
        const response = await fetch("/api/ai/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageDataUrl: annotatedImageDataUrl,
            roomType: "全室整合",
            style: `${style} 局部調整`,
            lockFace: false,
            preserveIdentityStrict: false,
            preferredModel: selectedModel === "auto" ? undefined : selectedModel,
            customPrompt:
              "This image has areas highlighted with semi-transparent red brush strokes. " +
              "ONLY modify the content INSIDE the red-marked areas according to this instruction: " +
              editPrompt +
              ". Keep everything OUTSIDE the red-marked areas COMPLETELY UNCHANGED — " +
              "same furniture, same colors, same materials, same layout, pixel-level identical.",
            creativity: 5,
          }),
        });
        const raw = await response.text();
        const payload = raw
          ? (JSON.parse(raw) as Partial<{ imageDataUrl: string; summary: string; model: string; error: string }>)
          : {};
        if (!response.ok || !payload.imageDataUrl) {
          throw new Error(payload.error || "局部調整失敗");
        }

        const regionalPrompt = `局部調整：${editPrompt}`;
        setMultiViewResults((prev) =>
          prev.map((r) =>
            r.slotKey === slotKey
              ? { ...r, status: "done" as const, imageDataUrl: payload.imageDataUrl, summary: payload.summary, generationPrompt: regionalPrompt }
              : r
          )
        );

        // 如果是標示平面圖，更新 labeledFloorPlan
        if (slotKey === "labeled-floor-plan" && payload.imageDataUrl) {
          setLabeledFloorPlan(payload.imageDataUrl);
        }

        // 儲存
        void saveResultToServer({
          imageDataUrl: payload.imageDataUrl!,
          summary: payload.summary || `${style} 局部調整完成`,
          modelTag: payload.model || "Gemini",
          packageId: sessionPackageId,
          packageLabel: sessionPackageLabel,
          slotLabel: `${style}（局部調整）`,
          generationPrompt: regionalPrompt,
        }).catch(() => {});
      } catch (error) {
        setMultiViewResults((prev) =>
          prev.map((r) =>
            r.slotKey === slotKey
              ? { ...r, status: "done" as const, error: error instanceof Error ? error.message : "局部調整失敗" }
              : r
          )
        );
      }
      setEditingSlot(null);
    },
    [editingSlot, selectedModel, saveResultToServer, sessionPackageId, sessionPackageLabel],
  );

  // 一鍵生成所有剩餘（按照 slot 順序，使用本地 completedImages 確保鏈式一致性）
  const handleGenerateAllRemaining = useCallback(async () => {
    if (isMultiGenerating || !labeledFloorPlan) return;

    const completedImages = new Map<string, string>();
    completedImages.set("labeled-floor-plan", labeledFloorPlan);
    multiViewResults.forEach((r) => {
      if (r.status === "done" && r.imageDataUrl) completedImages.set(r.slotKey, r.imageDataUrl);
    });

    const pendingSlots = FIXED_VIEW_SLOTS.filter((slot) => {
      const existing = multiViewResults.find((r) => r.slotKey === slot.slotKey);
      return existing?.status !== "done";
    });
    if (pendingSlots.length === 0) return;

    // loop 外先 confirm 整體費用
    const batch = await credits.confirmAndDeduct(
      `一鍵生成剩餘 ${pendingSlots.length} 個視角`,
      "ai-render",
      pendingSlots.length,
    );
    if (!batch.ok) {
      if (!batch.cancelled) setInsufficientCreditsMsg(batch.error || "點數不足");
      return;
    }

    setIsMultiGenerating(true);

    for (const slot of FIXED_VIEW_SLOTS) {
      const existing = multiViewResults.find((r) => r.slotKey === slot.slotKey);
      if (existing?.status === "done") continue;

      const referenceImage = completedImages.get(slot.referenceSource);
      if (!referenceImage) continue;

      setCurrentMultiSlot(slot.slotKey);
      setMultiViewResults((prev) =>
        prev.map((r) => (r.slotKey === slot.slotKey ? { ...r, status: "generating" as const } : r))
      );

      const customExtra = (slotCustomPrompts[slot.slotKey] || "").trim();
      const mergedPrompt = [slot.prompt, customExtra, designerPrompt.trim()].filter(Boolean).join("\n");

      try {
        const response = await fetch("/api/ai/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageDataUrl: referenceImage,
            roomType: "全室整合",
            style: slot.label,
            lockFace: false,
            preserveIdentityStrict: false,
            preferredModel: selectedModel === "auto" ? undefined : selectedModel,
            customPrompt: mergedPrompt,
            creativity: 5,
          }),
        });
        const raw = await response.text();
        const payload = raw ? (JSON.parse(raw) as Partial<RenderApiResponse> & { error?: string }) : {};
        if (!response.ok || !payload.imageDataUrl) throw new Error(payload.error || "AI 渲染失敗");

        completedImages.set(slot.slotKey, payload.imageDataUrl);
        setMultiViewResults((prev) =>
          prev.map((r) =>
            r.slotKey === slot.slotKey
              ? { ...r, status: "done" as const, imageDataUrl: payload.imageDataUrl, summary: payload.summary, generationPrompt: mergedPrompt }
              : r
          )
        );
        void saveResultToServer({
          imageDataUrl: payload.imageDataUrl!,
          summary: payload.summary || `${slot.label} 完成`,
          modelTag: payload.model || "Gemini",
          packageId: sessionPackageId,
          packageLabel: sessionPackageLabel,
          slotLabel: slot.label,
          generationPrompt: mergedPrompt,
        }).catch(() => {});
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
  }, [isMultiGenerating, labeledFloorPlan, multiViewResults, slotCustomPrompts, designerPrompt, selectedModel, saveResultToServer, sessionPackageId, sessionPackageLabel]);

  const handleMultiReset = () => {
    setMultiPhase("setup");
    setLabeledFloorPlan(null);
    setMultiViewResults([]);
    setSessionPackageId("");
    setSessionPackageLabel("");
    setSlotCustomPrompts({});
    setSlotPromptExpanded({});
    setAnalyzeCustomPrompt("");
    setAreaEstimation(null);
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

      <div className="w-full lg:w-80 max-h-[35vh] lg:max-h-none bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Sliders className="w-4 h-4" /> 室內設計模擬設定
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {restoreNotice && (
            <div className="rounded-lg bg-brand-50 border border-brand-100 px-3 py-2 text-xs text-brand-700">
              ✨ {restoreNotice}
            </div>
          )}
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

          {/* Q7：AI 空間設計清單 */}
          <div className={!uploadedImage ? "opacity-50 pointer-events-none" : ""}>
            <button
              onClick={() => void handleGenerateDesignPlan()}
              disabled={isPlanning || !uploadedImage}
              className="w-full py-2.5 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isPlanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {isPlanning ? "分析空間中..." : "AI 空間設計清單（看平面圖列項目）"}
            </button>
            {designPlan && (
              <div className="mt-2 space-y-2 max-h-72 overflow-y-auto">
                {designPlan.map((room, i) => (
                  <div key={i} className="rounded-lg border border-purple-100 bg-purple-50/50 p-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-800">{room.room}</p>
                      <button
                        onClick={() => { setSelectedRoomType(room.room); setDesignerPrompt([designerPrompt.trim(), `${room.room}：${room.items.join("、")}`].filter(Boolean).join("\n")); }}
                        className="text-[10px] text-purple-600 hover:text-purple-800 shrink-0"
                        title="帶入此空間到生成設定"
                      >
                        帶入生成 →
                      </button>
                    </div>
                    {room.purpose && <p className="text-[11px] text-gray-500 mt-0.5">{room.purpose}</p>}
                    {room.items.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {room.items.map((it, k) => (
                          <span key={k} className="text-[10px] bg-white border border-purple-200 text-purple-700 px-1.5 py-0.5 rounded">
                            {it}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
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


          {insufficientCreditsMsg && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <p className="font-semibold">{insufficientCreditsMsg}</p>
              <p className="mt-1 text-amber-600">請至「訂閱與點數」頁面儲值後再使用</p>
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
                <span className="font-bold text-brand-600">0.55 點</span>
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
                <span>第二步・確認格局</span>
                <span className="font-bold text-brand-600">4.4 點 (8 視角)</span>
              </div>
              <Button
                fullWidth
                onClick={handleStartSteps}
              >
                <span className="flex items-center gap-2">
                  <Wand2 className="w-4 h-4" />
                  確認，進入逐步生成
                </span>
              </Button>
              <button
                onClick={handleMultiReset}
                className="w-full mt-2 text-xs text-gray-400 hover:text-gray-600 py-1"
              >
                重新分析
              </button>
            </>
          ) : multiPhase === "steps" ? (
            <>
              <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                <span>
                  {multiViewResults.filter((r) => r.slotKey !== "labeled-floor-plan" && r.status === "done").length} / 8 完成
                </span>
                {isMultiGenerating && (
                  <span className="text-brand-600 font-medium animate-pulse text-[11px]">生成中...</span>
                )}
              </div>
              <Button
                fullWidth
                onClick={() => void handleGenerateAllRemaining()}
                disabled={isMultiGenerating}
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  一鍵生成剩餘
                </span>
              </Button>
              <button
                onClick={handleMultiReset}
                className="w-full mt-2 text-xs text-gray-400 hover:text-gray-600 py-1"
              >
                重新開始
              </button>
            </>
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

      <div className="flex-1 min-h-[200px] lg:min-h-0 bg-gray-900/5 rounded-xl border border-gray-200 flex flex-col overflow-hidden relative">
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
                  {multiPhase === "setup" && "上傳平面圖 → AI 標示空間 → 逐步生成"}
                  {multiPhase === "analyzing" && "AI 正在分析平面圖..."}
                  {multiPhase === "review" && "標示平面圖已完成，確認格局後進入逐步生成"}
                  {multiPhase === "steps" && (isMultiGenerating ? `生成中：${currentMultiSlot}` : "點擊各視角的「生成」按鈕，或一鍵生成剩餘")}
                  {multiPhase === "done" && "全部生成完成，已儲存至媒體庫"}
                </p>
              </div>
              {(multiPhase === "steps" || multiPhase === "done") && multiViewResults.length > 0 && (
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
                    <p className="text-xs text-gray-400 mt-1">生成標示版底圖，約需 40–90 秒，請耐心等待</p>
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

                  {/* 不滿意可修改提示詞重新分析 */}
                  <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
                    <p className="text-xs font-medium text-gray-700">若標示有誤，可補充修正提示詞後重新生成</p>
                    <textarea
                      value={analyzeCustomPrompt}
                      onChange={(e) => setAnalyzeCustomPrompt(e.target.value)}
                      placeholder="例：客廳標示的位置不對，左上角應該是主臥室而非書房..."
                      className="w-full text-xs border-gray-200 rounded-lg p-2 bg-white border h-16 resize-none"
                    />
                    <button
                      onClick={() => void handleAnalyzeFloorPlan()}
                      disabled={isAnalyzing}
                      className="w-full py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {isAnalyzing ? (
                        <><RefreshCw className="w-3 h-3 animate-spin" /> 重新分析中...</>
                      ) : (
                        <><RefreshCw className="w-3 h-3" /> 重新分析平面圖</>
                      )}
                    </button>
                  </div>

                  {/* 面積估算結果 */}
                  {isEstimatingArea && (
                    <div className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-2 text-xs text-gray-500">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-brand-600" />
                      AI 正在估算面積...
                    </div>
                  )}
                  {areaEstimation && (
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                      <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
                        <p className="text-sm font-semibold text-gray-800">AI 面積估算</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">基於平面圖比例推估，僅供參考</p>
                      </div>
                      <div className="p-3 space-y-3">
                        {/* 總面積 */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-brand-50 rounded-lg p-2.5 text-center">
                            <p className="text-lg font-bold text-brand-700">{areaEstimation.totalPing}</p>
                            <p className="text-[10px] text-brand-500">坪</p>
                          </div>
                          <div className="bg-brand-50 rounded-lg p-2.5 text-center">
                            <p className="text-lg font-bold text-brand-700">{areaEstimation.totalSqm}</p>
                            <p className="text-[10px] text-brand-500">平方公尺</p>
                          </div>
                        </div>
                        {/* 各空間 */}
                        <div>
                          <p className="text-[11px] font-medium text-gray-600 mb-1">各空間面積</p>
                          <div className="space-y-1">
                            {areaEstimation.spaces.map((s) => (
                              <div key={s.name} className="flex justify-between text-[11px] px-1">
                                <span className="text-gray-700">{s.name}</span>
                                <span className="text-gray-500">{s.sqm} m² ({s.ping} 坪)</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* 施工面積 */}
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="bg-gray-50 rounded-lg p-2">
                            <p className="text-sm font-bold text-gray-700">{areaEstimation.floorArea}</p>
                            <p className="text-[10px] text-gray-400">地板 m²</p>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-2">
                            <p className="text-sm font-bold text-gray-700">{areaEstimation.ceilingArea}</p>
                            <p className="text-[10px] text-gray-400">天花板 m²</p>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-2">
                            <p className="text-sm font-bold text-gray-700">{areaEstimation.wallArea}</p>
                            <p className="text-[10px] text-gray-400">牆面 m²</p>
                          </div>
                        </div>
                        {/* 門窗數量 */}
                        <div className="grid grid-cols-2 gap-2 text-center">
                          <div className="bg-gray-50 rounded-lg p-2">
                            <p className="text-sm font-bold text-gray-700">{areaEstimation.doors}</p>
                            <p className="text-[10px] text-gray-400">門</p>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-2">
                            <p className="text-sm font-bold text-gray-700">{areaEstimation.windows}</p>
                            <p className="text-[10px] text-gray-400">窗戶</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 面積標註按鈕 */}
                  {areaEstimation && labeledFloorPlan && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleOverlayArea(labeledFloorPlan)}
                        className="flex-1 py-2 bg-gray-800 text-white text-xs font-medium rounded-lg hover:bg-gray-900 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <ImageIcon className="w-3.5 h-3.5" /> 在標示圖上加入面積標註
                      </button>
                    </div>
                  )}

                  {/* 標註預覽 */}
                  {annotatedPreview && (
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                      <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">面積標註圖</span>
                        <div className="flex gap-1.5">
                          <button
                            onClick={handleDownloadAnnotated}
                            className="px-2 py-1 text-[11px] bg-brand-600 text-white rounded-md hover:bg-brand-700"
                          >
                            下載
                          </button>
                          <button
                            onClick={() => setAnnotatedPreview(null)}
                            className="px-2 py-1 text-[11px] text-gray-500 border border-gray-200 rounded-md hover:bg-gray-100"
                          >
                            關閉
                          </button>
                        </div>
                      </div>
                      <img src={annotatedPreview} alt="面積標註" className="w-full object-contain max-h-96" />
                    </div>
                  )}

                  <div className="bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 text-xs text-brand-700 space-y-1">
                    <p className="font-semibold">將生成 8 張（2 條串聯生成鏈）</p>
                    <p className="text-brand-600">彩色鏈：手繪 → 卡通 → 無陰影 → 擬真</p>
                    <p className="text-brand-600">剖透鏈：上視 → 俯視 → 斜角 → 立體模型</p>
                    <p className="text-[11px] text-brand-500 mt-1">每張圖以前一張為參考，確保傢具格局嚴格一致</p>
                  </div>
                </div>
              )}

              {/* 逐步生成 / 完成：顯示每個 slot 卡片 */}
              {(multiPhase === "steps" || multiPhase === "done") && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {multiViewResults.map((result, index) => {
                    const slotDef = FIXED_VIEW_SLOTS.find((s) => s.slotKey === result.slotKey);
                    const refDone = slotDef ? getCompletedImageDataUrl(slotDef.referenceSource) !== null : true;
                    const canGenerate = slotDef && refDone && result.status !== "generating" && result.status !== "done" && !isMultiGenerating;
                    const isExpanded = slotPromptExpanded[result.slotKey] || false;
                    return (
                      <div
                        key={result.slotKey}
                        className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm"
                      >
                        {/* 卡片標頭 */}
                        <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${result.status === "done" ? "bg-green-100 text-green-700" : "bg-brand-100 text-brand-700"}`}>
                              {result.status === "done" ? "✓" : index + 1}
                            </span>
                            <span className="text-sm font-medium text-gray-700 truncate">{result.label}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {result.status === "generating" && (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-brand-600" />
                            )}
                            {result.status === "done" && result.imageDataUrl && (
                              <>
                                <button
                                  onClick={() =>
                                    setEditingSlot({ slotKey: result.slotKey, imageDataUrl: result.imageDataUrl!, label: result.label })
                                  }
                                  className="p-1 hover:bg-brand-100 rounded text-gray-400 hover:text-brand-600 transition-colors"
                                  title="局部調整"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                {areaEstimation && (
                                  <button
                                    onClick={() => void handleOverlayArea(result.imageDataUrl!)}
                                    className="p-1 hover:bg-green-100 rounded text-gray-400 hover:text-green-600 transition-colors"
                                    title="面積標註"
                                  >
                                    <span className="text-[10px] font-bold leading-none">m²</span>
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    const link = document.createElement("a");
                                    link.href = result.imageDataUrl!;
                                    link.download = `${result.label}-${formatFileDate()}.png`;
                                    link.click();
                                  }}
                                  className="p-1 hover:bg-gray-200 rounded text-gray-500 hover:text-gray-700 transition-colors"
                                  title="下載"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* 圖片區 */}
                        <div className="aspect-[4/3] bg-gray-50 flex items-center justify-center relative overflow-hidden">
                          {result.status === "idle" && slotDef?.referenceExampleUrl && (
                            <div className="absolute inset-0">
                              <img src={slotDef.referenceExampleUrl} alt="參考案例" className="w-full h-full object-cover opacity-30" />
                              <div className="absolute inset-0 flex items-center justify-center">
                                <span className="bg-white/90 px-3 py-1.5 rounded-full text-[11px] font-medium text-gray-600 shadow-sm">
                                  {refDone ? "參考案例 — 點擊生成" : "等待前置視角完成"}
                                </span>
                              </div>
                            </div>
                          )}
                          {result.status === "idle" && !slotDef?.referenceExampleUrl && (
                            <p className="text-xs text-gray-400">{refDone ? "準備就緒" : "等待前置視角完成"}</p>
                          )}
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

                        {/* AI 設計說明 + 使用的提示詞 */}
                        {result.status === "done" && (result.summary || result.generationPrompt) && (
                          <div className="px-3 py-1.5 border-t border-gray-100 bg-gray-50/50 max-h-20 overflow-y-auto">
                            {result.summary && (
                              <p className="text-[10px] text-gray-600 leading-relaxed line-clamp-2">{result.summary}</p>
                            )}
                            {result.generationPrompt && (
                              <details className="mt-1">
                                <summary className="text-[10px] text-brand-500 cursor-pointer hover:text-brand-700">查看生成提示詞</summary>
                                <p className="text-[10px] text-gray-500 mt-1 whitespace-pre-wrap break-all leading-relaxed">{result.generationPrompt}</p>
                              </details>
                            )}
                          </div>
                        )}

                        {/* 標示平面圖卡片：重新分析 */}
                        {result.slotKey === "labeled-floor-plan" && result.status === "done" && (
                          <div className="px-3 py-2 border-t border-gray-100 space-y-2">
                            <button
                              onClick={() =>
                                setSlotPromptExpanded((prev) => ({ ...prev, "labeled-floor-plan": !isExpanded }))
                              }
                              className="text-[11px] text-gray-500 hover:text-brand-600 flex items-center gap-1"
                            >
                              ✏️ {isExpanded ? "收起" : "不滿意？修改提示詞重新分析"}
                            </button>
                            {isExpanded && (
                              <>
                                <textarea
                                  value={analyzeCustomPrompt}
                                  onChange={(e) => setAnalyzeCustomPrompt(e.target.value)}
                                  placeholder="例：左上角應標為主臥，浴室位置不對..."
                                  className="w-full text-xs border-gray-200 rounded-lg p-2 bg-white border h-16 resize-none"
                                />
                                <button
                                  onClick={() => void handleRegenerateAnalysis()}
                                  disabled={isAnalyzing || isMultiGenerating}
                                  className="w-full py-1.5 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                                >
                                  {isAnalyzing ? (
                                    <><RefreshCw className="w-3 h-3 animate-spin" /> 重新分析中...</>
                                  ) : (
                                    <><RefreshCw className="w-3 h-3" /> 重新分析（會重置所有下游）</>
                                  )}
                                </button>
                              </>
                            )}
                          </div>
                        )}

                        {/* 一般 slot：生成/重新生成 */}
                        {slotDef && (result.status === "idle" || result.status === "error" || result.status === "done") && (
                          <div className="px-3 py-2 border-t border-gray-100 space-y-2">
                            {result.status === "done" ? (
                              <button
                                onClick={() =>
                                  setSlotPromptExpanded((prev) => ({ ...prev, [result.slotKey]: !isExpanded }))
                                }
                                className="text-[11px] text-gray-500 hover:text-brand-600 flex items-center gap-1"
                              >
                                ✏️ {isExpanded ? "收起" : "不滿意？修改提示詞重新生成"}
                              </button>
                            ) : (
                              <button
                                onClick={() =>
                                  setSlotPromptExpanded((prev) => ({ ...prev, [result.slotKey]: !isExpanded }))
                                }
                                className="text-[11px] text-brand-600 hover:text-brand-700 flex items-center gap-1"
                              >
                                ✏️ {isExpanded ? "收起提示詞" : "調整提示詞（選填）"}
                              </button>
                            )}
                            {isExpanded && (
                              <textarea
                                value={slotCustomPrompts[result.slotKey] || ""}
                                onChange={(e) =>
                                  setSlotCustomPrompts((prev) => ({ ...prev, [result.slotKey]: e.target.value }))
                                }
                                placeholder="補充風格、材質、色調等調整指令..."
                                className="w-full text-xs border-gray-200 rounded-lg p-2 bg-white border h-16 resize-none"
                              />
                            )}
                            {result.status === "done" ? (
                              isExpanded && (
                                <button
                                  onClick={() => void handleRegenerateSingleSlot(slotDef)}
                                  disabled={isMultiGenerating}
                                  className="w-full py-1.5 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                                >
                                  <RefreshCw className="w-3 h-3" /> 重新生成{getDownstreamSlotKeys(slotDef.slotKey).length > 0 ? "（會重置下游）" : ""}
                                </button>
                              )
                            ) : (
                              <button
                                onClick={() => void handleGenerateSingleSlot(slotDef)}
                                disabled={!canGenerate}
                                className={`w-full py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                                  canGenerate
                                    ? "bg-brand-600 text-white hover:bg-brand-700"
                                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                                }`}
                              >
                                {result.status === "error" ? (
                                  <><RefreshCw className="w-3 h-3" /> 重新生成</>
                                ) : (
                                  <><Sparkles className="w-3 h-3" /> 生成</>
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* 局部調整編輯器 */}
      {editingSlot && (
        <SlotImageEditor
          imageDataUrl={editingSlot.imageDataUrl}
          slotLabel={editingSlot.label}
          onApply={handleApplySlotEdit}
          onClose={() => setEditingSlot(null)}
        />
      )}

      {/* 面積標註預覽 Modal（從 steps 階段 m² 按鈕觸發） */}
      {annotatedPreview && multiPhase === "steps" && (
        <div className="fixed inset-0 z-[110] bg-black/70 flex items-center justify-center p-4" onClick={() => setAnnotatedPreview(null)}>
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
              <p className="text-sm font-semibold text-gray-800">面積標註圖</p>
              <div className="flex gap-2">
                <button onClick={handleDownloadAnnotated} className="px-3 py-1.5 text-xs bg-brand-600 text-white rounded-lg hover:bg-brand-700">
                  下載標註圖
                </button>
                <button onClick={() => setAnnotatedPreview(null)} className="p-1.5 text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-4 bg-gray-100 flex items-center justify-center">
              <img src={annotatedPreview} alt="面積標註" className="max-w-full max-h-full rounded-lg shadow-lg" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
