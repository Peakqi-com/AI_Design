import React, { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Image as ImageIcon,
  Layers,
  Palette,
  Plus,
  Presentation,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { resolveClientUserScopeId } from "@/lib/client/user-scope";
import { useCredits } from "@/lib/client/use-credits";
import { SLIDE_THEMES, getTheme, buildGoogleFontsHref, resolveRichLayout } from "@/lib/presentation/themes";
import { SlideCanvas, SLIDE_W, SLIDE_H, type CanvasSlide } from "@/components/presentation/SlideCanvas";
import { rasterizeSlide, exportToPptx, exportToPdf, inlineStageImages, computeFontEmbedCSS } from "@/lib/presentation/export";

/* ================================================================
   Types
   ================================================================ */

type SlideLayout = "full-image" | "left-image" | "right-image" | "text-only" | "ai-full";

interface SlideData {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  layout: SlideLayout;
}

interface MediaAsset {
  id: string;
  kind: "image" | "video";
  url: string;
  createdAt: string;
  meta?: {
    origin?: string;
    summary?: string;
    style?: string;
    roomType?: string;
    packageId?: string;
    packageLabel?: string;
    slotLabel?: string;
    generationPrompt?: string;
  };
}

interface SourceProjectQuotationItem {
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
}
interface SourceProjectWorkflowTask {
  title: string;
  detail?: string;
  date?: string;
  time?: string;
  done?: boolean;
}
interface SourceProject {
  id: string;
  name: string;
  clientName: string;
  phase?: string;
  budget?: string;
  note?: string;
  quotationItems?: SourceProjectQuotationItem[];
  workflowTasks?: SourceProjectWorkflowTask[];
  linkedAssetIds?: string[];
}

interface PresentationDraftClient {
  id: string;
  title: string;
  designerName?: string;
  briefDesc?: string;
  linkedProjectId?: string;
  slides?: Array<{ id?: string; title?: string; body?: string; imageUrl?: string | null; layout?: string }>;
  styleId?: string;
  step?: number;
  updatedAt: string;
}

/* ================================================================
   Style Presets
   ================================================================ */

const STYLE_PRESETS = [
  { id: "bold-signal", label: "Bold Signal", category: "dark", bg: "1a1a2e", accent: "FF5722", text: "FFFFFF", subtext: "BBBBBB", contentBg: "FFFFFF", contentText: "1a1a2e", contentSub: "666666" },
  { id: "electric-studio", label: "Electric Studio", category: "dark", bg: "0D1B2A", accent: "4A90D9", text: "FFFFFF", subtext: "90CAF9", contentBg: "F5F7FA", contentText: "0D1B2A", contentSub: "546E7A" },
  { id: "creative-voltage", label: "Creative Voltage", category: "dark", bg: "0a0a0a", accent: "0066FF", text: "FFFFFF", subtext: "AAAAAA", contentBg: "F0F0F0", contentText: "0a0a0a", contentSub: "555555" },
  { id: "dark-botanical", label: "Dark Botanical", category: "dark", bg: "1C2321", accent: "C9B896", text: "FFFFFF", subtext: "E8B4B8", contentBg: "FBF9F6", contentText: "1C2321", contentSub: "6B5B4E" },
  { id: "notebook-tabs", label: "Notebook Tabs", category: "light", bg: "F8F6F1", accent: "7B8F6B", text: "2C2C2C", subtext: "888888", contentBg: "FFFFFF", contentText: "2C2C2C", contentSub: "777777" },
  { id: "pastel-geometry", label: "Pastel Geometry", category: "light", bg: "C8D9E6", accent: "5B7FA5", text: "1A1A2E", subtext: "555577", contentBg: "FFFFFF", contentText: "1A1A2E", contentSub: "666688" },
  { id: "split-pastel", label: "Split Pastel", category: "light", bg: "F5E6DC", accent: "B07D62", text: "2C1810", subtext: "7A5C4F", contentBg: "FEFCFA", contentText: "2C1810", contentSub: "8B7355" },
  { id: "vintage-editorial", label: "Vintage Editorial", category: "light", bg: "F5F3EE", accent: "8B4513", text: "2C2C2C", subtext: "777777", contentBg: "FAFAF8", contentText: "2C2C2C", contentSub: "888888" },
  { id: "neon-cyber", label: "Neon Cyber", category: "specialty", bg: "0A0F1C", accent: "00FFCC", text: "FFFFFF", subtext: "00FFCC", contentBg: "0F1628", contentText: "E0E0E0", contentSub: "00DDAA" },
  { id: "terminal-green", label: "Terminal Green", category: "specialty", bg: "0D1117", accent: "39D353", text: "C9D1D9", subtext: "39D353", contentBg: "161B22", contentText: "C9D1D9", contentSub: "39D353" },
  { id: "swiss-modern", label: "Swiss Modern", category: "specialty", bg: "FFFFFF", accent: "FF3300", text: "000000", subtext: "666666", contentBg: "FFFFFF", contentText: "000000", contentSub: "444444" },
  { id: "paper-ink", label: "Paper & Ink", category: "specialty", bg: "FAF9F7", accent: "C41E3A", text: "1A1A1A", subtext: "666666", contentBg: "FAF9F7", contentText: "1A1A1A", contentSub: "555555" },
] as const;

type StylePreset = (typeof STYLE_PRESETS)[number];

/* ================================================================
   Layout options
   ================================================================ */

const LAYOUT_OPTIONS: { value: SlideLayout; label: string }[] = [
  { value: "full-image", label: "全圖頁" },
  { value: "left-image", label: "左圖右文" },
  { value: "right-image", label: "右圖左文" },
  { value: "text-only", label: "純文字" },
];

// 預設交替版型：封面(text) → 全圖 → 左圖右文 → 右圖左文 → 左圖右文 → ... → 全圖 → 結尾(text)
const getDefaultLayout = (index: number, total: number): SlideLayout => {
  if (index === 0 || index === total - 1) return "text-only";
  if (index === 1 || index === total - 2) return "full-image";
  const cycle = ["left-image", "right-image"] as const;
  return cycle[(index - 2) % 2];
};

/* ================================================================
   Steps metadata
   ================================================================ */

const STEPS = [
  { num: 1, label: "大綱", icon: FileText },
  { num: 2, label: "配圖", icon: ImageIcon },
  { num: 3, label: "風格", icon: Palette },
  { num: 4, label: "下載", icon: Download },
] as const;

/* ================================================================
   Helpers
   ================================================================ */

const uid = () => Math.random().toString(36).slice(2, 10);

const fetchImageAsBase64 = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const idx = dataUrl.indexOf(",");
        resolve(idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

/* ================================================================
   Component
   ================================================================ */

interface PresentationMakerProps {
  initialProjectId?: string;
  /** When set, auto-restore this saved draft on mount (open an existing deck). */
  initialPresentationId?: string;
}

export const PresentationMaker: React.FC<PresentationMakerProps> = ({ initialProjectId, initialPresentationId }) => {
  const { data: session } = useSession();
  const credits = useCredits();

  /* ---- user scope ---- */
  const [userScopeId, setUserScopeId] = useState("guest_server");
  useEffect(() => {
    const u = session?.user as { id?: string; email?: string | null } | undefined;
    setUserScopeId(resolveClientUserScopeId(u?.id || null, u?.email || null));
  }, [session?.user]);

  /* ---- media assets ---- */
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);

  /* ---- NEW: beautiful HTML/CSS theme engine ---- */
  const [selectedThemeId, setSelectedThemeId] = useState<string>("nordic");
  const activeTheme = getTheme(selectedThemeId);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const exportStageRef = React.useRef<HTMLDivElement>(null);

  const loadAssets = useCallback(async () => {
    if (!userScopeId) return;
    setIsLoadingAssets(true);
    try {
      const res = await fetch(
        `/api/social/assets?userId=${encodeURIComponent(userScopeId)}&kind=image&limit=200`,
      );
      const data = (await res.json()) as { items?: MediaAsset[] };
      setAssets((data.items || []).filter((a) => a.kind === "image"));
    } catch {
      /* ignore */
    } finally {
      setIsLoadingAssets(false);
    }
  }, [userScopeId]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  /* ---- load Google Fonts for the active theme (preview + export) ---- */
  useEffect(() => {
    const href = buildGoogleFontsHref(activeTheme);
    const id = "deck-fonts";
    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = href;
  }, [activeTheme]);

  /* ---- load project list for the "從專案讀取" dropdown ---- */
  const loadProjectList = useCallback(async () => {
    if (!userScopeId) return;
    try {
      const res = await fetch(`/api/projects?userId=${encodeURIComponent(userScopeId)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { projects?: SourceProject[] };
      setProjectOptions(data.projects || []);
    } catch { /* ignore */ }
  }, [userScopeId]);

  useEffect(() => {
    void loadProjectList();
  }, [loadProjectList]);

  /* ---- apply a project's data into the outline form ---- */
  const applyProjectToForm = useCallback((project: SourceProject) => {
    setSourceProject(project);
    setLinkedProjectId(project.id);
    setProjectTitle(project.name || "");
    const lines: string[] = [];
    if (project.clientName) lines.push(`客戶：${project.clientName}`);
    if (project.phase) lines.push(`目前階段：${project.phase}`);
    if (project.budget) lines.push(`預算：${project.budget}`);
    if (project.note) lines.push(`需求重點：${project.note}`);
    if (project.quotationItems?.length) {
      lines.push(
        `報價項目：${project.quotationItems.map((i) => i.name).filter(Boolean).join("、")}`,
      );
    }
    if (project.workflowTasks?.length) {
      lines.push(
        `施工時程：${project.workflowTasks.map((t) => t.title).filter(Boolean).join("、")}`,
      );
    }
    setBriefDesc(lines.join("\n"));
  }, []);

  /* ---- fetch a single project by id and apply ---- */
  const loadProjectById = useCallback(async (projectId: string) => {
    if (!projectId) return;
    setLoadingProject(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { project?: SourceProject };
      if (data.project) applyProjectToForm(data.project);
    } catch { /* ignore */ } finally {
      setLoadingProject(false);
    }
  }, [applyProjectToForm]);

  /* ---- entry A: pre-fill from a project passed via prop ---- */
  const appliedInitialRef = React.useRef(false);
  useEffect(() => {
    if (initialProjectId && !appliedInitialRef.current) {
      appliedInitialRef.current = true;
      void loadProjectById(initialProjectId);
    }
  }, [initialProjectId, loadProjectById]);

  /* ---- wizard state ---- */
  const [step, setStep] = useState(1);

  /* step 1 */
  const [projectTitle, setProjectTitle] = useState("");
  const [designerName, setDesignerName] = useState("");
  const [briefDesc, setBriefDesc] = useState("");
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);

  /* step 1 — source project (從專案歸納) */
  const [projectOptions, setProjectOptions] = useState<SourceProject[]>([]);
  const [sourceProject, setSourceProject] = useState<SourceProject | null>(null);
  const [loadingProject, setLoadingProject] = useState(false);

  /* step 2 */
  const [imagePickerSlideId, setImagePickerSlideId] = useState<string | null>(null);
  const [isGeneratingAllImages, setIsGeneratingAllImages] = useState(false);
  const [imageGenProgress, setImageGenProgress] = useState<string>("");

  /* step 3 */
  const [selectedStyleId, setSelectedStyleId] = useState<string>("bold-signal");

  /* step 4 */
  const [isDownloading, setIsDownloading] = useState(false);

  /* ---- draft persistence ---- */
  const [presentationId, setPresentationId] = useState<string | null>(null);
  const [linkedProjectId, setLinkedProjectId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<
    Array<{ id: string; title: string; updatedAt: string; slideCount: number; linkedProjectId?: string }>
  >([]);
  const autosaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRestoringRef = React.useRef(false);

  const selectedStyle: StylePreset =
    STYLE_PRESETS.find((s) => s.id === selectedStyleId) || STYLE_PRESETS[0];

  const toCanvasSlide = useCallback(
    (slide: SlideData, index: number): CanvasSlide => ({
      id: slide.id,
      title: slide.title,
      body: slide.body,
      imageUrl: slide.imageUrl,
      layout: resolveRichLayout(slide.layout, index, slides.length, Boolean(slide.imageUrl), slide.title, slide.body),
    }),
    [slides.length],
  );

  /* ---- save (upsert) the current deck ---- */
  const persistDraft = useCallback(
    async (opts: { silent?: boolean } = {}): Promise<string | null> => {
      // Nothing meaningful to save yet
      if (slides.length === 0 && !projectTitle.trim()) return presentationId;
      if (!opts.silent) setSaveState("saving");
      else setSaveState("saving");
      try {
        const res = await fetch("/api/presentations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: presentationId || undefined,
            userId: userScopeId,
            title: projectTitle || "未命名簡報",
            designerName,
            briefDesc,
            linkedProjectId: linkedProjectId || undefined,
            slides,
            styleId: selectedStyleId,
            step,
          }),
        });
        if (!res.ok) throw new Error("save failed");
        const data = (await res.json()) as { presentation?: { id: string; updatedAt: string } };
        if (data.presentation) {
          if (!presentationId) setPresentationId(data.presentation.id);
          setLastSavedAt(data.presentation.updatedAt);
          setSaveState("saved");
          return data.presentation.id;
        }
        throw new Error("no presentation in response");
      } catch {
        setSaveState("error");
        return null;
      }
    },
    [presentationId, userScopeId, projectTitle, designerName, briefDesc, linkedProjectId, slides, selectedStyleId, step],
  );

  /* ---- debounced autosave whenever the deck changes ---- */
  useEffect(() => {
    if (isRestoringRef.current) return; // don't autosave while restoring a draft
    if (slides.length === 0) return; // nothing to save until a deck exists
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void persistDraft({ silent: true });
    }, 1500);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [slides, projectTitle, designerName, briefDesc, selectedStyleId, step, persistDraft]);

  /* ---- load the list of saved drafts (for the resume picker) ---- */
  const loadSavedDrafts = useCallback(async () => {
    if (!userScopeId) return;
    try {
      const res = await fetch(`/api/presentations?userId=${encodeURIComponent(userScopeId)}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        presentations?: Array<{ id: string; title: string; updatedAt: string; slides?: unknown[]; linkedProjectId?: string }>;
      };
      setSavedDrafts(
        (data.presentations || []).map((p) => ({
          id: p.id,
          title: p.title,
          updatedAt: p.updatedAt,
          slideCount: Array.isArray(p.slides) ? p.slides.length : 0,
          linkedProjectId: p.linkedProjectId,
        })),
      );
    } catch { /* ignore */ }
  }, [userScopeId]);

  useEffect(() => {
    void loadSavedDrafts();
  }, [loadSavedDrafts]);

  /* ---- restore a saved draft ---- */
  const restoreDraft = useCallback(async (id: string) => {
    isRestoringRef.current = true;
    try {
      const q = userScopeId ? `?userId=${encodeURIComponent(userScopeId)}` : "";
      const res = await fetch(`/api/presentations/${encodeURIComponent(id)}${q}`);
      if (!res.ok) return;
      const data = (await res.json()) as { presentation?: PresentationDraftClient };
      const p = data.presentation;
      if (!p) return;
      setPresentationId(p.id);
      setProjectTitle(p.title || "");
      setDesignerName(p.designerName || "");
      setBriefDesc(p.briefDesc || "");
      setLinkedProjectId(p.linkedProjectId || null);
      setSlides(
        (p.slides || []).map((s) => ({
          id: s.id || uid(),
          title: s.title || "",
          body: s.body || "",
          imageUrl: s.imageUrl ?? null,
          layout: (s.layout as SlideLayout) || "text-only",
        })),
      );
      if (p.styleId) setSelectedStyleId(p.styleId);
      setStep(p.step && p.step >= 1 && p.step <= 4 ? p.step : 1);
      setLastSavedAt(p.updatedAt);
      setSaveState("saved");
    } finally {
      // release the restore lock after state settles
      setTimeout(() => { isRestoringRef.current = false; }, 300);
    }
  }, [userScopeId]);

  /* ---- entry C: auto-open a specific saved draft (from project page) ---- */
  const appliedInitialDeckRef = React.useRef(false);
  useEffect(() => {
    if (initialPresentationId && !appliedInitialDeckRef.current) {
      appliedInitialDeckRef.current = true;
      void restoreDraft(initialPresentationId);
    }
  }, [initialPresentationId, restoreDraft]);

  /* ---- delete a saved draft ---- */
  const deleteDraft = useCallback(async (id: string) => {
    try {
      const q = userScopeId ? `?userId=${encodeURIComponent(userScopeId)}` : "";
      await fetch(`/api/presentations/${encodeURIComponent(id)}${q}`, { method: "DELETE" });
      setSavedDrafts((prev) => prev.filter((d) => d.id !== id));
      if (id === presentationId) {
        setPresentationId(null);
      }
    } catch { /* ignore */ }
  }, [presentationId, userScopeId]);

  /* ================================================================
     Step 1 - AI outline generation
     ================================================================ */

  /** Core outline generator — returns slide array, callers handle state. */
  const requestOutlineSlides = async (
    layoutFn: (i: number, total: number) => SlideLayout = getDefaultLayout,
  ): Promise<SlideData[]> => {
    // When a source project is loaded, feed the AI the full structured data
    // so the deck is summarised FROM the project, not generic filler.
    let projectBlock = "";
    if (sourceProject) {
      const q = sourceProject.quotationItems || [];
      const w = sourceProject.workflowTasks || [];
      const quoteLines = q
        .map((i) => `  - ${i.name}${i.description ? `（${i.description}）` : ""} × ${i.quantity}，單價 ${i.unitPrice}`)
        .join("\n");
      const taskLines = w
        .map((t) => `  - ${t.title}${t.date ? `（${t.date}${t.time ? " " + t.time : ""}）` : ""}`)
        .join("\n");
      const total = q.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
      projectBlock =
        `\n【專案資料（請據此歸納，不要憑空捏造）】\n` +
        `客戶：${sourceProject.clientName || "（未填）"}\n` +
        `階段：${sourceProject.phase || "（未填）"}\n` +
        `預算：${sourceProject.budget || "（未填）"}\n` +
        `需求備註：${sourceProject.note || "（無）"}\n` +
        (quoteLines ? `報價項目：\n${quoteLines}\n報價總額（估）：${total.toLocaleString()}\n` : "") +
        (taskLines ? `施工/工作時程：\n${taskLines}\n` : "");
    }

    const prompt =
      `你是室內設計公司的簡報顧問。請根據以下資訊，為一份設計提案簡報生成投影片大綱。\n\n` +
      `專案名稱：${projectTitle || "室內設計方案"}\n` +
      `設計師：${designerName || "設計師"}\n` +
      (briefDesc ? `說明：${briefDesc}\n` : "") +
      projectBlock +
      `\n請輸出 JSON 格式的投影片陣列，每張投影片包含 title 和 body（繁體中文），格式：\n` +
      `[{"title":"封面","body":"..."},{"title":"設計概述","body":"..."},...]` +
      `\n規則：(1) 第一頁為封面（含專案名稱與設計師名稱）(2) 最後一頁為結語/聯繫方式 ` +
      (sourceProject
        ? `(3) 中間頁面要涵蓋：設計理念、空間規劃（依需求備註逐空間說明）、材質配色，` +
          `並且【若有報價項目就獨立一頁「投資預算」條列項目與總額】、【若有施工時程就獨立一頁「執行時程」條列階段】 `
        : `(3) 中間安排 4-6 頁內容（設計理念、風格定位、空間規劃、材質配色、預算說明等）`) +
      `(4) 使用專業室內設計用語 (5) 只輸出 JSON 陣列，不要其他文字。`;

    try {
      const res = await fetch("/api/ai/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, temperature: 0.5, jsonMode: true }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "生成失敗");

      const text = (data.text || "").trim();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      let parsed: Array<{ title?: string; body?: string }> = [];
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
      }
      if (parsed.length > 0) {
        return parsed.map((s, i) => ({
          id: uid(),
          title: s.title || "",
          body: s.body || "",
          imageUrl: null,
          layout: layoutFn(i, parsed.length),
        }));
      }
    } catch { /* fall through to fallback */ }

    const fallback = [
      { title: projectTitle || "室內設計提案", body: `設計師：${designerName || "設計師"}\n日期：${new Date().toLocaleDateString("zh-TW")}` },
      { title: "設計概述", body: "整體設計理念與風格定位" },
      { title: "空間規劃", body: "各空間的機能配置與動線安排" },
      { title: "材質與配色", body: "主要材質選擇與色彩搭配方案" },
      { title: "感謝觀看", body: "期待與您合作\n如有任何問題歡迎聯繫" },
    ];
    return fallback.map((s, i) => ({ id: uid(), ...s, imageUrl: null, layout: layoutFn(i, fallback.length) }));
  };

  const handleGenerateOutline = async () => {
    const baseSlides = 6;
    const baseDeduct = await credits.confirmAndDeduct("AI 生成簡報大綱", "ai-text", baseSlides);
    if (!baseDeduct.ok) return;
    setIsGeneratingOutline(true);
    try {
      const newSlides = await requestOutlineSlides();
      if (newSlides.length > baseSlides) {
        await credits.tryDeduct("ai-text", newSlides.length - baseSlides).catch(() => {});
      }
      setSlides(newSlides);
    } finally {
      setIsGeneratingOutline(false);
    }
  };

  /**
   * Nano Banana 一鍵模式：先生大綱，然後每張用 Gemini text-to-image 產整頁海報圖
   * (含標題、內文、設計排版)。產出後跳到下載步驟。
   */
  const [isNanoBananaMode, setIsNanoBananaMode] = useState(false);
  const [nanoBananaProgress, setNanoBananaProgress] = useState<string>("");

  const handleNanoBananaGenerate = async () => {
    if (!projectTitle.trim()) {
      alert("請先輸入專案名稱");
      return;
    }

    // Step 1: 先 confirm 大綱費用（典型 6 張）
    const outlineDeduct = await credits.confirmAndDeduct(
      "Step 1/2：AI 生成簡報大綱（≈6 張）",
      "ai-text",
      6,
    );
    if (!outlineDeduct.ok) return;

    setIsNanoBananaMode(true);
    setIsGeneratingOutline(true);
    setNanoBananaProgress("生成大綱中...");
    let workingSlides: SlideData[] = [];
    try {
      workingSlides = await requestOutlineSlides(() => "ai-full");
      // 大綱比預期多時補扣
      if (workingSlides.length > 6) {
        await credits.tryDeduct("ai-text", workingSlides.length - 6).catch(() => {});
      }
      setSlides(workingSlides);
    } finally {
      setIsGeneratingOutline(false);
    }

    if (workingSlides.length === 0) {
      setIsNanoBananaMode(false);
      setNanoBananaProgress("");
      return;
    }

    // Step 2: confirm 每頁海報圖費用
    const imgDeduct = await credits.confirmAndDeduct(
      `Step 2/2：Nano Banana 生成 ${workingSlides.length} 頁整頁海報式投影片`,
      "ai-render",
      workingSlides.length,
    );
    if (!imgDeduct.ok) {
      setIsNanoBananaMode(false);
      setNanoBananaProgress("");
      return;
    }

    // 逐頁生成
    try {
      for (let i = 0; i < workingSlides.length; i++) {
        const slide = workingSlides[i];
        setNanoBananaProgress(`Nano Banana 生成中 ${i + 1}/${workingSlides.length}：${slide.title}`);
        try {
          const res = await fetch("/api/ai/presentation/page-generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: slide.title,
              body: slide.body,
              projectTitle,
              designerName,
              pageIndex: i,
              totalPages: workingSlides.length,
              styleLabel: selectedStyle.label,
              isFirst: i === 0,
              isLast: i === workingSlides.length - 1,
            }),
          });
          const data = (await res.json()) as { imageDataUrl?: string; error?: string };
          if (res.ok && data.imageDataUrl) {
            updateSlide(slide.id, { imageUrl: data.imageDataUrl, layout: "ai-full" });
          }
        } catch { /* skip this page on error */ }
      }
    } finally {
      setNanoBananaProgress("");
      setIsNanoBananaMode(false);
      setStep(4);
    }
  };

  /* ================================================================
     AI 一鍵生成所有缺圖配圖（每張扣 0.55 點）
     ================================================================ */

  const handleGenerateAllImages = async () => {
    const slidesToFill = slides.filter((s) => !s.imageUrl);
    if (slidesToFill.length === 0) {
      alert("所有投影片都已有配圖");
      return;
    }
    if (assets.length === 0) {
      alert("請先在媒體庫加入至少一張參考圖，AI 才能據此風格生成配圖");
      return;
    }
    const confirmed = window.confirm(
      `將為 ${slidesToFill.length} 張缺圖投影片 AI 生成配圖，預計扣 ${(slidesToFill.length * 0.55).toFixed(2)} 點。繼續？`,
    );
    if (!confirmed) return;

    setIsGeneratingAllImages(true);
    let done = 0;
    try {
      for (let i = 0; i < slidesToFill.length; i++) {
        const slide = slidesToFill[i];
        setImageGenProgress(`生成中 ${i + 1} / ${slidesToFill.length}：${slide.title}`);

        // 每張前扣 0.55 點
        const deduction = await credits.tryDeduct("ai-render");
        if (!deduction.ok) {
          break;
        }

        // 用素材庫的圖循環當風格參考
        const refAsset = assets[i % assets.length];
        const refBase64 = await fetchImageAsBase64(refAsset.url);
        if (!refBase64) continue;

        try {
          const res = await fetch("/api/ai/social/image/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageDataUrl: `data:image/jpeg;base64,${refBase64}`,
              prompt: `為室內設計簡報投影片生成配圖。投影片標題：${slide.title}。內容：${slide.body}。風格參考上傳的圖片。專業攝影風格，高質感。`,
              style: "interior-design",
            }),
          });
          const data = (await res.json()) as { imageDataUrl?: string; error?: string };
          if (res.ok && data.imageDataUrl) {
            updateSlide(slide.id, { imageUrl: data.imageDataUrl });
            done++;
          }
        } catch {
          /* skip this slide on error */
        }
      }
    } finally {
      setIsGeneratingAllImages(false);
      setImageGenProgress("");
      if (done > 0) {
        alert(`完成：成功生成 ${done} 張配圖`);
      }
    }
  };

  /* ================================================================
     Slide CRUD
     ================================================================ */

  const updateSlide = (id: string, patch: Partial<SlideData>) => {
    setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const removeSlide = (id: string) => {
    setSlides((prev) => prev.filter((s) => s.id !== id));
  };

  const addSlide = () => {
    setSlides((prev) => [
      ...prev,
      { id: uid(), title: "新投影片", body: "", imageUrl: null, layout: "left-image" },
    ]);
  };

  const moveSlide = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= slides.length) return;
    setSlides((prev) => {
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  /* ================================================================
     Step 4 - PPT Download
     ================================================================ */

  /* ---- rich export: rasterize SlideCanvas nodes → PPTX / PDF ---- */
  const handleRichExport = async (format: "pptx" | "pdf") => {
    if (slides.length === 0 || !exportStageRef.current) return;
    setIsExporting(true);
    setExportProgress("準備字體與圖片...");
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 300));

      const stage = exportStageRef.current;
      // 1) Inline all images to same-origin data URLs (avoids CORS hangs)
      setExportProgress("載入圖片...");
      await inlineStageImages(stage);

      const nodes = Array.from(stage.querySelectorAll<HTMLElement>("[data-export-slide]"));
      // 2) Compute font-embed CSS ONCE (huge speedup vs per-slide)
      setExportProgress("內嵌字體...");
      const fontCSS = nodes[0] ? await computeFontEmbedCSS(nodes[0]) : "";

      // 3) Rasterize each slide
      const pngs: string[] = [];
      for (let i = 0; i < nodes.length; i++) {
        setExportProgress(`渲染第 ${i + 1} / ${nodes.length} 頁...`);
        pngs.push(await rasterizeSlide(nodes[i], fontCSS));
      }
      const dateStr = new Date().toLocaleDateString("zh-TW").replace(/\//g, "");
      const fileName = `${projectTitle || "設計簡報"}_${dateStr}.${format}`;
      setExportProgress("封裝檔案...");
      if (format === "pptx") await exportToPptx(pngs, fileName);
      else await exportToPdf(pngs, fileName);
    } catch (err) {
      console.error("rich export error:", err);
      alert("匯出失敗，請重試");
    } finally {
      setIsExporting(false);
      setExportProgress("");
    }
  };

  const handleDownloadPptx = async () => {
    if (slides.length === 0) return;
    setIsDownloading(true);

    try {
      const PptxGenJS = (await import("pptxgenjs")).default;
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";
      pptx.author = designerName || "Interior Pro";
      pptx.title = projectTitle || "室內設計簡報";

      const cs = selectedStyle;
      const font = "Microsoft JhengHei";

      for (let idx = 0; idx < slides.length; idx++) {
        const slide = slides[idx];
        const isFirst = idx === 0;
        const isLast = idx === slides.length - 1;
        const s = pptx.addSlide();

        /* ---- Nano Banana 模式：AI 純背景圖 + 程式文字 overlay ---- */
        if (slide.layout === "ai-full" && slide.imageUrl) {
          const aiBase64 = await fetchImageAsBase64(slide.imageUrl);
          if (aiBase64) {
            // 1) 鋪滿背景圖
            s.addImage({
              data: `image/jpeg;base64,${aiBase64}`,
              x: 0, y: 0, w: 13.33, h: 7.5,
              sizing: { type: "cover", w: 13.33, h: 7.5 },
            });

            if (isFirst || isLast) {
              // 封面/結尾：中央大字 + 半透明深色遮罩
              s.addShape(pptx.ShapeType.rect, {
                x: 0, y: 2.4, w: 13.33, h: 2.7,
                fill: { color: "000000", transparency: 50 },
                line: { color: "000000", transparency: 100 },
              });
              s.addText(slide.title, {
                x: 0.5, y: 2.7, w: 12.33, h: 1.4,
                fontSize: 44, bold: true, color: "FFFFFF",
                fontFace: font, align: "center", lineSpacingMultiple: 1.2,
              });
              s.addText(slide.body, {
                x: 0.8, y: 4.1, w: 11.73, h: 1.0,
                fontSize: 18, color: "FFFFFF",
                fontFace: font, align: "center", lineSpacingMultiple: 1.4,
              });
              s.addText(new Date().toLocaleDateString("zh-TW"), {
                x: 0.5, y: 6.9, w: 12.33, h: 0.4,
                fontSize: 11, color: "FFFFFF", fontFace: font, align: "center",
              });
            } else {
              // 內容頁：上方標題條 + 下方內文條
              // 上方標題遮罩
              s.addShape(pptx.ShapeType.rect, {
                x: 0, y: 0, w: 13.33, h: 1.4,
                fill: { color: "000000", transparency: 55 },
                line: { color: "000000", transparency: 100 },
              });
              s.addText(slide.title, {
                x: 0.6, y: 0.35, w: 12.13, h: 0.7,
                fontSize: 28, bold: true, color: "FFFFFF",
                fontFace: font, valign: "middle",
              });

              // 下方內文遮罩
              s.addShape(pptx.ShapeType.rect, {
                x: 0, y: 5.2, w: 13.33, h: 2.3,
                fill: { color: "000000", transparency: 55 },
                line: { color: "000000", transparency: 100 },
              });
              s.addText(slide.body, {
                x: 0.8, y: 5.45, w: 11.73, h: 1.8,
                fontSize: 16, color: "FFFFFF",
                fontFace: font, valign: "top", lineSpacingMultiple: 1.5,
              });

              // 右下頁碼
              s.addText(`${idx + 1} / ${slides.length}`, {
                x: 10.83, y: 7.05, w: 2, h: 0.35,
                fontSize: 10, color: "FFFFFF", fontFace: font, align: "right",
              });
            }
            continue;
          }
        }

        /* ---- cover slide ---- */
        if (isFirst) {
          s.background = { color: cs.bg };
          s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.06, fill: { color: cs.accent } });
          s.addShape(pptx.ShapeType.rect, { x: 0, y: 7.44, w: 13.33, h: 0.06, fill: { color: cs.accent } });
          s.addText(slide.title || projectTitle || "室內設計提案", {
            x: 1, y: 2, w: 11.33, h: 1.5, fontSize: 40, bold: true,
            color: cs.text, fontFace: font, align: "center", lineSpacingMultiple: 1.2,
          });
          s.addShape(pptx.ShapeType.rect, { x: 5.5, y: 3.7, w: 2.33, h: 0.04, fill: { color: cs.accent } });
          s.addText(slide.body || `設計師：${designerName}`, {
            x: 1, y: 4, w: 11.33, h: 1.2, fontSize: 20,
            color: cs.subtext, fontFace: font, align: "center", lineSpacingMultiple: 1.5,
          });
          s.addText(new Date().toLocaleDateString("zh-TW"), {
            x: 1, y: 6.2, w: 11.33, h: 0.5, fontSize: 12,
            color: cs.subtext, fontFace: font, align: "center",
          });
          continue;
        }

        /* ---- ending slide ---- */
        if (isLast) {
          s.background = { color: cs.bg };
          s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.06, fill: { color: cs.accent } });
          s.addShape(pptx.ShapeType.rect, { x: 0, y: 7.44, w: 13.33, h: 0.06, fill: { color: cs.accent } });
          s.addText(slide.title || "感謝觀看", {
            x: 1, y: 2.5, w: 11.33, h: 1.2, fontSize: 36, bold: true,
            color: cs.text, fontFace: font, align: "center",
          });
          s.addShape(pptx.ShapeType.rect, { x: 5.5, y: 3.9, w: 2.33, h: 0.04, fill: { color: cs.accent } });
          s.addText(slide.body || "期待與您合作", {
            x: 1, y: 4.2, w: 11.33, h: 2, fontSize: 18,
            color: cs.subtext, fontFace: font, align: "center", lineSpacingMultiple: 1.6,
          });
          continue;
        }

        /* ---- content slides by layout ---- */
        const layout = slide.layout;
        const hasImage = !!slide.imageUrl;
        let base64: string | null = null;
        if (hasImage) {
          base64 = await fetchImageAsBase64(slide.imageUrl!);
        }

        if (layout === "full-image" && base64) {
          /* full-image: image fills slide, title overlay at bottom */
          s.addImage({
            data: `image/jpeg;base64,${base64}`,
            x: 0, y: 0, w: 13.33, h: 7.5,
            sizing: { type: "cover", w: 13.33, h: 7.5 },
          });
          // dark gradient overlay at bottom
          s.addShape(pptx.ShapeType.rect, {
            x: 0, y: 5.0, w: 13.33, h: 2.5,
            fill: { color: "000000", transparency: 40 },
          });
          s.addText(slide.title, {
            x: 0.8, y: 5.3, w: 11.73, h: 0.8, fontSize: 24, bold: true,
            color: "FFFFFF", fontFace: font,
          });
          s.addText(slide.body, {
            x: 0.8, y: 6.1, w: 11.73, h: 1.0, fontSize: 16,
            color: "DDDDDD", fontFace: font, lineSpacingMultiple: 1.4,
          });
        } else if (layout === "left-image" && base64) {
          /* left-image: image left half, text right */
          s.background = { color: cs.contentBg };
          s.addImage({
            data: `image/jpeg;base64,${base64}`,
            x: 0, y: 0, w: 6.5, h: 7.5,
            sizing: { type: "contain", w: 6.5, h: 7.5 },
          });
          s.addShape(pptx.ShapeType.rect, { x: 6.5, y: 0, w: 0.06, h: 7.5, fill: { color: cs.accent } });
          s.addText(slide.title, {
            x: 7.0, y: 1.0, w: 5.8, h: 1.0, fontSize: 22, bold: true,
            color: cs.contentText, fontFace: font,
          });
          s.addShape(pptx.ShapeType.rect, { x: 7.0, y: 2.1, w: 1.5, h: 0.04, fill: { color: cs.accent } });
          s.addText(slide.body, {
            x: 7.0, y: 2.5, w: 5.8, h: 4.0, fontSize: 16,
            color: cs.contentSub, fontFace: font, valign: "top", lineSpacingMultiple: 1.5,
          });
        } else if (layout === "right-image" && base64) {
          /* right-image: text left, image right (default) */
          s.background = { color: cs.contentBg };
          s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.08, h: 7.5, fill: { color: cs.accent } });
          s.addText(slide.title, {
            x: 0.6, y: 0.6, w: 4.6, h: 0.8, fontSize: 22, bold: true,
            color: cs.contentText, fontFace: font,
          });
          s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.5, w: 1.5, h: 0.04, fill: { color: cs.accent } });
          s.addText(slide.body, {
            x: 0.6, y: 1.8, w: 4.6, h: 4, fontSize: 16,
            color: cs.contentSub, fontFace: font, valign: "top", lineSpacingMultiple: 1.5,
          });
          s.addShape(pptx.ShapeType.rect, { x: 5.65, y: 0.55, w: 7.2, h: 5.5, fill: { color: "E0E0E0" }, rectRadius: 0.08 });
          s.addImage({
            data: `image/jpeg;base64,${base64}`,
            x: 5.6, y: 0.5, w: 7.2, h: 5.5,
            sizing: { type: "contain", w: 7.2, h: 5.5 },
            rounding: true,
          });
        } else {
          /* text-only (or no image available) */
          s.background = { color: cs.contentBg };
          s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.08, h: 7.5, fill: { color: cs.accent } });
          s.addText(slide.title, {
            x: 1, y: 1.5, w: 11, h: 1, fontSize: 28, bold: true,
            color: cs.contentText, fontFace: font, align: "center",
          });
          s.addShape(pptx.ShapeType.rect, { x: 5.5, y: 2.7, w: 2.33, h: 0.04, fill: { color: cs.accent } });
          s.addText(slide.body, {
            x: 1.5, y: 3, w: 10, h: 3.5, fontSize: 16,
            color: cs.contentSub, fontFace: font, align: "center", lineSpacingMultiple: 1.6,
          });
        }

        // slide number
        s.addText(`${idx + 1} / ${slides.length}`, {
          x: 0.6, y: 6.8, w: 2, h: 0.4, fontSize: 9,
          color: "BBBBBB", fontFace: font,
        });
      }

      const fileName = `${projectTitle || "設計簡報"}_${new Date().toLocaleDateString("zh-TW").replace(/\//g, "")}.pptx`;
      await pptx.writeFile({ fileName });
    } catch (err) {
      console.error("PPT download error:", err);
    } finally {
      setIsDownloading(false);
    }
  };

  /* ================================================================
     Render helpers
     ================================================================ */

  const canProceed = (s: number): boolean => {
    if (s === 1) return slides.length > 0;
    if (s === 2) return slides.length > 0;
    if (s === 3) return slides.length > 0;
    return false;
  };

  /* ================================================================
     Render: Step indicator
     ================================================================ */

  const renderStepIndicator = () => (
    <div className="flex items-center gap-1 px-4 py-3 border-b border-gray-100 bg-gray-50/50">
      {STEPS.map((st, i) => {
        const done = step > st.num;
        const active = step === st.num;
        const Icon = st.icon;
        return (
          <React.Fragment key={st.num}>
            {i > 0 && (
              <div className={`flex-1 h-px mx-1 ${done ? "bg-brand-400" : "bg-gray-200"}`} />
            )}
            <button
              onClick={() => {
                if (done || active) setStep(st.num);
              }}
              disabled={!done && !active}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 ${
                active
                  ? "bg-brand-100 text-brand-700"
                  : done
                    ? "text-brand-500 hover:bg-brand-50 cursor-pointer"
                    : "text-gray-400 cursor-default"
              }`}
            >
              {done ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <Icon className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">{st.label}</span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );

  /* ================================================================
     Render: Step 1 - Outline
     ================================================================ */

  const renderStep1Left = () => (
    <div className="space-y-4">
      {/* 草稿續編 */}
      {savedDrafts.length > 0 && (
        <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/60">
          <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
            <Save className="w-3.5 h-3.5" /> 已儲存的簡報草稿（{savedDrafts.length}）
          </p>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {savedDrafts.map((d) => (
              <div
                key={d.id}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 bg-white ${
                  d.id === presentationId ? "border-brand-400 ring-1 ring-brand-200" : "border-gray-200"
                }`}
              >
                <button
                  onClick={() => void restoreDraft(d.id)}
                  className="flex-1 min-w-0 text-left"
                  title="繼續編輯"
                >
                  <p className="text-xs font-medium text-gray-800 truncate">{d.title || "未命名簡報"}</p>
                  <p className="text-[10px] text-gray-400">
                    {d.slideCount} 頁 · {new Date(d.updatedAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {d.id === presentationId ? " · 編輯中" : ""}
                  </p>
                </button>
                <button
                  onClick={() => void deleteDraft(d.id)}
                  className="text-gray-300 hover:text-red-500 shrink-0 p-1"
                  title="刪除草稿"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 從專案歸納 */}
      <div className="bg-gradient-to-br from-brand-50 to-purple-50 border border-brand-100 rounded-lg p-3">
        <label className="block text-xs font-semibold text-brand-700 mb-1.5 flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5" /> 從室內專案自動帶入內容
        </label>
        <div className="flex gap-2">
          <select
            value={sourceProject?.id || ""}
            onChange={(e) => {
              const id = e.target.value;
              if (id) void loadProjectById(id);
              else { setSourceProject(null); }
            }}
            disabled={loadingProject}
            className="flex-1 text-sm border-gray-300 rounded-lg p-2 bg-white border"
          >
            <option value="">選擇專案（自動填入名稱、需求、報價、時程）</option>
            {projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.clientName ? `（${p.clientName}）` : ""}
              </option>
            ))}
          </select>
          {loadingProject && <RefreshCw className="w-4 h-4 animate-spin text-brand-600 self-center" />}
        </div>
        {sourceProject && (
          <p className="text-[10px] text-brand-600 mt-1.5">
            ✓ 已帶入「{sourceProject.name}」的資料 · {sourceProject.quotationItems?.length || 0} 報價項 · {sourceProject.workflowTasks?.length || 0} 時程 · 按下方生成大綱即會據此歸納
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">專案名稱</label>
        <input
          value={projectTitle}
          onChange={(e) => setProjectTitle(e.target.value)}
          placeholder="例：王先生三房兩廳翻新案"
          className="w-full text-sm border-gray-300 rounded-lg p-2.5 bg-white border"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">設計師姓名</label>
        <input
          value={designerName}
          onChange={(e) => setDesignerName(e.target.value)}
          placeholder="例：陳設計師"
          className="w-full text-sm border-gray-300 rounded-lg p-2.5 bg-white border"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">簡要說明</label>
        <textarea
          value={briefDesc}
          onChange={(e) => setBriefDesc(e.target.value)}
          placeholder="描述專案需求、風格方向、預算重點等..."
          className="w-full text-sm border-gray-300 rounded-lg p-2.5 bg-white border h-24 resize-none"
        />
      </div>
      <button
        onClick={() => void handleNanoBananaGenerate()}
        disabled={isGeneratingOutline || isNanoBananaMode}
        className="w-full py-3 bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-600 text-white rounded-lg text-sm font-semibold hover:from-amber-600 hover:to-amber-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
      >
        {isNanoBananaMode ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-xs">{nanoBananaProgress || "生成中..."}</span>
          </>
        ) : (
          <>
            <span className="text-base">🍌</span>
            <span>Nano Banana 一鍵完整生成</span>
          </>
        )}
      </button>
      <p className="text-[10px] text-gray-400 text-center -mt-2">
        AI 一次產出大綱 + 每頁整頁海報式設計（含文字排版）
      </p>

      <div className="flex items-center gap-2 my-1">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="text-[10px] text-gray-400">或經典模式</span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>

      <button
        onClick={() => void handleGenerateOutline()}
        disabled={isGeneratingOutline || isNanoBananaMode}
        className="w-full py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isGeneratingOutline && !isNanoBananaMode ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" /> 生成中...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" /> 僅生成大綱（手動配圖）
          </>
        )}
      </button>

      {slides.length > 0 && (
        <div className="pt-2 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500">投影片列表 ({slides.length})</p>
            <button
              onClick={addSlide}
              className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> 新增
            </button>
          </div>
          {slides.map((slide, i) => (
            <div key={slide.id} className="bg-gray-50 rounded-lg p-2.5 border border-gray-200 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-400 w-5 text-center shrink-0">
                  {i + 1}
                </span>
                <input
                  value={slide.title}
                  onChange={(e) => updateSlide(slide.id, { title: e.target.value })}
                  className="flex-1 text-sm font-semibold bg-white border border-gray-200 rounded px-2 py-1"
                />
                <div className="flex gap-0.5 shrink-0">
                  <button
                    onClick={() => moveSlide(i, -1)}
                    disabled={i === 0}
                    className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => moveSlide(i, 1)}
                    disabled={i === slides.length - 1}
                    className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  >
                    <ChevronRight className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => removeSlide(slide.id)}
                    className="p-1 text-gray-400 hover:text-red-500"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <textarea
                value={slide.body}
                onChange={(e) => updateSlide(slide.id, { body: e.target.value })}
                className="w-full text-xs bg-white border border-gray-200 rounded px-2 py-1.5 resize-none h-14"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderStep1Right = () => (
    <div className="flex flex-col items-center justify-center h-full text-gray-400">
      {slides.length === 0 ? (
        <>
          <Presentation className="w-16 h-16 opacity-20 mb-3" />
          <p className="text-sm font-medium">輸入資訊後點擊「AI 生成大綱」</p>
          <p className="text-xs mt-1 text-gray-300">大綱產生後可在此預覽</p>
        </>
      ) : (
        <div className="w-full h-full overflow-y-auto p-4 space-y-3">
          {slides.map((slide, i) => (
            <div
              key={slide.id}
              className="rounded-xl border border-gray-200 bg-white shadow-sm p-4"
            >
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-7 h-7 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{slide.title}</p>
                  <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{slide.body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  /* ================================================================
     Render: Step 2 - Image selection
     ================================================================ */

  const renderStep2Left = () => {
    const missingCount = slides.filter((s) => !s.imageUrl).length;
    return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        為每張投影片選擇配圖。點擊圖片區域即可從素材庫挑選。
      </p>
      {missingCount > 0 && (
        <button
          onClick={() => void handleGenerateAllImages()}
          disabled={isGeneratingAllImages || assets.length === 0}
          className="w-full py-2 bg-gradient-to-r from-brand-500 to-brand-600 text-white rounded-lg text-xs font-medium hover:from-brand-600 hover:to-brand-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          title={assets.length === 0 ? "請先在媒體庫加入參考圖" : ""}
        >
          {isGeneratingAllImages ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>{imageGenProgress || "生成中..."}</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI 一鍵生成所有缺圖（{missingCount} 張，共扣 {(missingCount * 0.55).toFixed(2)} 點）</span>
            </>
          )}
        </button>
      )}
      {slides.map((slide, i) => (
        <div key={slide.id} className="bg-gray-50 rounded-lg p-2.5 border border-gray-200">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold text-gray-400 w-5 text-center">{i + 1}</span>
            <p className="text-sm font-semibold text-gray-700 truncate flex-1">{slide.title}</p>
          </div>
          <div className="flex gap-2">
            {slide.imageUrl ? (
              <div className="relative w-20 h-14 rounded-lg overflow-hidden border border-gray-200 shrink-0">
                <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" />
                <button
                  onClick={() => updateSlide(slide.id, { imageUrl: null })}
                  className="absolute top-0.5 right-0.5 bg-black/50 rounded-full p-0.5 text-white hover:bg-red-500"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setImagePickerSlideId(slide.id)}
                className="w-20 h-14 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-brand-400 hover:text-brand-500 transition-colors shrink-0"
              >
                <ImageIcon className="w-4 h-4" />
              </button>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-gray-500 truncate">{slide.body}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
    );
  };

  const renderStep2Right = () => {
    if (!imagePickerSlideId) {
      return (
        <div className="h-full flex flex-col">
          <div className="p-4 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-700">配圖預覽</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              點擊左側投影片的圖片區域以選擇配圖
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {slides.map((slide, i) => (
              <div key={slide.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-2">
                <span className="text-xs font-bold text-gray-400 w-5 text-center">{i + 1}</span>
                {slide.imageUrl ? (
                  <div className="w-24 h-16 rounded overflow-hidden bg-gray-100 shrink-0">
                    <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-24 h-16 rounded bg-gray-100 flex items-center justify-center text-gray-300 shrink-0">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                )}
                <p className="text-xs text-gray-600 truncate flex-1">{slide.title}</p>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // image picker grid
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-700">選擇圖片</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              點擊圖片以指定給投影片
            </p>
          </div>
          <button
            onClick={() => setImagePickerSlideId(null)}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded border border-gray-200"
          >
            取消
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {isLoadingAssets ? (
            <div className="flex items-center justify-center h-32">
              <RefreshCw className="w-5 h-5 animate-spin text-brand-600" />
            </div>
          ) : assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400">
              <ImageIcon className="w-10 h-10 opacity-20 mb-2" />
              <p className="text-sm">尚無素材圖片</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => {
                    updateSlide(imagePickerSlideId, { imageUrl: asset.url });
                    setImagePickerSlideId(null);
                  }}
                  className="rounded-lg border-2 border-gray-200 overflow-hidden hover:border-brand-400 transition-colors"
                >
                  <div className="aspect-[4/3] bg-gray-100">
                    <img
                      src={asset.url}
                      alt={asset.meta?.slotLabel || ""}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <p className="text-[9px] text-gray-500 truncate px-1.5 py-1">
                    {asset.meta?.slotLabel || asset.meta?.style || "素材"}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ================================================================
     Render: Step 3 - Style + Layout
     ================================================================ */

  const renderStep3Left = () => (
    <div className="space-y-5">
      {/* NEW: beautiful theme picker (Gamma-grade HTML/CSS render) */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-brand-600" /> 簡報主題（高級渲染）
        </label>
        <div className="grid grid-cols-1 gap-2">
          {SLIDE_THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedThemeId(t.id)}
              className={`rounded-xl border p-3 text-left transition-all ${
                selectedThemeId === t.id
                  ? "border-brand-500 ring-2 ring-brand-200 shadow-sm"
                  : "border-gray-200 hover:border-brand-300"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex rounded-lg overflow-hidden border border-gray-200 shrink-0">
                  <div className="w-6 h-10" style={{ background: t.colors.bg }} />
                  <div className="w-6 h-10" style={{ background: t.colors.surface }} />
                  <div className="w-4 h-10" style={{ background: t.colors.accent }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-800">{t.label}</p>
                  <p className="text-[11px] text-gray-500 leading-snug">{t.description}</p>
                </div>
                {selectedThemeId === t.id && <CheckCircle2 className="w-4 h-4 text-brand-600 shrink-0" />}
              </div>
            </button>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-2">
          主題決定字體、配色與版型質感。右側即時預覽，匯出 PDF / PPTX 完全一致。
        </p>
      </div>

      {/* Style presets (legacy PPTX colors) */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
          <Palette className="w-3.5 h-3.5" /> 經典 PPTX 配色（舊版）
        </label>
        <div className="grid grid-cols-2 gap-2">
          {STYLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => setSelectedStyleId(preset.id)}
              className={`rounded-lg border p-2 text-left transition-all ${
                selectedStyleId === preset.id
                  ? "border-brand-500 ring-2 ring-brand-200 shadow-sm"
                  : "border-gray-200 hover:border-brand-300"
              }`}
            >
              <div className="flex items-center gap-1 mb-1">
                <div
                  className="w-4 h-4 rounded-sm border border-gray-200"
                  style={{ backgroundColor: `#${preset.bg}` }}
                />
                <div
                  className="w-4 h-4 rounded-sm border border-gray-200"
                  style={{ backgroundColor: `#${preset.accent}` }}
                />
                <div
                  className="w-4 h-4 rounded-sm border border-gray-200"
                  style={{ backgroundColor: `#${preset.contentBg}` }}
                />
              </div>
              <p className="text-[10px] font-medium text-gray-700 truncate">{preset.label}</p>
              <p className="text-[9px] text-gray-400 capitalize">{preset.category}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Per-slide layout */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5" /> 每頁版型
        </label>
        <div className="space-y-2">
          {slides.map((slide, i) => {
            const isFixed = i === 0 || i === slides.length - 1;
            return (
              <div
                key={slide.id}
                className="flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-2 border border-gray-200"
              >
                <span className="text-[10px] font-bold text-gray-400 w-4 text-center">{i + 1}</span>
                <p className="text-xs text-gray-700 truncate flex-1">{slide.title}</p>
                {isFixed ? (
                  <span className="text-[10px] text-gray-400 px-1.5">封面/結尾</span>
                ) : (
                  <select
                    value={slide.layout}
                    onChange={(e) =>
                      updateSlide(slide.id, { layout: e.target.value as SlideLayout })
                    }
                    className="text-[10px] bg-white border border-gray-200 rounded px-1.5 py-1 text-gray-600 cursor-pointer"
                  >
                    {LAYOUT_OPTIONS.map((lo) => (
                      <option key={lo.value} value={lo.value}>
                        {lo.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderStep3Right = () => {
    const previewBg = selectedStyle.bg;
    const previewAccent = selectedStyle.accent;
    const previewText = selectedStyle.text;
    const isDark = selectedStyle.category === "dark" || selectedStyle.category === "specialty";

    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-700">風格預覽</p>
          <p className="text-[11px] text-gray-400 mt-0.5">{selectedStyle.label}</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Cover preview */}
          <div
            className="rounded-xl overflow-hidden shadow-md aspect-video flex flex-col items-center justify-center relative"
            style={{ backgroundColor: `#${previewBg}`, fontFamily: "'Microsoft JhengHei', 'Arial', sans-serif" }}
          >
            <div className="absolute top-0 left-0 right-0 h-1.5" style={{ backgroundColor: `#${previewAccent}` }} />
            <p className="text-xl md:text-2xl font-bold" style={{ color: `#${previewText}` }}>
              {projectTitle || "專案名稱"}
            </p>
            <div className="w-16 h-1 my-3 rounded" style={{ backgroundColor: `#${previewAccent}` }} />
            <p className="text-sm" style={{ color: `#${selectedStyle.subtext}` }}>
              {designerName || "設計師"}
            </p>
            <div className="absolute bottom-0 left-0 right-0 h-1.5" style={{ backgroundColor: `#${previewAccent}` }} />
          </div>

          {/* Content slide previews — matches layout + PPT proportions */}
          {slides.slice(1, -1).map((slide) => {
            const imgOrPlaceholder = slide.imageUrl
              ? <img src={slide.imageUrl} alt="" className="w-full h-full object-contain" />
              : <div className="w-full h-full flex items-center justify-center bg-gray-200 text-gray-400 text-xs">圖片</div>;
            return (
            <div
              key={slide.id}
              className="rounded-xl overflow-hidden shadow-md border border-gray-100 aspect-video flex relative"
              style={{ backgroundColor: `#${selectedStyle.contentBg}`, fontFamily: "'Microsoft JhengHei', 'Arial', sans-serif" }}
            >
              {slide.layout === "full-image" ? (
                <>
                  <div className="w-full h-full">{slide.imageUrl ? <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gray-200 flex items-center justify-center text-gray-400">全圖</div>}</div>
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent p-4 md:p-5">
                    <p className="text-base md:text-lg font-bold text-white">{slide.title}</p>
                    <p className="text-xs text-gray-200 mt-1 line-clamp-2">{slide.body}</p>
                  </div>
                </>
              ) : slide.layout === "left-image" ? (
                <>
                  <div className="w-1/2 shrink-0">{imgOrPlaceholder}</div>
                  <div className="w-1 shrink-0" style={{ backgroundColor: `#${previewAccent}` }} />
                  <div className="flex-1 p-4 md:p-5 flex flex-col justify-center">
                    <p className="text-sm md:text-base font-bold leading-snug" style={{ color: `#${selectedStyle.contentText}` }}>{slide.title}</p>
                    <div className="w-10 h-0.5 my-2 rounded" style={{ backgroundColor: `#${previewAccent}` }} />
                    <p className="text-xs leading-relaxed line-clamp-4" style={{ color: `#${selectedStyle.contentSub}` }}>{slide.body}</p>
                  </div>
                </>
              ) : slide.layout === "right-image" ? (
                <>
                  <div className="w-1 shrink-0" style={{ backgroundColor: `#${previewAccent}` }} />
                  <div className="flex-1 p-4 md:p-5 flex flex-col justify-center">
                    <p className="text-sm md:text-base font-bold leading-snug" style={{ color: `#${selectedStyle.contentText}` }}>{slide.title}</p>
                    <div className="w-10 h-0.5 my-2 rounded" style={{ backgroundColor: `#${previewAccent}` }} />
                    <p className="text-xs leading-relaxed line-clamp-4" style={{ color: `#${selectedStyle.contentSub}` }}>{slide.body}</p>
                  </div>
                  <div className="w-2/5 shrink-0">{imgOrPlaceholder}</div>
                </>
              ) : (
                <>
                  <div className="w-1 shrink-0" style={{ backgroundColor: `#${previewAccent}` }} />
                  <div className="flex-1 flex flex-col items-center justify-center px-6">
                    <p className="text-sm md:text-base font-bold text-center leading-snug" style={{ color: `#${selectedStyle.contentText}` }}>{slide.title}</p>
                    <div className="w-10 h-0.5 my-2 rounded" style={{ backgroundColor: `#${previewAccent}` }} />
                    <p className="text-xs text-center leading-relaxed line-clamp-4" style={{ color: `#${selectedStyle.contentSub}` }}>{slide.body}</p>
                  </div>
                </>
              )}
            </div>
            );
          })}

          {/* Ending preview */}
          <div
            className="rounded-xl overflow-hidden shadow-md aspect-video flex flex-col items-center justify-center relative"
            style={{ backgroundColor: `#${previewBg}`, fontFamily: "'Microsoft JhengHei', 'Arial', sans-serif" }}
          >
            <div className="absolute top-0 left-0 right-0 h-1.5" style={{ backgroundColor: `#${previewAccent}` }} />
            <p className="text-lg md:text-xl font-bold" style={{ color: `#${previewText}` }}>
              {slides[slides.length - 1]?.title || "感謝觀看"}
            </p>
            <div className="w-16 h-1 my-3 rounded" style={{ backgroundColor: `#${previewAccent}` }} />
            <p className="text-xs md:text-sm text-center max-w-xs whitespace-pre-wrap" style={{ color: `#${selectedStyle.subtext}` }}>
              {slides[slides.length - 1]?.body || "期待與您合作"}
            </p>
            <div className="absolute bottom-0 left-0 right-0 h-1.5" style={{ backgroundColor: `#${previewAccent}` }} />
          </div>
        </div>
      </div>
    );
  };

  /* ================================================================
     Render: Step 4 - Preview + Download
     ================================================================ */

  /* ---- NEW: rich live preview (scaled SlideCanvas) ---- */
  const renderRichPreview = () => (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-700">即時預覽 · {activeTheme.label}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">所見即所得，匯出 PDF / PPTX 完全一致（共 {slides.length} 頁）</p>
      </div>
      <div className="flex-1 overflow-y-auto p-5 bg-gray-100 space-y-5">
        {slides.map((slide, i) => (
          <div key={slide.id} className="mx-auto w-full max-w-[600px]">
            <div
              className="relative w-full rounded-xl overflow-hidden shadow-lg ring-1 ring-black/5"
              style={{ aspectRatio: `${SLIDE_W} / ${SLIDE_H}` }}
            >
              <div
                style={{
                  width: SLIDE_W,
                  height: SLIDE_H,
                  transform: "scale(0.46875)",
                  transformOrigin: "top left",
                  position: "absolute",
                  top: 0,
                  left: 0,
                }}
              >
                <SlideCanvas
                  slide={toCanvasSlide(slide, i)}
                  theme={activeTheme}
                  index={i}
                  total={slides.length}
                  projectTitle={projectTitle}
                  designerName={designerName}
                />
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5 text-center">{i + 1}. {slide.title}</p>
          </div>
        ))}
      </div>
    </div>
  );

  /* ---- hidden full-size stage used only for rasterized export ---- */
  const renderExportStage = () => (
    <div
      ref={exportStageRef}
      aria-hidden
      style={{ position: "fixed", left: -99999, top: 0, pointerEvents: "none", opacity: 0 }}
    >
      {slides.map((slide, i) => (
        <div key={slide.id} data-export-slide style={{ width: SLIDE_W, height: SLIDE_H }}>
          <SlideCanvas
            slide={toCanvasSlide(slide, i)}
            theme={activeTheme}
            index={i}
            total={slides.length}
            projectTitle={projectTitle}
            designerName={designerName}
            exportMode
          />
        </div>
      ))}
    </div>
  );

  const renderStep4Left = () => (
    <div className="space-y-4">
      <div className="bg-brand-50 rounded-lg p-3 border border-brand-100">
        <p className="text-sm font-semibold text-brand-800">簡報準備完成</p>
        <p className="text-xs text-brand-600 mt-1">
          共 {slides.length} 頁 | 風格：{selectedStyle.label}
        </p>
      </div>

      <div className="space-y-1.5">
        {slides.map((slide, i) => (
          <div key={slide.id} className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 rounded px-2.5 py-1.5">
            <span className="font-bold text-gray-400 w-4 text-center">{i + 1}</span>
            <span className="truncate flex-1">{slide.title}</span>
            <span className="text-[9px] text-gray-400">
              {LAYOUT_OPTIONS.find((lo) => lo.value === slide.layout)?.label}
            </span>
            {slide.imageUrl && <ImageIcon className="w-3 h-3 text-brand-400" />}
          </div>
        ))}
      </div>

      {/* NEW: Gamma-grade theme-rendered export */}
      <button
        onClick={() => void handleRichExport("pdf")}
        disabled={isExporting || slides.length === 0}
        className="w-full py-3 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
      >
        {isExporting ? (
          <><RefreshCw className="w-4 h-4 animate-spin" /> {exportProgress || "匯出中..."}</>
        ) : (
          <><Download className="w-4 h-4" /> 下載 PDF（推薦 · 最漂亮）</>
        )}
      </button>
      <button
        onClick={() => void handleRichExport("pptx")}
        disabled={isExporting || slides.length === 0}
        className="w-full py-2.5 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isExporting ? (
          <><RefreshCw className="w-4 h-4 animate-spin" /> {exportProgress || "匯出中..."}</>
        ) : (
          <><Download className="w-4 h-4" /> 下載 PPTX（高畫質圖片版）</>
        )}
      </button>
      <p className="text-[10px] text-gray-400 text-center">
        以「{activeTheme.label}」主題渲染，畫面與預覽完全一致。
      </p>

      <details className="border-t border-gray-100 pt-2">
        <summary className="text-[11px] text-gray-400 cursor-pointer hover:text-gray-600">
          進階：舊版可編輯文字 PPTX
        </summary>
        <button
          onClick={() => void handleDownloadPptx()}
          disabled={isDownloading || slides.length === 0}
          className="mt-2 w-full py-2 border border-gray-300 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isDownloading ? (
            <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> 製作中...</>
          ) : (
            <><Download className="w-3.5 h-3.5" /> 下載舊版 PPT（文字可編輯）</>
          )}
        </button>
      </details>
    </div>
  );

  const renderStep4Right = () => (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-700">投影片預覽</p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          共 {slides.length} 頁
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {slides.map((slide, i) => {
          const isFirst = i === 0;
          const isLast = i === slides.length - 1;
          const isCoverOrEnd = isFirst || isLast;

          return (
            <div
              key={slide.id}
              className="rounded-xl overflow-hidden shadow-md border border-gray-200"
            >
              {/* Mini slide */}
              <div
                className="aspect-video relative flex"
                style={{
                  backgroundColor: isCoverOrEnd
                    ? `#${selectedStyle.bg}`
                    : `#${selectedStyle.contentBg}`,
                }}
              >
                {slide.layout === "ai-full" ? (
                  <div
                    className="flex-1 relative bg-gray-100"
                    style={{ fontFamily: "'Microsoft JhengHei', 'Arial', sans-serif" }}
                  >
                    {slide.imageUrl ? (
                      <>
                        <img src={slide.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                        {isFirst || isLast ? (
                          <>
                            <div className="absolute left-0 right-0 top-1/3 bottom-1/3 bg-black/50 flex flex-col items-center justify-center px-6 text-center">
                              <p className="text-2xl md:text-4xl font-bold text-white leading-tight">{slide.title}</p>
                              <div className="w-12 h-0.5 my-3 bg-white/70 rounded" />
                              <p className="text-xs md:text-base text-white whitespace-pre-wrap leading-relaxed max-w-md">{slide.body}</p>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="absolute top-0 left-0 right-0 bg-black/50 px-4 md:px-6 py-2.5 md:py-3">
                              <p className="text-base md:text-xl font-bold text-white leading-tight">{slide.title}</p>
                            </div>
                            <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-4 md:px-6 py-2.5 md:py-3">
                              <p className="text-xs md:text-sm text-white leading-relaxed whitespace-pre-wrap line-clamp-3">{slide.body}</p>
                              <p className="text-[9px] md:text-[10px] text-white/70 text-right mt-1">
                                {i + 1} / {slides.length}
                              </p>
                            </div>
                          </>
                        )}
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                        AI 生成中...
                      </div>
                    )}
                  </div>
                ) : isCoverOrEnd ? (
                  <div className="flex-1 flex flex-col items-center justify-center px-8" style={{ fontFamily: "'Microsoft JhengHei', 'Arial', sans-serif" }}>
                    <div className="absolute top-0 left-0 right-0 h-1.5" style={{ backgroundColor: `#${selectedStyle.accent}` }} />
                    <p
                      className={`font-bold text-center leading-tight ${isFirst ? "text-2xl md:text-3xl" : "text-xl md:text-2xl"}`}
                      style={{ color: `#${selectedStyle.text}` }}
                    >
                      {slide.title}
                    </p>
                    <div className="w-16 h-1 my-3 rounded" style={{ backgroundColor: `#${selectedStyle.accent}` }} />
                    <p
                      className="text-sm md:text-base text-center whitespace-pre-wrap leading-relaxed max-w-lg"
                      style={{ color: `#${selectedStyle.subtext}` }}
                    >
                      {slide.body}
                    </p>
                    <div className="absolute bottom-0 left-0 right-0 h-1.5" style={{ backgroundColor: `#${selectedStyle.accent}` }} />
                  </div>
                ) : slide.layout === "full-image" ? (
                  <div className="flex-1 relative" style={{ fontFamily: "'Microsoft JhengHei', 'Arial', sans-serif" }}>
                    {slide.imageUrl ? <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gray-300 flex items-center justify-center text-gray-500">全圖</div>}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent p-4 md:p-6">
                      <p className="text-base md:text-xl font-bold text-white">{slide.title}</p>
                      <p className="text-xs md:text-sm text-gray-200 mt-1 line-clamp-2">{slide.body}</p>
                    </div>
                  </div>
                ) : slide.layout === "left-image" ? (
                  <div className="flex-1 flex" style={{ fontFamily: "'Microsoft JhengHei', 'Arial', sans-serif" }}>
                    <div className="w-1/2 shrink-0 bg-gray-100">
                      {slide.imageUrl ? <img src={slide.imageUrl} alt="" className="w-full h-full object-contain" /> : <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">圖片</div>}
                    </div>
                    <div className="w-1 shrink-0" style={{ backgroundColor: `#${selectedStyle.accent}` }} />
                    <div className="flex-1 p-4 md:p-6 flex flex-col justify-center">
                      <p className="text-base md:text-xl font-bold leading-tight" style={{ color: `#${selectedStyle.contentText}` }}>{slide.title}</p>
                      <div className="w-10 h-1 my-2 rounded" style={{ backgroundColor: `#${selectedStyle.accent}` }} />
                      <p className="text-xs md:text-sm leading-relaxed" style={{ color: `#${selectedStyle.contentSub}` }}>{slide.body}</p>
                    </div>
                  </div>
                ) : slide.layout === "right-image" ? (
                  <div className="flex-1 flex" style={{ fontFamily: "'Microsoft JhengHei', 'Arial', sans-serif" }}>
                    <div className="w-1.5 shrink-0" style={{ backgroundColor: `#${selectedStyle.accent}` }} />
                    <div className="flex-1 p-4 md:p-6 flex flex-col justify-center">
                      <p className="text-base md:text-xl font-bold leading-tight" style={{ color: `#${selectedStyle.contentText}` }}>{slide.title}</p>
                      <div className="w-10 h-1 my-2 rounded" style={{ backgroundColor: `#${selectedStyle.accent}` }} />
                      <p className="text-xs md:text-sm leading-relaxed" style={{ color: `#${selectedStyle.contentSub}` }}>{slide.body}</p>
                    </div>
                    <div className="w-2/5 shrink-0 bg-gray-100">
                      {slide.imageUrl ? <img src={slide.imageUrl} alt="" className="w-full h-full object-contain" /> : <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">圖片</div>}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex" style={{ fontFamily: "'Microsoft JhengHei', 'Arial', sans-serif" }}>
                    <div className="w-1.5 shrink-0" style={{ backgroundColor: `#${selectedStyle.accent}` }} />
                    <div className="flex-1 flex flex-col items-center justify-center px-8">
                      <p className="text-base md:text-xl font-bold text-center leading-tight" style={{ color: `#${selectedStyle.contentText}` }}>{slide.title}</p>
                      <div className="w-10 h-1 my-3 rounded" style={{ backgroundColor: `#${selectedStyle.accent}` }} />
                      <p className="text-xs md:text-sm text-center leading-relaxed max-w-md" style={{ color: `#${selectedStyle.contentSub}` }}>{slide.body}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Label */}
              <div className="px-3 py-1.5 bg-white border-t border-gray-100 flex items-center justify-between">
                <span className="text-[10px] text-gray-500">
                  {i + 1}/{slides.length} - {slide.title}
                </span>
                <span className="text-[9px] text-gray-400">
                  {LAYOUT_OPTIONS.find((lo) => lo.value === slide.layout)?.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  /* ================================================================
     Main render
     ================================================================ */

  const leftContent = () => {
    switch (step) {
      case 1: return renderStep1Left();
      case 2: return renderStep2Left();
      case 3: return renderStep3Left();
      case 4: return renderStep4Left();
      default: return null;
    }
  };

  const rightContent = () => {
    switch (step) {
      case 1: return renderStep1Right();
      case 2: return renderStep2Right();
      case 3: return renderRichPreview();
      case 4: return renderRichPreview();
      default: return null;
    }
  };
  // legacy preview renderers superseded by renderRichPreview
  void renderStep3Right;
  void renderStep4Right;

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col lg:flex-row gap-6">
      {renderExportStage()}
      {/* Left panel */}
      <div className="w-full lg:w-[380px] max-h-[35vh] lg:max-h-none bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Presentation className="w-4 h-4" /> 簡報製作
          </h3>
          <div className="flex items-center gap-2">
            {/* Save status */}
            <span className="text-[10px] text-gray-400 flex items-center gap-1">
              {saveState === "saving" && (<><RefreshCw className="w-3 h-3 animate-spin" /> 儲存中</>)}
              {saveState === "saved" && lastSavedAt && (
                <><CheckCircle2 className="w-3 h-3 text-green-500" /> 已儲存 {new Date(lastSavedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</>
              )}
              {saveState === "error" && (<span className="text-red-500">儲存失敗</span>)}
            </span>
            {slides.length > 0 && (
              <button
                onClick={() => { void persistDraft(); void loadSavedDrafts(); }}
                disabled={saveState === "saving"}
                className="text-[11px] px-2 py-1 border border-gray-200 rounded-lg text-gray-600 hover:bg-white hover:border-brand-300 hover:text-brand-700 transition-colors flex items-center gap-1 disabled:opacity-50"
                title="立即儲存草稿"
              >
                <Save className="w-3 h-3" /> 儲存
              </button>
            )}
          </div>
        </div>

        {/* Step indicator */}
        {renderStepIndicator()}

        {/* Step content */}
        <div className="flex-1 overflow-y-auto p-4">{leftContent()}</div>

        {/* Navigation footer */}
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
          <button
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
            className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-30 flex items-center gap-1"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> 上一步
          </button>
          {step < 4 ? (
            <button
              onClick={() => setStep((s) => Math.min(4, s + 1))}
              disabled={!canProceed(step)}
              className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-40 flex items-center gap-1"
            >
              下一步 <ChevronRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <div />
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 min-h-[200px] lg:min-h-0 bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
        {rightContent()}
      </div>
    </div>
  );
};
