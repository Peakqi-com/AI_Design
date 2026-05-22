import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Download,
  Image as ImageIcon,
  Loader2,
  Send,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { resolveClientUserScopeId } from "@/lib/client/user-scope";
import { useCredits } from "@/lib/client/use-credits";
import { formatCredits } from "@/lib/credits/store";

interface ChatMessage {
  id: string;
  role: "user" | "ai";
  text: string;
  imageUrl?: string;
  uploadedImageUrl?: string;
  timestamp: string;
}

const uid = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const toDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("讀取失敗"));
    reader.readAsDataURL(file);
  });

export const AIChatImage: React.FC = () => {
  const { data: session } = useSession();
  const credits = useCredits();
  const [userScopeId, setUserScopeId] = useState("guest_server");
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem("ai-chat-history");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [insufficientMsg, setInsufficientMsg] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState("");
  const [selectedStyle, setSelectedStyle] = useState("");
  const [selectedRatio, setSelectedRatio] = useState("1:1");

  const RATIO_OPTIONS = [
    { id: "1:1", label: "1:1", hint: "正方形" },
    { id: "16:9", label: "16:9", hint: "橫向" },
    { id: "9:16", label: "9:16", hint: "直立" },
    { id: "4:3", label: "4:3", hint: "標準" },
    { id: "3:4", label: "3:4", hint: "直立標準" },
  ];
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const IMAGE_TYPES = [
    { id: "colored-handdrawn", label: "彩色平面圖-手繪", refImg: "/ref/colored-handdrawn.jpg", prompt: "Convert to hand-drawn watercolor architectural floor plan, flat 2D top-down, warm colors. MATCH the exact style shown in the reference image." },
    { id: "colored-cartoon", label: "彩色平面圖-卡通", refImg: "/ref/colored-cartoon.jpg", prompt: "Convert to colorful cartoon floor plan illustration, flat 2D, bright saturated colors. MATCH the exact style shown in the reference image." },
    { id: "colored-noshadow", label: "彩色平面圖-無陰影", refImg: "/ref/colored-noshadow.jpg", prompt: "Convert to clean CAD-style colored floor plan, flat solid fills, no shadows. MATCH the exact style shown in the reference image." },
    { id: "colored-realistic", label: "彩色平面圖-擬真", refImg: "/ref/colored-realistic.jpg", prompt: "Convert to photorealistic top-down rendered floor plan with real material textures. MATCH the exact style shown in the reference image." },
    { id: "section-top", label: "剖透圖-上視角度", refImg: "/ref/section-top.jpg", prompt: "Create 3D cutaway floor plan from directly above, walls cut at 1m, 3D furniture. MATCH the exact camera angle and style shown in the reference image." },
    { id: "section-birds-eye", label: "剖透圖-俯視角度", refImg: "/ref/section-birds-eye.jpg", prompt: "Create 3D bird's-eye view floor plan, camera at 60° elevation, visible wall sides. MATCH the exact camera angle and style shown in the reference image." },
    { id: "section-oblique", label: "剖透圖-斜角度", refImg: "/ref/section-oblique.webp", prompt: "Create 3D isometric cutaway from diagonal corner at 45°, full wall heights visible. MATCH the exact camera angle and style shown in the reference image." },
    { id: "section-3d", label: "剖透圖-立體模型", refImg: "/ref/section-3d.jpg", prompt: "Create photorealistic 3D dollhouse model, roof removed, maximum detail, studio lighting. MATCH the exact style shown in the reference image." },
  ];

  const STYLE_OPTIONS = [
    { id: "japanese", label: "日式和風", prompt: "Japanese minimalist zen style, natural wood, tatami, shoji screens" },
    { id: "nordic", label: "北歐簡約", prompt: "Scandinavian Nordic style, light wood, white walls, cozy textiles" },
    { id: "modern", label: "現代簡約", prompt: "Modern minimalist style, clean lines, neutral tones, open space" },
    { id: "industrial", label: "工業風", prompt: "Industrial loft style, exposed brick, metal, concrete, Edison bulbs" },
    { id: "luxury", label: "輕奢華", prompt: "Light luxury style, marble, gold accents, velvet, crystal chandelier" },
    { id: "wabi-sabi", label: "侘寂風", prompt: "Wabi-sabi style, imperfect beauty, natural materials, muted earth tones" },
    { id: "muji", label: "無印風", prompt: "MUJI style, ultra-minimal, white oak, white linen, hidden storage" },
    { id: "retro", label: "復古美式", prompt: "American vintage retro style, warm colors, classic furniture, patterned wallpaper" },
  ];
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const u = session?.user as { id?: string; email?: string | null } | undefined;
    setUserScopeId(resolveClientUserScopeId(u?.id || null, u?.email || null));
  }, [session?.user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    // Persist chat history (keep last 50 messages, skip large image data)
    try {
      const toSave = messages.slice(-50).map((m) => ({
        ...m,
        // Don't persist uploaded images (too large for localStorage)
        uploadedImageUrl: undefined,
      }));
      localStorage.setItem("ai-chat-history", JSON.stringify(toSave));
    } catch { /* storage full */ }
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text && !uploadedImage) return;
    if (isGenerating) return;

    // Credit check
    const deduction = await credits.tryDeduct("ai-render");
    if (!deduction.ok) {
      setInsufficientMsg(deduction.error || "點數不足");
      return;
    }
    setInsufficientMsg(null);

    // Build prompt with type + style + user text
    const typeInfo = IMAGE_TYPES.find((t) => t.id === selectedType);
    const styleInfo = STYLE_OPTIONS.find((s) => s.id === selectedStyle);
    const promptParts = [
      typeInfo ? typeInfo.prompt : "",
      styleInfo ? styleInfo.prompt : "",
      selectedRatio !== "1:1" ? `Output image aspect ratio: ${selectedRatio}` : "",
      text,
    ].filter(Boolean);
    const fullPrompt = promptParts.join(". ") || "根據上傳的圖片，生成一張高品質的室內設計效果圖";

    const displayText = [
      typeInfo ? `[${typeInfo.label}]` : "",
      styleInfo ? `[${styleInfo.label}]` : "",
      text,
    ].filter(Boolean).join(" ");

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      text: displayText || (uploadedImage ? "請根據這張圖片生成設計圖" : ""),
      uploadedImageUrl: uploadedImage || undefined,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    const currentImage = uploadedImage;
    setUploadedImage(null);
    setIsGenerating(true);

    try {
      // Fetch reference image as base64 if a type is selected
      let refImageBase64: string | undefined;
      if (typeInfo?.refImg) {
        try {
          const refRes = await fetch(typeInfo.refImg);
          if (refRes.ok) {
            const blob = await refRes.blob();
            refImageBase64 = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => resolve("");
              reader.readAsDataURL(blob);
            });
          }
        } catch { /* ignore */ }
      }

      // When no user image: use reference as main image, disable strict identity check
      const hasUserImage = Boolean(currentImage);
      const mainImage = hasUserImage
        ? currentImage
        : (refImageBase64 || "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==");

      const res = await fetch("/api/ai/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: mainImage,
          referenceDressImageDataUrl: hasUserImage ? (refImageBase64 || undefined) : undefined,
          roomType: "全室整合",
          style: typeInfo?.label || "AI 對話生圖",
          customPrompt: fullPrompt,
          creativity: hasUserImage ? 20 : 50,
          lockFace: false,
          preserveIdentityStrict: false,
        }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || `AI 回傳錯誤（${res.status}）`);
      }

      const aiMsg: ChatMessage = {
        id: uid(),
        role: "ai",
        text: data.summary || (data.imageDataUrl ? "圖片已生成" : "AI 未回傳圖片，請調整描述重試"),
        imageUrl: data.imageDataUrl || undefined,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, aiMsg]);

      // Save to media library
      if (data.imageDataUrl) {
        const blob = await fetch(data.imageDataUrl).then((r) => r.blob());
        const file = new File([blob], `ai-chat-${Date.now()}.jpg`, { type: "image/jpeg" });
        const formData = new FormData();
        formData.append("userId", userScopeId);
        formData.append("kind", "image");
        formData.append("file", file);
        formData.append("meta", JSON.stringify({
          origin: "ai-studio",
          summary: data.summary || "AI 對話生圖",
          style: "AI 對話生圖",
          prompt: text,
          generationPrompt: text,
          model: data.model || "Gemini",
        }));
        fetch("/api/social/assets", { method: "POST", body: formData }).catch(() => {});
      }
    } catch (err) {
      const aiMsg: ChatMessage = {
        id: uid(),
        role: "ai",
        text: `生成失敗：${err instanceof Error ? err.message : "請重試"}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } finally {
      setIsGenerating(false);
    }
  }, [input, uploadedImage, isGenerating, credits, userScopeId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await toDataUrl(file);
    setUploadedImage(dataUrl);
    e.target.value = "";
  };

  const handleDownload = (url: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-design-${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex gap-4">
      {/* Left: Chat area */}
      <div className="flex-1 flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between shrink-0">
        <div>
          <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-600" /> AI 對話生圖
          </h3>
          <p className="text-[11px] text-gray-500 mt-0.5">輸入描述或上傳圖片，AI 即時生成室內設計圖</p>
        </div>
        <div className="text-xs text-gray-400">
          剩餘 <span className="font-bold text-brand-600">{formatCredits(credits.credits)}</span> 點
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-gray-400 max-w-md">
              <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium text-gray-600">開始對話</p>
              <p className="text-sm mt-2">描述你想要的室內設計，或上傳平面圖/照片讓 AI 生成效果圖</p>
              <div className="mt-6 grid grid-cols-2 gap-2 text-left">
                {[
                  "幫我生成一個北歐風客廳的效果圖",
                  "把這張平面圖轉成彩色手繪風格",
                  "生成一個現代簡約風的主臥室",
                  "把這個空間改成工業風格",
                ].map((hint) => (
                  <button
                    key={hint}
                    onClick={() => setInput(hint)}
                    className="text-xs text-left px-3 py-2 bg-gray-50 hover:bg-brand-50 border border-gray-200 hover:border-brand-300 rounded-lg text-gray-600 hover:text-brand-700 transition-colors"
                  >
                    {hint}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[75%] ${msg.role === "user" ? "order-last" : ""}`}>
              {/* User uploaded image */}
              {msg.uploadedImageUrl && (
                <div className="mb-2">
                  <img
                    src={msg.uploadedImageUrl}
                    alt="uploaded"
                    className="max-w-xs max-h-48 rounded-lg border border-gray-200 cursor-pointer"
                    onClick={() => setPreviewImage(msg.uploadedImageUrl!)}
                  />
                </div>
              )}

              {/* Text bubble */}
              <div
                className={`rounded-2xl px-4 py-2.5 ${
                  msg.role === "user"
                    ? "bg-brand-600 text-white rounded-br-md"
                    : "bg-gray-100 text-gray-800 rounded-bl-md"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
              </div>

              {/* AI generated image */}
              {msg.imageUrl && (
                <div className="mt-2 relative group">
                  <img
                    src={msg.imageUrl}
                    alt="generated"
                    className="max-w-full rounded-lg border border-gray-200 shadow-md cursor-pointer"
                    onClick={() => setPreviewImage(msg.imageUrl!)}
                  />
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleDownload(msg.imageUrl!)}
                      className="p-1.5 bg-black/50 hover:bg-black/70 rounded-lg text-white backdrop-blur-sm"
                      title="下載"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              <p className="text-[10px] text-gray-400 mt-1 px-1">
                {new Date(msg.timestamp).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>
        ))}

        {isGenerating && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-brand-600" />
              <span className="text-sm text-gray-500">AI 生成中...</span>
            </div>
          </div>
        )}

        {insufficientMsg && (
          <div className="mx-auto max-w-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 text-center">
            {insufficientMsg}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Upload preview */}
      {uploadedImage && (
        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 flex items-center gap-3">
          <div className="relative">
            <img src={uploadedImage} alt="upload" className="h-16 rounded-lg border border-gray-200" />
            <button
              onClick={() => setUploadedImage(null)}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <p className="text-xs text-gray-500">已附加圖片，輸入指令後送出</p>
        </div>
      )}

      {/* Input bar */}
      <div className="px-4 py-3 border-t border-gray-200 bg-white shrink-0">
        <div className="flex items-end gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-xl transition-colors shrink-0"
            title="上傳圖片"
          >
            <Upload className="w-5 h-5" />
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="描述你想要的室內設計... 例如：北歐風三房兩廳、現代簡約臥室"
            className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-2.5 resize-none max-h-24 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"
            rows={1}
          />

          <button
            onClick={() => void handleSend()}
            disabled={isGenerating || (!input.trim() && !uploadedImage)}
            className="p-2.5 bg-brand-600 text-white rounded-xl hover:bg-brand-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5 text-center">
          每張生成消耗 0.55 點 · 使用 Gemini 模型 · 生成的圖片自動儲存到媒體庫
        </p>
      </div>

      </div> {/* end left chat panel */}

      {/* Right: Tool panel */}
      <div className="w-72 shrink-0 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden hidden lg:flex">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <p className="text-sm font-bold text-gray-800">生成設定</p>
          <p className="text-[10px] text-gray-500 mt-0.5">選擇類型和風格後，直接影響生成結果</p>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Image type with thumbnails */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2">圖片類型</p>
            <div className="grid grid-cols-2 gap-1.5">
              {IMAGE_TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedType(selectedType === t.id ? "" : t.id)}
                  className={`rounded-lg overflow-hidden transition-all ${
                    selectedType === t.id
                      ? "ring-2 ring-brand-500 ring-offset-1"
                      : "border border-gray-200 hover:border-brand-300"
                  }`}
                >
                  <div className="aspect-[4/3] bg-gray-100">
                    <img src={t.refImg} alt={t.label} className="w-full h-full object-cover" />
                  </div>
                  <p className={`text-[10px] px-1.5 py-1 text-center truncate ${
                    selectedType === t.id ? "bg-brand-50 text-brand-700 font-semibold" : "text-gray-600"
                  }`}>
                    {t.label}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Style */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2">設計風格</p>
            <div className="grid grid-cols-2 gap-1">
              {STYLE_OPTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedStyle(selectedStyle === s.id ? "" : s.id)}
                  className={`px-2 py-1.5 rounded-lg text-[11px] text-center transition-colors ${
                    selectedStyle === s.id
                      ? "bg-brand-50 text-brand-700 border border-brand-300 font-semibold"
                      : "text-gray-600 hover:bg-gray-50 border border-gray-200"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Aspect ratio */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2">生成比例</p>
            <div className="flex gap-1">
              {RATIO_OPTIONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRatio(r.id)}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] text-center transition-colors ${
                    selectedRatio === r.id
                      ? "bg-brand-50 text-brand-700 border border-brand-300 font-semibold"
                      : "text-gray-500 hover:bg-gray-50 border border-gray-200"
                  }`}
                >
                  <span className="block font-medium">{r.label}</span>
                  <span className="block text-[9px] text-gray-400">{r.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Selected summary */}
          {(selectedType || selectedStyle) && (
            <div className="bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 text-[11px] text-brand-700">
              <p className="font-semibold mb-0.5">目前選擇：</p>
              {selectedType && <p>類型：{IMAGE_TYPES.find((t) => t.id === selectedType)?.label}</p>}
              {selectedStyle && <p>風格：{STYLE_OPTIONS.find((s) => s.id === selectedStyle)?.label}</p>}
              <p className="text-brand-500 mt-1">輸入文字或上傳圖片後送出即可生成</p>
            </div>
          )}

          {/* Quick actions */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2">快速生成</p>
            <div className="space-y-1">
              {[
                { label: "北歐風客廳效果圖", type: "", style: "nordic" },
                { label: "日式和風臥室", type: "", style: "japanese" },
                { label: "現代簡約開放式廚房", type: "", style: "modern" },
                { label: "工業風 Loft 空間", type: "", style: "industrial" },
              ].map((q) => (
                <button
                  key={q.label}
                  onClick={() => {
                    setInput(q.label);
                    if (q.style) setSelectedStyle(q.style);
                    if (q.type) setSelectedType(q.type);
                  }}
                  className="w-full text-left px-2.5 py-1.5 text-[11px] text-gray-500 hover:bg-brand-50 hover:text-brand-700 rounded-lg border border-gray-100 transition-colors"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Fullscreen preview */}
      {previewImage && (
        <div
          className="fixed inset-0 z-[120] bg-black/85 flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <img src={previewImage} alt="preview" className="max-w-full max-h-[85vh] object-contain rounded-lg" />
            <div className="absolute top-3 right-3 flex gap-2">
              <button
                onClick={() => handleDownload(previewImage)}
                className="p-2 bg-white/20 hover:bg-white/40 backdrop-blur-sm rounded-lg text-white"
              >
                <Download className="w-5 h-5" />
              </button>
              <button
                onClick={() => setPreviewImage(null)}
                className="p-2 bg-white/20 hover:bg-white/40 backdrop-blur-sm rounded-lg text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
