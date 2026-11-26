import React, { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Paintbrush, Plus, RefreshCw, RotateCcw, Send, X } from "lucide-react";

interface SlotImageEditorProps {
  imageDataUrl: string;
  slotLabel: string;
  onApply: (annotatedImageDataUrl: string, prompt: string) => Promise<void>;
  onClose: () => void;
}

export const SlotImageEditor: React.FC<SlotImageEditorProps> = ({
  imageDataUrl,
  slotLabel,
  onApply,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(24);
  const [prompt, setPrompt] = useState("");
  const [isApplying, setIsApplying] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  // Load image into canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const maxW = 900;
      const maxH = 650;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxW || h > maxH) {
        const scale = Math.min(maxW / w, maxH / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);
      imgRef.current = img;
      setCanvasReady(true);
    };
    img.src = imageDataUrl;
  }, [imageDataUrl]);

  const getCanvasXY = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return [(clientX - rect.left) * scaleX, (clientY - rect.top) * scaleY];
    },
    [],
  );

  const drawDot = useCallback(
    (x: number, y: number) => {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "rgba(255, 50, 50, 0.4)";
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    },
    [brushSize],
  );

  const drawLine = useCallback(
    (x0: number, y0: number, x1: number, y1: number) => {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      ctx.strokeStyle = "rgba(255, 50, 50, 0.4)";
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    },
    [brushSize],
  );

  // Mouse events
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      setIsDrawing(true);
      setHasDrawn(true);
      const [x, y] = getCanvasXY(e.clientX, e.clientY);
      drawDot(x, y);
      lastPosRef.current = { x, y };
    },
    [getCanvasXY, drawDot],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawing || !lastPosRef.current) return;
      const [x, y] = getCanvasXY(e.clientX, e.clientY);
      drawLine(lastPosRef.current.x, lastPosRef.current.y, x, y);
      lastPosRef.current = { x, y };
    },
    [isDrawing, getCanvasXY, drawLine],
  );

  const handleMouseUp = useCallback(() => {
    setIsDrawing(false);
    lastPosRef.current = null;
  }, []);

  // Touch events
  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const touch = e.touches[0];
      setIsDrawing(true);
      setHasDrawn(true);
      const [x, y] = getCanvasXY(touch.clientX, touch.clientY);
      drawDot(x, y);
      lastPosRef.current = { x, y };
    },
    [getCanvasXY, drawDot],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (!isDrawing || !lastPosRef.current) return;
      const touch = e.touches[0];
      const [x, y] = getCanvasXY(touch.clientX, touch.clientY);
      drawLine(lastPosRef.current.x, lastPosRef.current.y, x, y);
      lastPosRef.current = { x, y };
    },
    [isDrawing, getCanvasXY, drawLine],
  );

  const handleTouchEnd = useCallback(() => {
    setIsDrawing(false);
    lastPosRef.current = null;
  }, []);

  // Clear all annotations
  const handleClear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const img = imgRef.current;
    if (!canvas || !ctx || !img) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }, []);

  // Merge canvas and send
  const handleApply = useCallback(async () => {
    if (!prompt.trim()) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsApplying(true);
    try {
      const annotatedDataUrl = canvas.toDataURL("image/jpeg", 0.92);
      await onApply(annotatedDataUrl, prompt.trim());
    } finally {
      setIsApplying(false);
    }
  }, [prompt, onApply]);

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[94vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
          <div>
            <p className="text-sm font-semibold text-gray-800">
              局部調整：{slotLabel}
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              用滑鼠在圖片上塗抹標示要修改的區域（紅色），再輸入調整指令
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Canvas area */}
        <div className="flex-1 min-h-0 flex items-center justify-center bg-gray-900 p-4 overflow-auto">
          {!canvasReady && (
            <div className="text-gray-400 text-sm animate-pulse">載入圖片中...</div>
          )}
          <canvas
            ref={canvasRef}
            className={`max-w-full max-h-full rounded-lg shadow-lg ${!canvasReady ? "hidden" : ""}`}
            style={{ cursor: "crosshair", touchAction: "none" }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          />
        </div>

        {/* Tools + Prompt */}
        <div className="shrink-0 border-t border-gray-100 bg-gray-50 px-5 py-3 space-y-2.5">
          {/* Brush tools */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-gray-600">
              <Paintbrush className="w-3.5 h-3.5" />
              <span>筆刷大小</span>
            </div>
            <button
              onClick={() => setBrushSize((s) => Math.max(8, s - 8))}
              className="p-1 hover:bg-gray-200 rounded text-gray-500"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center gap-1.5">
              <div
                className="rounded-full bg-red-400/40 border border-red-300"
                style={{ width: Math.min(32, brushSize), height: Math.min(32, brushSize) }}
              />
              <span className="text-xs text-gray-500 w-8 text-center">{brushSize}px</span>
            </div>
            <button
              onClick={() => setBrushSize((s) => Math.min(80, s + 8))}
              className="p-1 hover:bg-gray-200 rounded text-gray-500"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <div className="w-px h-5 bg-gray-200 mx-1" />
            <button
              onClick={handleClear}
              disabled={!hasDrawn}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-200 rounded-lg disabled:opacity-40 transition-colors"
            >
              <RotateCcw className="w-3 h-3" /> 清除標記
            </button>
            {!hasDrawn && (
              <p className="text-[11px] text-amber-600 ml-2">
                請先在圖上塗抹要修改的區域
              </p>
            )}
          </div>

          {/* Prompt input + Apply button */}
          <div className="flex gap-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述標記區域要做什麼調整... 例如：這個區域改成木紋地板、把這裡的沙發換成 L 型、移除這張桌子、這裡的牆面改為灰色"
              className="flex-1 text-sm border-gray-200 rounded-lg p-2.5 bg-white border h-14 resize-none"
            />
            <button
              onClick={() => void handleApply()}
              disabled={!prompt.trim() || !hasDrawn || isApplying}
              className="px-5 py-2 bg-brand-600 text-white rounded-lg font-medium text-sm hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 flex items-center gap-2"
            >
              {isApplying ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> 調整中...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" /> 套用調整
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
