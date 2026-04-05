import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  CheckCircle2,
  Download,
  FileText,
  Image as ImageIcon,
  Presentation,
  RefreshCw,
  Sparkles,
  Upload,
  Palette,
  X,
} from "lucide-react";
import { resolveClientUserScopeId } from "@/lib/client/user-scope";

/* ---------- types ---------- */

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

interface SlideData {
  title: string;
  body: string;
  imageUrl?: string;
  imageAssetId?: string;
}

/* ---------- templates ---------- */

const TEMPLATE_OPTIONS = [
  { id: "client-proposal", label: "客戶提案簡報", hint: "向客戶展示設計方案" },
  { id: "progress-report", label: "施工進度報告", hint: "紀錄施工階段狀態" },
  { id: "design-showcase", label: "設計作品集", hint: "展示設計能力與案例" },
] as const;

/* ---------- helpers ---------- */

const fetchImageAsBase64 = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // strip "data:image/jpeg;base64," prefix → pure base64
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

const COLOR_SCHEMES = {
  dark: { bg: "1a1a2e", accent: "e94560", text: "FFFFFF", subtext: "AAAAAA", contentBg: "F8F9FA", contentText: "2d2d2d", contentSub: "666666", accentBar: "e94560", label: "深色典雅" },
  warm: { bg: "5C3D2E", accent: "E6A157", text: "FFFFFF", subtext: "D4B896", contentBg: "FFF8F0", contentText: "3E2723", contentSub: "6D4C41", accentBar: "E6A157", label: "溫暖木質" },
  cool: { bg: "1B2838", accent: "4FC3F7", text: "FFFFFF", subtext: "90CAF9", contentBg: "F0F7FF", contentText: "1B2838", contentSub: "546E7A", accentBar: "4FC3F7", label: "冷調現代" },
  minimal: { bg: "FFFFFF", accent: "333333", text: "111111", subtext: "888888", contentBg: "FFFFFF", contentText: "222222", contentSub: "777777", accentBar: "333333", label: "極簡白" },
};

/* ---------- component ---------- */

