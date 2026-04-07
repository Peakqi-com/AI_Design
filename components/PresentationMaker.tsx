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
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { resolveClientUserScopeId } from "@/lib/client/user-scope";

/* ================================================================
   Types
   ================================================================ */

type SlideLayout = "full-image" | "left-image" | "right-image" | "text-only";

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
  { value: "right-image", label: "上文下圖" },
  { value: "text-only", label: "純文字" },
];

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

export const PresentationMaker: React.FC = () => {
  const { data: session } = useSession();

  /* ---- user scope ---- */
  const [userScopeId, setUserScopeId] = useState("guest_server");
  useEffect(() => {
    const u = session?.user as { id?: string; email?: string | null } | undefined;
    setUserScopeId(resolveClientUserScopeId(u?.id || null, u?.email || null));
  }, [session?.user]);

  /* ---- media assets ---- */
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);

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

  /* ---- wizard state ---- */
  const [step, setStep] = useState(1);

  /* step 1 */
  const [projectTitle, setProjectTitle] = useState("");
  const [designerName, setDesignerName] = useState("");
  const [briefDesc, setBriefDesc] = useState("");
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);

  /* step 2 */
  const [imagePickerSlideId, setImagePickerSlideId] = useState<string | null>(null);

  /* step 3 */
  const [selectedStyleId, setSelectedStyleId] = useState<string>("bold-signal");

  /* step 4 */
  const [isDownloading, setIsDownloading] = useState(false);

  const selectedStyle: StylePreset =
    STYLE_PRESETS.find((s) => s.id === selectedStyleId) || STYLE_PRESETS[0];

  /* ================================================================
     Step 1 - AI outline generation
     ================================================================ */

  const handleGenerateOutline = async () => {
    setIsGeneratingOutline(true);
    try {
      const prompt =
        `你是室內設計公司的簡報顧問。請根據以下資訊，為一份設計提案簡報生成投影片大綱。\n\n` +
        `專案名稱：${projectTitle || "室內設計方案"}\n` +
        `設計師：${designerName || "設計師"}\n` +
        (briefDesc ? `說明：${briefDesc}\n` : "") +
        `\n請輸出 JSON 格式的投影片陣列，每張投影片包含 title 和 body（繁體中文），格式：\n` +
        `[{"title":"封面","body":"..."},{"title":"設計概述","body":"..."},...]` +
        `\n規則：(1) 第一頁為封面（含專案名稱與設計師名稱）(2) 最後一頁為結語/聯繫方式 ` +
        `(3) 中間安排 4-6 頁內容（設計理念、風格定位、空間規劃、材質配色、預算說明等）` +
        `(4) 使用專業室內設計用語 (5) 只輸出 JSON 陣列，不要其他文字。`;

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
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          /* fallback */
        }
      }

      if (parsed.length > 0) {
        setSlides(
          parsed.map((s) => ({
            id: uid(),
            title: s.title || "",
            body: s.body || "",
            imageUrl: null,
            layout: "right-image" as SlideLayout,
          })),
        );
      } else {
        // fallback
        setSlides([
          { id: uid(), title: projectTitle || "室內設計提案", body: `設計師：${designerName || "設計師"}\n日期：${new Date().toLocaleDateString("zh-TW")}`, imageUrl: null, layout: "text-only" },
          { id: uid(), title: "設計概述", body: "整體設計理念與風格定位", imageUrl: null, layout: "right-image" },
          { id: uid(), title: "空間規劃", body: "各空間的機能配置與動線安排", imageUrl: null, layout: "right-image" },
          { id: uid(), title: "材質與配色", body: "主要材質選擇與色彩搭配方案", imageUrl: null, layout: "right-image" },
          { id: uid(), title: "感謝觀看", body: "期待與您合作\n如有任何問題歡迎聯繫", imageUrl: null, layout: "text-only" },
        ]);
      }
    } catch {
      setSlides([
        { id: uid(), title: projectTitle || "室內設計提案", body: `設計師：${designerName || "設計師"}`, imageUrl: null, layout: "text-only" },
        { id: uid(), title: "設計概述", body: "整體設計理念與風格定位", imageUrl: null, layout: "right-image" },
        { id: uid(), title: "感謝觀看", body: "期待與您合作", imageUrl: null, layout: "text-only" },
      ]);
    } finally {
      setIsGeneratingOutline(false);
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
      { id: uid(), title: "新投影片", body: "", imageUrl: null, layout: "right-image" },
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
            x: 0.8, y: 6.1, w: 11.73, h: 1.0, fontSize: 13,
            color: "DDDDDD", fontFace: font, lineSpacingMultiple: 1.4,
          });
        } else if (layout === "left-image" && base64) {
          /* left-image: image left half, text right */
          s.background = { color: cs.contentBg };
          s.addImage({
            data: `image/jpeg;base64,${base64}`,
            x: 0, y: 0, w: 6.5, h: 7.5,
            sizing: { type: "cover", w: 6.5, h: 7.5 },
          });
          s.addShape(pptx.ShapeType.rect, { x: 6.5, y: 0, w: 0.06, h: 7.5, fill: { color: cs.accent } });
          s.addText(slide.title, {
            x: 7.0, y: 1.0, w: 5.8, h: 1.0, fontSize: 22, bold: true,
            color: cs.contentText, fontFace: font,
          });
          s.addShape(pptx.ShapeType.rect, { x: 7.0, y: 2.1, w: 1.5, h: 0.04, fill: { color: cs.accent } });
          s.addText(slide.body, {
            x: 7.0, y: 2.5, w: 5.8, h: 4.0, fontSize: 13,
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
            x: 0.6, y: 1.8, w: 4.6, h: 4, fontSize: 13,
            color: cs.contentSub, fontFace: font, valign: "top", lineSpacingMultiple: 1.5,
          });
          s.addShape(pptx.ShapeType.rect, { x: 5.65, y: 0.55, w: 7.2, h: 5.5, fill: { color: "E0E0E0" }, rectRadius: 0.08 });
          s.addImage({
            data: `image/jpeg;base64,${base64}`,
            x: 5.6, y: 0.5, w: 7.2, h: 5.5,
            sizing: { type: "cover", w: 7.2, h: 5.5 },
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
        onClick={() => void handleGenerateOutline()}
        disabled={isGeneratingOutline}
        className="w-full py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isGeneratingOutline ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" /> 生成中...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" /> AI 生成大綱
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

  const renderStep2Left = () => (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        為每張投影片選擇配圖。點擊圖片區域即可從素材庫挑選。
      </p>
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
              <button
                disabled
                className="mt-1 text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-400 cursor-not-allowed"
                title="即將推出"
              >
                AI 生成配圖
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

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
      {/* Style presets */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
          <Palette className="w-3.5 h-3.5" /> 風格選擇
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
          {slides.map((slide, i) => (
            <div
              key={slide.id}
              className="flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-2 border border-gray-200"
            >
              <span className="text-[10px] font-bold text-gray-400 w-4 text-center">{i + 1}</span>
              <p className="text-xs text-gray-700 truncate flex-1">{slide.title}</p>
              <select
                value={slide.layout}
                onChange={(e) =>
                  updateSlide(slide.id, { layout: e.target.value as SlideLayout })
                }
                className="text-[10px] bg-white border border-gray-200 rounded px-1.5 py-1 text-gray-600"
              >
                {LAYOUT_OPTIONS.map((lo) => (
                  <option key={lo.value} value={lo.value}>
                    {lo.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
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
          {/* Mini cover preview */}
          <div
            className="rounded-xl overflow-hidden shadow-md aspect-video flex flex-col items-center justify-center relative"
            style={{ backgroundColor: `#${previewBg}` }}
          >
            <div
              className="absolute top-0 left-0 right-0 h-1"
              style={{ backgroundColor: `#${previewAccent}` }}
            />
            <p
              className="text-lg font-bold"
              style={{ color: `#${previewText}` }}
            >
              {projectTitle || "專案名稱"}
            </p>
            <div
              className="w-12 h-0.5 my-2 rounded"
              style={{ backgroundColor: `#${previewAccent}` }}
            />
            <p
              className="text-xs"
              style={{ color: `#${selectedStyle.subtext}` }}
            >
              {designerName || "設計師"}
            </p>
            <div
              className="absolute bottom-0 left-0 right-0 h-1"
              style={{ backgroundColor: `#${previewAccent}` }}
            />
          </div>

          {/* Mini content preview */}
          {slides.slice(1, -1).map((slide, i) => (
            <div
              key={slide.id}
              className="rounded-xl overflow-hidden shadow-sm border border-gray-100 aspect-video flex"
              style={{ backgroundColor: `#${selectedStyle.contentBg}` }}
            >
              <div className="w-1" style={{ backgroundColor: `#${previewAccent}` }} />
              <div className="flex-1 p-3 flex flex-col justify-center">
                <p
                  className="text-xs font-bold truncate"
                  style={{ color: `#${selectedStyle.contentText}` }}
                >
                  {slide.title}
                </p>
                <div
                  className="w-6 h-0.5 my-1 rounded"
                  style={{ backgroundColor: `#${previewAccent}` }}
                />
                <p
                  className="text-[9px] line-clamp-2"
                  style={{ color: `#${selectedStyle.contentSub}` }}
                >
                  {slide.body}
                </p>
              </div>
              {slide.imageUrl && (
                <div className="w-2/5 shrink-0">
                  <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" />
                </div>
              )}
            </div>
          ))}

          {/* Mini ending preview */}
          <div
            className="rounded-xl overflow-hidden shadow-md aspect-video flex flex-col items-center justify-center relative"
            style={{ backgroundColor: `#${previewBg}` }}
          >
            <div
              className="absolute top-0 left-0 right-0 h-1"
              style={{ backgroundColor: `#${previewAccent}` }}
            />
            <p
              className="text-sm font-bold"
              style={{ color: `#${previewText}` }}
            >
              {slides[slides.length - 1]?.title || "感謝觀看"}
            </p>
            <div
              className="absolute bottom-0 left-0 right-0 h-1"
              style={{ backgroundColor: `#${previewAccent}` }}
            />
          </div>
        </div>
      </div>
    );
  };

  /* ================================================================
     Render: Step 4 - Preview + Download
     ================================================================ */

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

      <button
        onClick={() => void handleDownloadPptx()}
        disabled={isDownloading || slides.length === 0}
        className="w-full py-3 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isDownloading ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" /> 製作 PPT 中...
          </>
        ) : (
          <>
            <Download className="w-4 h-4" /> 下載 PPT 檔案
          </>
        )}
      </button>
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
                {isCoverOrEnd ? (
                  /* cover / ending */
                  <div className="flex-1 flex flex-col items-center justify-center px-6">
                    <div
                      className="absolute top-0 left-0 right-0 h-1"
                      style={{ backgroundColor: `#${selectedStyle.accent}` }}
                    />
                    <p
                      className={`font-bold text-center ${isFirst ? "text-lg" : "text-base"}`}
                      style={{ color: `#${selectedStyle.text}` }}
                    >
                      {slide.title}
                    </p>
                    <div
                      className="w-10 h-0.5 my-2 rounded"
                      style={{ backgroundColor: `#${selectedStyle.accent}` }}
                    />
                    <p
                      className="text-xs text-center whitespace-pre-wrap"
                      style={{ color: `#${selectedStyle.subtext}` }}
                    >
                      {slide.body}
                    </p>
                    <div
                      className="absolute bottom-0 left-0 right-0 h-1"
                      style={{ backgroundColor: `#${selectedStyle.accent}` }}
                    />
                  </div>
                ) : slide.layout === "full-image" && slide.imageUrl ? (
                  <div className="flex-1 relative">
                    <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3">
                      <p className="text-xs font-bold text-white">{slide.title}</p>
                      <p className="text-[9px] text-gray-200 mt-0.5 line-clamp-1">{slide.body}</p>
                    </div>
                  </div>
                ) : slide.layout === "left-image" && slide.imageUrl ? (
                  <>
                    <div className="w-1/2 shrink-0">
                      <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="w-0.5 shrink-0" style={{ backgroundColor: `#${selectedStyle.accent}` }} />
                    <div className="flex-1 p-3 flex flex-col justify-center">
                      <p className="text-xs font-bold" style={{ color: `#${selectedStyle.contentText}` }}>{slide.title}</p>
                      <div className="w-6 h-0.5 my-1 rounded" style={{ backgroundColor: `#${selectedStyle.accent}` }} />
                      <p className="text-[9px] line-clamp-3" style={{ color: `#${selectedStyle.contentSub}` }}>{slide.body}</p>
                    </div>
                  </>
                ) : slide.layout === "right-image" && slide.imageUrl ? (
                  <>
                    <div className="w-1" style={{ backgroundColor: `#${selectedStyle.accent}` }} />
                    <div className="flex-1 p-3 flex flex-col justify-center">
                      <p className="text-xs font-bold" style={{ color: `#${selectedStyle.contentText}` }}>{slide.title}</p>
                      <div className="w-6 h-0.5 my-1 rounded" style={{ backgroundColor: `#${selectedStyle.accent}` }} />
                      <p className="text-[9px] line-clamp-3" style={{ color: `#${selectedStyle.contentSub}` }}>{slide.body}</p>
                    </div>
                    <div className="w-2/5 shrink-0">
                      <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" />
                    </div>
                  </>
                ) : (
                  /* text-only */
                  <>
                    <div className="w-1" style={{ backgroundColor: `#${selectedStyle.accent}` }} />
                    <div className="flex-1 flex flex-col items-center justify-center px-6">
                      <p className="text-xs font-bold text-center" style={{ color: `#${selectedStyle.contentText}` }}>{slide.title}</p>
                      <div className="w-6 h-0.5 my-1.5 rounded" style={{ backgroundColor: `#${selectedStyle.accent}` }} />
                      <p className="text-[9px] text-center line-clamp-3" style={{ color: `#${selectedStyle.contentSub}` }}>{slide.body}</p>
                    </div>
                  </>
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
      case 3: return renderStep3Right();
      case 4: return renderStep4Right();
      default: return null;
    }
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col lg:flex-row gap-6">
      {/* Left panel */}
      <div className="w-full lg:w-[380px] bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Presentation className="w-4 h-4" /> 簡報製作
          </h3>
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
      <div className="flex-1 min-h-0 bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
        {rightContent()}
      </div>
    </div>
  );
};
