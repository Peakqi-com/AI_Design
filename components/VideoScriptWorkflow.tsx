import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Clapperboard,
  Download,
  Film,
  Image as ImageIcon,
  Play,
  RefreshCw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { resolveClientUserScopeId } from "@/lib/client/user-scope";
import { useCredits } from "@/lib/client/use-credits";

/* ---------- types ---------- */

interface ScriptSegment {
  id: number;
  title: string;
  description: string;
  prompt: string;
  imageDataUrl: string | null;
  videoUrl: string | null;
  status: "draft" | "generating" | "done" | "error";
  operationName: string | null;
  error: string | null;
}

// 不指定模型 — 讓 API 根據 mode 自動選擇最佳模型

const DEFAULT_SEGMENTS: ScriptSegment[] = [
  { id: 1, title: "開場", description: "", prompt: "", imageDataUrl: null, videoUrl: null, status: "draft", operationName: null, error: null },
  { id: 2, title: "主題", description: "", prompt: "", imageDataUrl: null, videoUrl: null, status: "draft", operationName: null, error: null },
  { id: 3, title: "結尾", description: "", prompt: "", imageDataUrl: null, videoUrl: null, status: "draft", operationName: null, error: null },
];

const toDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("讀取失敗"));
    reader.readAsDataURL(file);
  });

/* ---------- component ---------- */