export const PresentationMaker: React.FC = () => {
  const { data: session } = useSession();
  const [userScopeId, setUserScopeId] = useState("guest_server");
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [templateId, setTemplateId] = useState<string>("client-proposal");
  const [projectTitle, setProjectTitle] = useState("");
  const [designerName, setDesignerName] = useState("");
  const [extraNotes, setExtraNotes] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedSlides, setGeneratedSlides] = useState<SlideData[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadReady, setDownloadReady] = useState(false);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [colorScheme, setColorScheme] = useState<"dark" | "warm" | "cool" | "minimal">("dark");
  const templateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const u = session?.user as { id?: string; email?: string | null } | undefined;
    setUserScopeId(resolveClientUserScopeId(u?.id || null, u?.email || null));
  }, [session?.user]);

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

  const toggleAsset = (id: string) => {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* ---------- AI generate slide outlines ---------- */

  const handleGenerateSlides = async () => {
    if (selectedAssetIds.size === 0) return;
    setIsGenerating(true);
    setGeneratedSlides([]);
    setDownloadReady(false);

    const selected = assets.filter((a) => selectedAssetIds.has(a.id));
    const template = TEMPLATE_OPTIONS.find((t) => t.id === templateId);

    // Build an AI prompt
    const imageDescriptions = selected
      .map((a, i) => {
        const label = a.meta?.slotLabel || a.meta?.style || `圖片 ${i + 1}`;
        const summary = a.meta?.summary || "";
        return `- 第${i + 1}張「${label}」：${summary}`;
      })
      .join("\n");

    const aiPrompt =
      `你是室內設計公司的簡報顧問。請根據以下資訊，為一份「${template?.label || "設計提案"}」簡報生成投影片大綱。\n\n` +
      `專案名稱：${projectTitle || "室內設計方案"}\n` +
      `設計師：${designerName || "設計師"}\n` +
      `模板類型：${template?.label}\n` +
      (extraNotes ? `備註：${extraNotes}\n` : "") +
      `\n已選擇 ${selected.length} 張設計圖：\n${imageDescriptions}\n\n` +
      `請輸出 JSON 格式的投影片陣列，每張投影片包含 title 和 body（繁體中文），格式：\n` +
      `[{"title":"封面","body":"..."},{"title":"設計概述","body":"..."},...]` +
      `\n規則：(1) 第一頁為封面（含專案名稱與設計師名稱）(2) 最後一頁為結語/聯繫方式 (3) 中間每張設計圖至少對應一頁 (4) 使用專業室內設計用語`;

    try {
      const response = await fetch("/api/ai/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: selected[0]?.url || "",
          roomType: "全室整合",
          style: "簡報大綱",
          customPrompt: aiPrompt,
          creativity: 30,
        }),
      });
      const raw = await response.text();
      const payload = raw ? (JSON.parse(raw) as { summary?: string; error?: string }) : {};

      // Parse JSON from AI summary
      let slides: SlideData[] = [];
      const summaryText = payload.summary || "";
      const jsonMatch = summaryText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as Array<{ title?: string; body?: string }>;
          slides = parsed.map((s) => ({ title: s.title || "", body: s.body || "" }));
        } catch {
          /* fallback below */
        }
      }

      if (slides.length === 0) {
        // Fallback: generate basic slides
        slides = [
          { title: projectTitle || "室內設計提案", body: `設計師：${designerName || "設計師"}\n日期：${new Date().toLocaleDateString("zh-TW")}` },
          ...selected.map((a, i) => ({
            title: a.meta?.slotLabel || a.meta?.style || `設計圖 ${i + 1}`,
            body: a.meta?.summary || "設計方案展示",
          })),
          { title: "感謝觀看", body: "期待與您合作\n如有任何問題歡迎聯繫" },
        ];
      }

      // Assign images to slides
      let imgIdx = 0;
      slides = slides.map((slide) => {
        if (imgIdx < selected.length && imgIdx > 0) {
          const asset = selected[imgIdx - 1];
          return { ...slide, imageUrl: asset.url, imageAssetId: asset.id };
        }
        imgIdx++;
        return slide;
      });
      // Assign images more specifically: skip first (cover) and last (ending)
      const middleSlides = slides.slice(1, -1);
      for (let i = 0; i < middleSlides.length && i < selected.length; i++) {
        middleSlides[i].imageUrl = selected[i].url;
        middleSlides[i].imageAssetId = selected[i].id;
      }
      slides = [slides[0], ...middleSlides, slides[slides.length - 1]];

      setGeneratedSlides(slides);
      setDownloadReady(true);
    } catch {
      // Fallback
      const selected2 = assets.filter((a) => selectedAssetIds.has(a.id));
      setGeneratedSlides([
        { title: projectTitle || "室內設計提案", body: `設計師：${designerName || ""}` },
        ...selected2.map((a, i) => ({
          title: a.meta?.slotLabel || `設計圖 ${i + 1}`,
          body: a.meta?.summary || "",
          imageUrl: a.url,
        })),
        { title: "感謝觀看", body: "期待與您合作" },
      ]);
      setDownloadReady(true);
    } finally {
      setIsGenerating(false);
    }
  };

  /* ---------- Download PPTX ---------- */

  const handleDownloadPptx = async () => {
    if (generatedSlides.length === 0) return;
    setIsDownloading(true);

    try {
      const PptxGenJS = (await import("pptxgenjs")).default;
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 inches
      pptx.author = designerName || "Interior Pro";
      pptx.title = projectTitle || "室內設計簡報";

      const scheme = COLOR_SCHEMES[colorScheme];
      const font = "Microsoft JhengHei";

      for (let idx = 0; idx < generatedSlides.length; idx++) {
        const slide = generatedSlides[idx];
        const isFirst = idx === 0;
        const isLast = idx === generatedSlides.length - 1;
        const isCoverOrEnd = (isFirst || isLast) && !slide.imageUrl;
        const s = pptx.addSlide();

        if (isCoverOrEnd) {
          // ── Cover / Ending slide ──
          s.background = { color: scheme.bg };
          // Top accent line
          s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.06, fill: { color: scheme.accent } });
          // Bottom accent line
          s.addShape(pptx.ShapeType.rect, { x: 0, y: 7.44, w: 13.33, h: 0.06, fill: { color: scheme.accent } });

          if (isFirst) {
            // Cover: large title
            s.addText(slide.title || projectTitle || "室內設計提案", {
              x: 1, y: 2, w: 11.33, h: 1.5, fontSize: 40, bold: true,
              color: scheme.text, fontFace: font, align: "center", lineSpacingMultiple: 1.2,
            });
            // Accent divider
            s.addShape(pptx.ShapeType.rect, { x: 5.5, y: 3.7, w: 2.33, h: 0.04, fill: { color: scheme.accent } });
            // Subtitle
            s.addText(slide.body || `設計師：${designerName}`, {
              x: 1, y: 4, w: 11.33, h: 1.2, fontSize: 20,
              color: scheme.subtext, fontFace: font, align: "center", lineSpacingMultiple: 1.5,
            });
            // Date
            s.addText(new Date().toLocaleDateString("zh-TW"), {
              x: 1, y: 6.2, w: 11.33, h: 0.5, fontSize: 12,
              color: scheme.subtext, fontFace: font, align: "center",
            });
          } else {
            // Ending slide
            s.addText(slide.title || "感謝觀看", {
              x: 1, y: 2.5, w: 11.33, h: 1.2, fontSize: 36, bold: true,
              color: scheme.text, fontFace: font, align: "center",
            });
            s.addShape(pptx.ShapeType.rect, { x: 5.5, y: 3.9, w: 2.33, h: 0.04, fill: { color: scheme.accent } });
            s.addText(slide.body || "期待與您合作", {
              x: 1, y: 4.2, w: 11.33, h: 2, fontSize: 18,
              color: scheme.subtext, fontFace: font, align: "center", lineSpacingMultiple: 1.6,
            });
          }
        } else if (slide.imageUrl) {
          // ── Content slide with image ──
          s.background = { color: scheme.contentBg };
          // Left accent bar
          s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.08, h: 7.5, fill: { color: scheme.accentBar } });

          // Image on right (large, with shadow effect via dark rect behind)
          const base64 = await fetchImageAsBase64(slide.imageUrl);
          if (base64) {
            // Shadow rect
            s.addShape(pptx.ShapeType.rect, { x: 5.65, y: 0.55, w: 7.2, h: 5.5, fill: { color: "E0E0E0" }, rectRadius: 0.08 });
            s.addImage({
              data: `image/jpeg;base64,${base64}`,
              x: 5.6, y: 0.5, w: 7.2, h: 5.5,
              sizing: { type: "cover", w: 7.2, h: 5.5 },
              rounding: true,
            });
          }

          // Title on left
          s.addText(slide.title, {
            x: 0.6, y: 0.6, w: 4.6, h: 0.8, fontSize: 22, bold: true,
            color: scheme.contentText, fontFace: font,
          });
          // Accent underline
          s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.5, w: 1.5, h: 0.04, fill: { color: scheme.accentBar } });
          // Body text
          s.addText(slide.body, {
            x: 0.6, y: 1.8, w: 4.6, h: 4, fontSize: 13,
            color: scheme.contentSub, fontFace: font, valign: "top", lineSpacingMultiple: 1.5,
          });
          // Slide number
          s.addText(`${idx + 1} / ${generatedSlides.length}`, {
            x: 0.6, y: 6.8, w: 2, h: 0.4, fontSize: 9,
            color: "BBBBBB", fontFace: font,
          });
        } else {
          // Text-only content slide (no image)
          s.background = { color: scheme.contentBg };
          s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.08, h: 7.5, fill: { color: scheme.accentBar } });
          s.addText(slide.title, {
            x: 1, y: 1.5, w: 11, h: 1, fontSize: 28, bold: true,
            color: scheme.contentText, fontFace: font, align: "center",
          });
          s.addShape(pptx.ShapeType.rect, { x: 5.5, y: 2.7, w: 2.33, h: 0.04, fill: { color: scheme.accentBar } });
          s.addText(slide.body, {
            x: 1.5, y: 3, w: 10, h: 3.5, fontSize: 16,
            color: scheme.contentSub, fontFace: font, align: "center", lineSpacingMultiple: 1.6,
          });
        }
      }

      const fileName = `${projectTitle || "設計簡報"}_${new Date().toLocaleDateString("zh-TW").replace(/\//g, "")}.pptx`;
      await pptx.writeFile({ fileName });
    } catch (err) {
      console.error("PPT download error:", err);
    } finally {
      setIsDownloading(false);
    }
  };

  /* ---------- render ---------- */

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col lg:flex-row gap-6">
      {/* Left panel: settings */}
      <div className="w-full lg:w-80 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Presentation className="w-4 h-4" /> 簡報製作
          </h3>
          <p className="text-[11px] text-gray-500 mt-1">
            選擇設計圖 → AI 生成簡報大綱 → 下載 PPT
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Template */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">簡報模板</label>
            <div className="space-y-1.5">
              {TEMPLATE_OPTIONS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTemplateId(t.id)}
                  className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
                    t.id === templateId
                      ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500"
                      : "border-gray-200 hover:border-brand-300"
                  }`}
                >
                  <p className="text-sm font-semibold text-gray-800">{t.label}</p>
                  <p className="text-[11px] text-gray-500">{t.hint}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Project title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">專案名稱</label>
            <input
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              placeholder="例：王先生三房兩廳翻新案"
              className="w-full text-sm border-gray-300 rounded-lg p-2.5 bg-white border"
            />
          </div>

          {/* Designer name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">設計師姓名</label>
            <input
              value={designerName}
              onChange={(e) => setDesignerName(e.target.value)}
              placeholder="例：陳設計師"
              className="w-full text-sm border-gray-300 rounded-lg p-2.5 bg-white border"
            />
          </div>

          {/* Extra notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">補充說明（選填）</label>
            <textarea
              value={extraNotes}
              onChange={(e) => setExtraNotes(e.target.value)}
              placeholder="補充客戶需求、預算、設計風格重點..."
              className="w-full text-sm border-gray-300 rounded-lg p-2.5 bg-white border h-20 resize-none"
            />
          </div>

          {/* Color scheme */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5" /> 配色風格
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {(["dark", "warm", "cool", "minimal"] as const).map((key) => {
                const cs = COLOR_SCHEMES[key];
                return (
                  <button
                    key={key}
                    onClick={() => setColorScheme(key)}
                    className={`rounded-lg border p-2 text-left transition-colors ${
                      colorScheme === key
                        ? "border-brand-500 ring-1 ring-brand-500"
                        : "border-gray-200 hover:border-brand-300"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="w-3 h-3 rounded-full border border-gray-200" style={{ backgroundColor: `#${cs.bg}` }} />
                      <div className="w-3 h-3 rounded-full border border-gray-200" style={{ backgroundColor: `#${cs.accent}` }} />
                    </div>
                    <p className="text-[11px] font-medium text-gray-700">{cs.label}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Template upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">投影片母片（選填）</label>
            <p className="text-[10px] text-gray-400 mb-2">上傳 .pptx 母片檔，系統將以其為底板生成內容</p>
            {templateFile ? (
              <div className="flex items-center gap-2 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2">
                <FileText className="w-4 h-4 text-brand-600 shrink-0" />
                <span className="text-xs text-brand-700 truncate flex-1">{templateFile.name}</span>
                <button onClick={() => setTemplateFile(null)} className="text-brand-400 hover:text-red-500">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => templateInputRef.current?.click()}
                className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:bg-gray-50 hover:border-brand-300 transition-colors flex items-center justify-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" /> 上傳 .pptx 母片
              </button>
            )}
            <input
              ref={templateInputRef}
              type="file"
              accept=".pptx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setTemplateFile(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {/* Bottom actions */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 space-y-2">
          <button
            onClick={() => void handleGenerateSlides()}
            disabled={selectedAssetIds.size === 0 || isGenerating}
            className="w-full py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> AI 生成簡報大綱中...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" /> 生成簡報（已選 {selectedAssetIds.size} 張）
              </>
            )}
          </button>
          {downloadReady && (
            <button
              onClick={() => void handleDownloadPptx()}
              disabled={isDownloading}
              className="w-full py-2.5 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 min-h-0 flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Tabs */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between shrink-0 bg-gray-50">
          <div>
            <p className="text-sm font-semibold text-gray-800">
              {downloadReady ? "簡報預覽" : "選擇設計圖片"}
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {downloadReady
                ? `共 ${generatedSlides.length} 頁，點擊「下載 PPT」取得檔案`
                : `點選圖片加入簡報（已選 ${selectedAssetIds.size} 張）`}
            </p>
          </div>
          {downloadReady && (
            <button
              onClick={() => {
                setDownloadReady(false);
                setGeneratedSlides([]);
              }}
              className="text-xs text-brand-600 hover:text-brand-700 px-3 py-1 border border-brand-200 rounded-lg"
            >
              重新選圖
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {/* Image selection grid */}
          {!downloadReady && (
            isLoadingAssets ? (
              <div className="flex items-center justify-center h-40">
                <RefreshCw className="w-6 h-6 animate-spin text-brand-600" />
              </div>
            ) : assets.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                <ImageIcon className="w-10 h-10 opacity-20 mb-2" />
                <p className="text-sm">尚無設計圖</p>
                <p className="text-xs">先至「AI 空間渲染」生成圖片</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {assets.map((asset) => {
                  const selected = selectedAssetIds.has(asset.id);
                  return (
                    <button
                      key={asset.id}
                      onClick={() => toggleAsset(asset.id)}
                      className={`relative rounded-xl border-2 overflow-hidden transition-all ${
                        selected
                          ? "border-brand-500 ring-2 ring-brand-200 shadow-md"
                          : "border-gray-200 hover:border-brand-300"
                      }`}
                    >
                      <div className="aspect-[4/3] bg-gray-100">
                        <img
                          src={asset.url}
                          alt={asset.meta?.slotLabel || "design"}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      {selected && (
                        <div className="absolute top-1.5 right-1.5">
                          <CheckCircle2 className="w-5 h-5 text-brand-600 bg-white rounded-full" />
                        </div>
                      )}
                      <div className="px-2 py-1.5 bg-white">
                        <p className="text-[10px] text-gray-600 truncate">
                          {asset.meta?.slotLabel || asset.meta?.style || "設計圖"}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          )}

          {/* Slide preview */}
          {downloadReady && generatedSlides.length > 0 && (
            <div className="space-y-4">
              {generatedSlides.map((slide, i) => (
                <div
                  key={i}
                  className={`rounded-xl border overflow-hidden shadow-sm ${
                    slide.imageUrl ? "border-gray-200 bg-white" : "border-gray-700 bg-gray-900"
                  }`}
                >
                  <div className="flex items-start gap-3 p-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-semibold ${
                          slide.imageUrl ? "text-gray-800" : "text-white"
                        }`}
                      >
                        {slide.title}
                      </p>
                      <p
                        className={`text-xs mt-1 whitespace-pre-wrap ${
                          slide.imageUrl ? "text-gray-600" : "text-gray-400"
                        }`}
                      >
                        {slide.body}
                      </p>
                    </div>
                    {slide.imageUrl && (
                      <div className="shrink-0 w-28 h-20 rounded-lg overflow-hidden bg-gray-100">
                        <img
                          src={slide.imageUrl}
                          alt={slide.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