export const VideoScriptWorkflow: React.FC = () => {
  const { data: session } = useSession();
  const credits = useCredits();
  const [userScopeId, setUserScopeId] = useState("guest_server");
  const [segments, setSegments] = useState<ScriptSegment[]>(DEFAULT_SEGMENTS.map((s) => ({ ...s })));
  const [briefInput, setBriefInput] = useState("");
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [insufficientMsg, setInsufficientMsg] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([null, null, null]);
  const pollTimersRef = useRef<Record<number, ReturnType<typeof setInterval>>>({});

  useEffect(() => {
    const u = session?.user as { id?: string; email?: string | null } | undefined;
    setUserScopeId(resolveClientUserScopeId(u?.id || null, u?.email || null));
  }, [session?.user]);

  // Cleanup poll timers
  useEffect(() => {
    return () => {
      Object.values(pollTimersRef.current).forEach(clearInterval);
    };
  }, []);

  const updateSegment = useCallback((id: number, patch: Partial<ScriptSegment>) => {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  /* ---------- AI generate script from brief ---------- */
  const handleGenerateScript = async () => {
    if (!briefInput.trim()) return;
    const d = await credits.confirmAndDeduct("生成腳本", "ai-social-post");
    if (!d.ok) { if (!d.cancelled) setInsufficientMsg(d.error || "點數不足"); return; }
    setInsufficientMsg(null);
    setIsGeneratingScript(true);
    try {
      const res = await fetch("/api/ai/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt:
            `你是室內設計行銷影片的腳本撰寫專家。請根據以下需求，生成一個 3 段式行銷影片腳本。\n\n` +
            `需求：${briefInput}\n\n` +
            `請輸出 JSON 陣列，恰好 3 個物件，每個物件包含：\n` +
            `- "title": 段落標題（繁體中文，2-6字）\n` +
            `- "description": 段落敘述（繁體中文，1-2句，給觀眾看的旁白或字幕）\n` +
            `- "prompt": 給 AI 影片生成模型的英文 prompt（描述具體畫面內容、鏡頭運動如 dolly in / pan right / orbit、光線、風格，約 20-40 字）\n\n` +
            `範例格式：[{"title":"開場","description":"走進夢想中的家","prompt":"Slow dolly forward into a bright modern living room..."}]\n` +
            `規則：每段約 5 秒影片。prompt 必須是英文且具體描述畫面。只輸出 JSON 陣列，不要其他文字。`,
          temperature: 0.6,
          jsonMode: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失敗");

      // Parse the JSON response
      const text = (data.text || "").trim();
      let parsed: Array<{ title?: string; description?: string; prompt?: string }> = [];
      try {
        const jsonCandidate = text.match(/\[[\s\S]*\]/)?.[0] || text;
        parsed = JSON.parse(jsonCandidate);
      } catch {
        // try direct parse
        try { parsed = JSON.parse(text); } catch { /* give up */ }
      }

      if (Array.isArray(parsed) && parsed.length >= 3) {
        setSegments((prev) =>
          prev.map((seg, i) => ({
            ...seg,
            title: parsed[i]?.title || seg.title,
            description: parsed[i]?.description || "",
            prompt: parsed[i]?.prompt || "",
          }))
        );
      }
    } catch {
      // ignore
    } finally {
      setIsGeneratingScript(false);
    }
  };

  /* ---------- Generate single segment video ---------- */
  const generateSegmentVideo = useCallback(
    async (segId: number) => {
      const seg = segments.find((s) => s.id === segId);
      if (!seg || !seg.prompt.trim()) return;

      // Credit check
      const deduction = await credits.confirmAndDeduct("生成影片片段", "ai-video");
      if (!deduction.ok) {
        if (!deduction.cancelled) setInsufficientMsg(deduction.error || "點數不足");
        return;
      }
      setInsufficientMsg(null);

      updateSegment(segId, { status: "generating", error: null, videoUrl: null });

      try {
        const body: Record<string, unknown> = {
          prompt: seg.prompt,
          aspectRatio,
          durationSec: 5,
          mode: seg.imageDataUrl ? "image-to-video" : "text-to-video",
        };
        if (seg.imageDataUrl) {
          body.imageDataUrl = seg.imageDataUrl;
        }

        const res = await fetch("/api/ai/video/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "影片生成啟動失敗");
        }

        updateSegment(segId, { operationName: data.operationName });

        // Start polling
        const timer = setInterval(async () => {
          try {
            const statusRes = await fetch(
              `/api/ai/video/status?operationName=${encodeURIComponent(data.operationName)}`
            );
            const statusData = await statusRes.json();
            if (statusData.done) {
              clearInterval(timer);
              delete pollTimersRef.current[segId];
              if (statusData.videoUri) {
                // 儲存影片到媒體庫（嘗試多種方式）
                let savedUrl = statusData.videoUri;
                try {
                  // 透過 server proxy 下載影片（避免 CORS + Replicate URL 會過期）
                  let videoBlob: Blob | null = null;
                  const dlRes = await fetch(
                    `/api/ai/video/download?videoUri=${encodeURIComponent(statusData.videoUri)}`
                  );
                  if (dlRes.ok) {
                    const ct = dlRes.headers.get("content-type") || "";
                    if (ct.includes("video") || ct.includes("octet-stream")) {
                      videoBlob = await dlRes.blob();
                    }
                  }

                  // 上傳到媒體庫
                  if (videoBlob && videoBlob.size > 0) {
                    const videoFile = new File([videoBlob], `script-seg${segId}-${Date.now()}.mp4`, { type: "video/mp4" });
                    const formData = new FormData();
                    formData.append("userId", userScopeId);
                    formData.append("kind", "video");
                    formData.append("file", videoFile);
                    formData.append("meta", JSON.stringify({
                      origin: "video-studio",
                      mode: "text-to-video",
                      style: "行銷影片腳本",
                      prompt: seg.prompt,
                      summary: seg.description || seg.title,
                    }));
                    const saveRes = await fetch("/api/social/assets", { method: "POST", body: formData });
                    if (saveRes.ok) {
                      const saveData = await saveRes.json();
                      savedUrl = saveData?.item?.url || savedUrl;
                    }
                  }
                } catch { /* use original URL */ }
                updateSegment(segId, { status: "done", videoUrl: savedUrl });
              } else if (statusData.error) {
                updateSegment(segId, { status: "error", error: statusData.error });
              } else {
                updateSegment(segId, { status: "error", error: "影片生成完成但未取得影片網址" });
              }
            }
          } catch {
            // keep polling
          }
        }, 5000);
        pollTimersRef.current[segId] = timer;
      } catch (err) {
        updateSegment(segId, {
          status: "error",
          error: err instanceof Error ? err.message : "生成失敗",
        });
      }
    },
    [segments, credits, aspectRatio, userScopeId, updateSegment],
  );

  /* ---------- Generate all segments ---------- */
  const handleGenerateAll = async () => {
    setIsGeneratingAll(true);
    for (const seg of segments) {
      if (seg.status !== "done" && seg.prompt.trim()) {
        await generateSegmentVideo(seg.id);
        // Small delay between starts
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    setIsGeneratingAll(false);
  };

  const allDone = segments.every((s) => s.status === "done");

  /* ---------- Merge 3 clips into one video ---------- */
  const handleMergeDownload = useCallback(async () => {
    const doneSegments = segments.filter((s) => s.videoUrl);
    if (doneSegments.length === 0) return;
    setIsMerging(true);

    try {
      // Server-side ffmpeg merge
      const res = await fetch("/api/ai/video/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrls: doneSegments.map((s) => s.videoUrl) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "合併失敗");
      }
      const blob = await res.blob();

      // Save merged video to media library
      try {
        const mergedFile = new File([blob], `merged-marketing-${Date.now()}.mp4`, { type: "video/mp4" });
        const formData = new FormData();
        formData.append("userId", userScopeId);
        formData.append("kind", "video");
        formData.append("file", mergedFile);
        formData.append("meta", JSON.stringify({
          origin: "video-studio",
          mode: "text-to-video",
          style: "行銷影片（合併）",
          summary: doneSegments.map((s) => s.title).join(" → "),
        }));
        fetch("/api/social/assets", { method: "POST", body: formData }).catch(() => {});
      } catch { /* ignore save error */ }

      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `marketing-video-${Date.now()}.mp4`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
    } catch {
      // Fallback: ZIP download
      try {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        for (let i = 0; i < doneSegments.length; i++) {
          const r = await fetch(doneSegments[i].videoUrl!);
          zip.file(`${i + 1}_${doneSegments[i].title || "segment"}.mp4`, await r.blob());
        }
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `marketing-video-${Date.now()}.zip`;
        a.click();
      } catch {
        for (const seg of doneSegments) {
          const a = document.createElement("a");
          a.href = seg.videoUrl!;
          a.download = "segment.mp4";
          a.click();
        }
      }
    } finally {
      setIsMerging(false);
    }
  }, [segments]);
  const anyGenerating = segments.some((s) => s.status === "generating");

  /* ---------- render ---------- */
  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col lg:flex-row gap-6">
      {/* Left panel: script editor */}
      <div className="w-full lg:w-96 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Clapperboard className="w-4 h-4" /> 行銷影片腳本
          </h3>
          <p className="text-[11px] text-gray-500 mt-1">撰寫 3 段腳本 → 逐段生成 5 秒影片</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* AI brief */}
          <div className="bg-brand-50 border border-brand-100 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-brand-700">AI 腳本生成</p>
            <textarea
              value={briefInput}
              onChange={(e) => setBriefInput(e.target.value)}
              placeholder="簡述行銷目標... 例如：推廣北歐風三房設計，展現寬敞客廳與溫暖燈光"
              className="w-full text-xs border-brand-200 rounded-lg p-2 bg-white border h-14 resize-none"
            />
            <button
              onClick={() => void handleGenerateScript()}
              disabled={!briefInput.trim() || isGeneratingScript}
              className="w-full py-1.5 bg-brand-600 text-white rounded-lg text-xs font-medium hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {isGeneratingScript ? (
                <><RefreshCw className="w-3 h-3 animate-spin" /> 生成中...</>
              ) : (
                <><Sparkles className="w-3 h-3" /> AI 生成腳本</>
              )}
            </button>
          </div>

          {/* Aspect ratio */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">影片比例</label>
            <div className="grid grid-cols-3 gap-1.5">
              {([["9:16", "直立"], ["16:9", "橫向"], ["1:1", "正方"]] as const).map(([r, label]) => (
                <button
                  key={r}
                  onClick={() => setAspectRatio(r)}
                  className={`py-1.5 text-xs rounded-lg border transition-colors ${
                    aspectRatio === r
                      ? "border-brand-500 bg-brand-50 text-brand-700 font-semibold"
                      : "border-gray-200 text-gray-600 hover:border-brand-300"
                  }`}
                >
                  {r} {label}
                </button>
              ))}
            </div>
          </div>

          {/* 3 segments */}
          {segments.map((seg, idx) => (
            <div key={seg.id} className="rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-[10px] font-bold flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <input
                    value={seg.title}
                    onChange={(e) => updateSegment(seg.id, { title: e.target.value })}
                    className="text-sm font-medium text-gray-800 bg-transparent border-none p-0 focus:outline-none w-24"
                    placeholder="段落標題"
                  />
                </div>
                <span className="text-[10px] text-gray-400">5 秒</span>
              </div>
              <div className="p-3 space-y-2">
                <textarea
                  value={seg.description}
                  onChange={(e) => updateSegment(seg.id, { description: e.target.value })}
                  placeholder="段落敘述（給觀眾看的文字）..."
                  className="w-full text-xs border-gray-200 rounded-lg p-2 bg-white border h-12 resize-none"
                />
                <textarea
                  value={seg.prompt}
                  onChange={(e) => updateSegment(seg.id, { prompt: e.target.value })}
                  placeholder="AI 影片生成 prompt（英文，描述畫面）..."
                  className="w-full text-xs border-gray-200 rounded-lg p-2 bg-gray-50 border h-12 resize-none font-mono"
                />

                {/* Image upload */}
                <div className="flex items-center gap-2">
                  {seg.imageDataUrl ? (
                    <div className="relative w-16 h-12 rounded-md overflow-hidden border border-gray-200">
                      <img src={seg.imageDataUrl} alt="" className="w-full h-full object-cover" />
                      <button
                        onClick={() => updateSegment(seg.id, { imageDataUrl: null })}
                        className="absolute top-0 right-0 p-0.5 bg-white/80 rounded-bl"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => fileInputRefs.current[idx]?.click()}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] text-gray-500 border border-gray-200 rounded-md hover:bg-gray-50"
                    >
                      <ImageIcon className="w-3 h-3" /> 加入參考圖
                    </button>
                  )}
                  <input
                    ref={(el) => { fileInputRefs.current[idx] = el; }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const dataUrl = await toDataUrl(file);
                      updateSegment(seg.id, { imageDataUrl: dataUrl });
                      e.target.value = "";
                    }}
                  />

                  {/* Per-segment generate */}
                  <button
                    onClick={() => void generateSegmentVideo(seg.id)}
                    disabled={!seg.prompt.trim() || seg.status === "generating" || anyGenerating}
                    className="ml-auto flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-gray-800 text-white rounded-md hover:bg-gray-900 disabled:opacity-40"
                  >
                    {seg.status === "generating" ? (
                      <><RefreshCw className="w-2.5 h-2.5 animate-spin" /> 生成中</>
                    ) : seg.status === "done" ? (
                      <><RefreshCw className="w-2.5 h-2.5" /> 重新生成</>
                    ) : (
                      <><Film className="w-2.5 h-2.5" /> 生成</>
                    )}
                  </button>
                </div>

                {seg.error && (
                  <p className="text-[10px] text-red-500">{seg.error}</p>
                )}
              </div>
            </div>
          ))}

          {insufficientMsg && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {insufficientMsg}
            </div>
          )}
        </div>

        {/* Bottom action */}
        <div className="p-4 border-t border-gray-100 bg-gray-50">
          <button
            onClick={() => void handleGenerateAll()}
            disabled={anyGenerating || isGeneratingAll || segments.every((s) => !s.prompt.trim())}
            className="w-full py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {anyGenerating || isGeneratingAll ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> 生成中...</>
            ) : (
              <><Sparkles className="w-4 h-4" /> 一鍵生成全部影片（3 段 × 5 秒）</>
            )}
          </button>
          <p className="text-[10px] text-gray-400 text-center mt-1.5">
            有圖=Grok・無圖=Kling v2.6 · 每段 12.5 點 · 共 37.5 點
          </p>
        </div>
      </div>

      {/* Right panel: video preview */}
      <div className="flex-1 min-h-0 bg-gray-900 rounded-xl border border-gray-200 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between shrink-0">
          <div>
            <p className="text-sm font-semibold text-white">影片預覽</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {allDone ? "3 段影片已全部生成" : "生成完成的段落將顯示在此"}
            </p>
          </div>
          {allDone && (
            <button
              onClick={() => void handleMergeDownload()}
              disabled={isMerging}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {isMerging ? (
                <><RefreshCw className="w-3 h-3 animate-spin" /> 合併中...</>
              ) : (
                <><Download className="w-3 h-3" /> 合併下載完整影片</>
              )}
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {segments.every((s) => s.status === "draft" && !s.videoUrl) ? (
            <div className="h-full flex items-center justify-center text-gray-500">
              <div className="text-center">
                <Film className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">撰寫腳本後生成影片</p>
                <p className="text-xs text-gray-600 mt-1">每段 5 秒，3 段組成 15 秒行銷影片</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {segments.map((seg, idx) => (
                <div key={seg.id} className="rounded-xl overflow-hidden bg-gray-800 border border-gray-700">
                  <div className="px-3 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-brand-500/30 text-brand-300 text-[10px] font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <span className="text-sm font-medium text-white">{seg.title || `段落 ${idx + 1}`}</span>
                    </div>
                    {seg.status === "generating" && (
                      <span className="text-[10px] text-brand-400 animate-pulse">生成中...</span>
                    )}
                    {seg.status === "done" && seg.videoUrl && (
                      <button
                        onClick={() => {
                          const a = document.createElement("a");
                          a.href = seg.videoUrl!;
                          a.download = `script-seg${idx + 1}.mp4`;
                          a.click();
                        }}
                        className="p-1 text-gray-400 hover:text-white"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="aspect-video bg-black flex items-center justify-center">
                    {seg.status === "draft" && (
                      <p className="text-xs text-gray-600">等待生成</p>
                    )}
                    {seg.status === "generating" && (
                      <div className="text-center">
                        <RefreshCw className="w-8 h-8 animate-spin text-brand-500 mx-auto mb-2" />
                        <p className="text-xs text-gray-400">AI 影片生成中...</p>
                      </div>
                    )}
                    {seg.status === "done" && seg.videoUrl && (
                      <video
                        src={seg.videoUrl}
                        controls
                        className="w-full h-full object-contain"
                        preload="metadata"
                      />
                    )}
                    {seg.status === "error" && (
                      <div className="text-center px-4">
                        <p className="text-xs text-red-400 font-medium">生成失敗</p>
                        <p className="text-[10px] text-red-500 mt-1">{seg.error}</p>
                      </div>
                    )}
                  </div>

                  {seg.description && (
                    <div className="px-3 py-1.5 border-t border-gray-700">
                      <p className="text-[11px] text-gray-400">{seg.description}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
