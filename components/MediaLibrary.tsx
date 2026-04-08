import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Download, Film, FolderOpen, Image as ImageIcon, RefreshCw, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { resolveClientUserScopeId } from "@/lib/client/user-scope";

interface AssetMeta {
  origin?: string;
  summary?: string;
  style?: string;
  roomType?: string;
  model?: string;
  packageId?: string;
  packageLabel?: string;
  slotLabel?: string;
  prompt?: string;
  generationPrompt?: string;
  aspectRatio?: string;
  durationSec?: number;
}

interface MediaAsset {
  id: string;
  kind: "image" | "video";
  url: string;
  createdAt: string;
  deletedAt?: string;
  meta?: AssetMeta;
}

interface AssetPackage {
  packageId: string;
  packageLabel: string;
  items: MediaAsset[];
  createdAt: string;
}

type Tab = "single" | "packages" | "videos" | "trash";

export const MediaLibrary: React.FC = () => {
  const { data: session } = useSession();
  const [userScopeId, setUserScopeId] = useState("guest_server");
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("single");
  const [expandedPackageId, setExpandedPackageId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<MediaAsset | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [trashItems, setTrashItems] = useState<MediaAsset[]>([]);
  const [isTrashLoading, setIsTrashLoading] = useState(false);

  useEffect(() => {
    const sessionUser = session?.user as { id?: string; email?: string | null } | undefined;
    setUserScopeId(resolveClientUserScopeId(sessionUser?.id || null, sessionUser?.email || null));
  }, [session?.user]);

  const loadAssets = useCallback(async () => {
    if (!userScopeId) return;
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/social/assets?userId=${encodeURIComponent(userScopeId)}&limit=200`
      );
      const data = (await res.json()) as { items?: MediaAsset[] };
      setAssets(data.items || []);
    } catch {
      // 忽略載入錯誤
    } finally {
      setIsLoading(false);
    }
  }, [userScopeId]);

  const loadTrash = useCallback(async () => {
    if (!userScopeId) return;
    setIsTrashLoading(true);
    try {
      const res = await fetch(`/api/social/assets?userId=${encodeURIComponent(userScopeId)}&limit=200&trash=1`);
      const data = (await res.json()) as { items?: MediaAsset[] };
      setTrashItems(data.items || []);
    } catch {
      // ignore
    } finally {
      setIsTrashLoading(false);
    }
  }, [userScopeId]);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Check file sizes before upload
    const MAX_FILE_SIZE = 4.5 * 1024 * 1024; // Vercel free plan: 4.5MB body limit
    for (let i = 0; i < files.length; i++) {
      if (files[i].size > MAX_FILE_SIZE) {
        alert(`檔案 "${files[i].name}" 太大（${(files[i].size / 1024 / 1024).toFixed(1)} MB）。\n單檔上限 4.5 MB（Vercel 限制）。\n建議先壓縮後再上傳。`);
        e.target.value = "";
        return;
      }
    }

    setIsUploading(true);
    let successCount = 0;
    let lastError = "";
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const kind = file.type.startsWith("video/") ? "video" : "image";
        const formData = new FormData();
        formData.append("userId", userScopeId);
        formData.append("kind", kind);
        formData.append("file", file);
        formData.append("meta", JSON.stringify({
          origin: "manual-upload",
          summary: file.name,
        }));
        try {
          const res = await fetch("/api/social/assets", { method: "POST", body: formData });
          if (res.ok) {
            successCount++;
          } else {
            let errMsg = `上傳 ${file.name} 失敗（${res.status}）`;
            try {
              const errData = await res.json();
              if ((errData as { error?: string }).error) errMsg = (errData as { error: string }).error;
            } catch {
              if (res.status === 413) errMsg = `${file.name} 太大，超過伺服器上傳限制`;
            }
            lastError = errMsg;
          }
        } catch (fetchErr) {
          lastError = `上傳 ${file.name} 失敗：${fetchErr instanceof Error ? fetchErr.message : "網路錯誤"}`;
        }
      }
      if (successCount > 0) {
        // Reload assets list
        try {
          const res = await fetch(`/api/social/assets?userId=${encodeURIComponent(userScopeId)}&limit=200`);
          const data = (await res.json()) as { items?: MediaAsset[] };
          setAssets(data.items || []);
        } catch { /* ignore reload error */ }
      }
      if (lastError) {
        alert(lastError);
      }
    } catch (err) {
      alert(`上傳失敗：${err instanceof Error ? err.message : "網路錯誤"}`);
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  }, [userScopeId]);

  const handleDelete = useCallback(async (assetId: string) => {
    await fetch(`/api/social/assets?userId=${encodeURIComponent(userScopeId)}&assetId=${encodeURIComponent(assetId)}`, { method: "DELETE" });
    setAssets((prev) => prev.filter((a) => a.id !== assetId));
  }, [userScopeId]);

  const handleRestore = useCallback(async (assetId: string) => {
    await fetch(`/api/social/assets?userId=${encodeURIComponent(userScopeId)}&assetId=${encodeURIComponent(assetId)}`, { method: "PATCH" });
    setTrashItems((prev) => prev.filter((a) => a.id !== assetId));
    void loadAssets();
  }, [userScopeId, loadAssets]);

  const handlePermanentDelete = useCallback(async (assetId: string) => {
    await fetch(`/api/social/assets?userId=${encodeURIComponent(userScopeId)}&assetId=${encodeURIComponent(assetId)}&permanent=1`, { method: "DELETE" });
    setTrashItems((prev) => prev.filter((a) => a.id !== assetId));
  }, [userScopeId]);

  const handleEmptyTrash = useCallback(async () => {
    if (!confirm("確定要清除所有垃圾桶內容嗎？此操作無法復原。")) return;
    await fetch(`/api/social/assets?userId=${encodeURIComponent(userScopeId)}&action=empty-trash`, { method: "DELETE" });
    setTrashItems([]);
  }, [userScopeId]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  useEffect(() => {
    if (activeTab === "trash") void loadTrash();
  }, [activeTab, loadTrash]);

  // 分類素材
  const singleImages = assets.filter(
    (a) => a.kind === "image" && a.meta?.origin === "ai-studio" && !a.meta?.packageId
  );
  const packagedImages = assets.filter(
    (a) => a.kind === "image" && Boolean(a.meta?.packageId)
  );
  const videos = assets.filter((a) => a.kind === "video");

  // 依 packageId 分組
  const packageMap = packagedImages.reduce<Record<string, AssetPackage>>((acc, item) => {
    const pid = item.meta!.packageId!;
    if (!acc[pid]) {
      acc[pid] = {
        packageId: pid,
        packageLabel: item.meta?.packageLabel || pid,
        items: [],
        createdAt: item.createdAt,
      };
    }
    acc[pid].items.push(item);
    return acc;
  }, {});
  const packageList = Object.values(packageMap).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const handleDownload = (url: string, name: string) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
  };

  const tabCls = (tab: Tab) =>
    `flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
      activeTab === tab
        ? "bg-brand-600 text-white shadow-sm"
        : "text-gray-600 hover:bg-gray-100"
    }`;

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col gap-4">
      {/* 頂部標題列 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">媒體庫</h2>
          <p className="text-xs text-gray-500 mt-0.5">所有 AI 生成的圖片與影片集中管理</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => uploadInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
          >
            {isUploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {isUploading ? "上傳中..." : "上傳檔案"}
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={handleUpload}
          />
          <button
            onClick={loadAssets}
            disabled={isLoading}
            className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-700 transition-colors"
            title="重新整理"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* 分頁 Tab */}
      <div className="flex items-center gap-1.5 bg-white rounded-xl border border-gray-200 p-1.5 w-fit">
        <button onClick={() => setActiveTab("single")} className={tabCls("single")}>
          <ImageIcon className="w-3.5 h-3.5" />
          單張生成（{singleImages.length}）
        </button>
        <button onClick={() => setActiveTab("packages")} className={tabCls("packages")}>
          <FolderOpen className="w-3.5 h-3.5" />
          多視角方案（{packageList.length}）
        </button>
        <button onClick={() => setActiveTab("videos")} className={tabCls("videos")}>
          <Film className="w-3.5 h-3.5" />
          影片（{videos.length}）
        </button>
        <button onClick={() => setActiveTab("trash")} className={tabCls("trash")}>
          <Trash2 className="w-3.5 h-3.5" />
          垃圾桶{trashItems.length > 0 ? `（${trashItems.length}）` : ""}
        </button>
      </div>

      {/* 內容區 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <RefreshCw className="w-6 h-6 animate-spin text-brand-600" />
          </div>
        ) : (
          <>
            {/* 單張生成 */}
            {activeTab === "single" && (
              singleImages.length === 0 ? (
                <EmptyState icon={<ImageIcon className="w-10 h-10 opacity-20" />} label="尚無單張生成紀錄" hint="至「AI 空間渲染」生成單張渲染圖後會顯示在這裡" />
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {singleImages.map((item) => (
                    <ImageCard key={item.id} item={item} onPreview={setPreviewItem} onDownload={handleDownload} onDelete={handleDelete} />
                  ))}
                </div>
              )
            )}

            {/* 多視角方案（資料夾） */}
            {activeTab === "packages" && (
              packageList.length === 0 ? (
                <EmptyState icon={<FolderOpen className="w-10 h-10 opacity-20" />} label="尚無多視角方案" hint="使用「多視角輸出」模式生成後會自動建立方案資料夾" />
              ) : (
                <div className="space-y-3">
                  {packageList.map((pkg) => (
                    <div key={pkg.packageId} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                      {/* 資料夾標頭 */}
                      <button
                        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                        onClick={() =>
                          setExpandedPackageId(expandedPackageId === pkg.packageId ? null : pkg.packageId)
                        }
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-brand-100 rounded-lg flex items-center justify-center shrink-0">
                            <FolderOpen className="w-4 h-4 text-brand-600" />
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-semibold text-gray-800">{pkg.packageLabel}</p>
                            <p className="text-[11px] text-gray-500">
                              {pkg.items.length} 張圖 · {new Date(pkg.createdAt).toLocaleDateString("zh-TW")}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {pkg.items.slice(0, 4).map((item) => (
                            <img
                              key={item.id}
                              src={item.url}
                              alt=""
                              className="w-9 h-9 rounded-md object-cover border border-gray-200 hidden sm:block"
                            />
                          ))}
                          <span className="text-xs text-gray-400 ml-1 shrink-0">
                            {expandedPackageId === pkg.packageId ? "▲" : "▼"}
                          </span>
                        </div>
                      </button>

                      {/* 展開後的圖片 */}
                      {expandedPackageId === pkg.packageId && (
                        <div className="px-4 pb-4 border-t border-gray-100 bg-gray-50/50">
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mt-3">
                            {pkg.items.map((item) => (
                              <ImageCard
                                key={item.id}
                                item={item}
                                onPreview={setPreviewItem}
                                onDownload={handleDownload}
                                onDelete={handleDelete}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            )}

            {/* 影片 */}
            {activeTab === "videos" && (
              videos.length === 0 ? (
                <EmptyState icon={<Film className="w-10 h-10 opacity-20" />} label="尚無影片生成紀錄" hint="至「空間動態影片」生成影片後會顯示在這裡" />
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {videos.map((item) => (
                    <VideoCard key={item.id} item={item} onDownload={handleDownload} onDelete={handleDelete} onPreview={setPreviewItem} />
                  ))}
                </div>
              )
            )}

            {/* 垃圾桶 */}
            {activeTab === "trash" && (
              isTrashLoading ? (
                <div className="flex items-center justify-center h-40">
                  <RefreshCw className="w-6 h-6 animate-spin text-brand-600" />
                </div>
              ) : trashItems.length === 0 ? (
                <EmptyState icon={<Trash2 className="w-10 h-10 opacity-20" />} label="垃圾桶是空的" hint="刪除的素材會保留 30 天，到期後自動永久刪除" />
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">共 {trashItems.length} 個項目・30 天後自動永久刪除</p>
                    <button
                      onClick={() => void handleEmptyTrash()}
                      className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-3 py-1 rounded-lg transition-colors"
                    >
                      清除垃圾桶
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {trashItems.map((item) => (
                      <TrashCard
                        key={item.id}
                        item={item}
                        onRestore={handleRestore}
                        onPermanentDelete={handlePermanentDelete}
                      />
                    ))}
                  </div>
                </div>
              )
            )}
          </>
        )}
      </div>

      {/* 預覽 Modal */}
      {previewItem && (
        <div
          className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setPreviewItem(null)}
        >
          <div
            className="relative max-w-4xl w-full bg-white rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  {previewItem.meta?.slotLabel || previewItem.meta?.style || "生成圖片"}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {[previewItem.meta?.roomType, new Date(previewItem.createdAt).toLocaleString("zh-TW")]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownload(previewItem.url, previewItem.kind === "video" ? `video-${previewItem.id}.mp4` : `render-${previewItem.id}.png`)}
                  className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors"
                  title="下載"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setPreviewItem(null)}
                  className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="bg-gray-900 flex items-center justify-center p-4" style={{ maxHeight: "70vh" }}>
              {previewItem.kind === "video" ? (
                <video
                  src={previewItem.url}
                  controls
                  autoPlay
                  className="max-h-[65vh] max-w-full object-contain rounded-lg"
                />
              ) : (
                <img
                  src={previewItem.url}
                  alt="preview"
                  className="max-h-[65vh] max-w-full object-contain rounded-lg"
                />
              )}
            </div>
            {(previewItem.meta?.summary || previewItem.meta?.prompt || previewItem.meta?.generationPrompt) && (
              <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 max-h-36 overflow-y-auto space-y-2">
                {previewItem.meta?.summary && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-500 mb-0.5">AI 說明</p>
                    <p className="text-xs text-gray-700 leading-relaxed">{previewItem.meta.summary}</p>
                  </div>
                )}
                {(previewItem.meta?.generationPrompt || previewItem.meta?.prompt) && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-500 mb-0.5">使用的提示詞</p>
                    <p className="text-[11px] text-gray-600 leading-relaxed whitespace-pre-wrap break-all font-mono bg-white rounded px-2 py-1 border border-gray-200">
                      {previewItem.meta.generationPrompt || previewItem.meta.prompt}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── 輔助子元件 ────────────────────────────────────────────────────

const EmptyState: React.FC<{ icon: React.ReactNode; label: string; hint?: string }> = ({
  icon,
  label,
  hint,
}) => (
  <div className="flex flex-col items-center justify-center h-52 text-gray-400">
    {icon}
    <p className="text-sm font-medium mt-3">{label}</p>
    {hint && <p className="text-xs text-gray-400 mt-1 text-center max-w-xs">{hint}</p>}
  </div>
);

const ImageCard: React.FC<{
  item: MediaAsset;
  onPreview: (item: MediaAsset) => void;
  onDownload: (url: string, name: string) => void;
  onDelete?: (id: string) => void;
}> = ({ item, onPreview, onDownload, onDelete }) => (
  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden group hover:shadow-md transition-shadow">
    <button
      className="block w-full aspect-[4/3] bg-gray-100 overflow-hidden"
      onClick={() => onPreview(item)}
    >
      <img
        src={item.url}
        alt={item.meta?.slotLabel || item.meta?.style || "render"}
        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
      />
    </button>
    <div className="px-2.5 py-2 flex items-center justify-between gap-1">
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-gray-700 truncate">
          {item.meta?.slotLabel || item.meta?.style || "渲染圖"}
        </p>
        <p className="text-[10px] text-gray-400 truncate">
          {item.meta?.roomType
            ? `${item.meta.roomType} · `
            : ""}
          {new Date(item.createdAt).toLocaleDateString("zh-TW")}
        </p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDownload(item.url, `render-${item.id}.png`);
        }}
        className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-md shrink-0 transition-colors"
        title="下載"
      >
        <Download className="w-3.5 h-3.5" />
      </button>
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item.id);
          }}
          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md shrink-0 transition-colors"
          title="移至垃圾桶"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  </div>
);

const VideoCard: React.FC<{
  item: MediaAsset;
  onDownload: (url: string, name: string) => void;
  onDelete?: (id: string) => void;
  onPreview?: (item: MediaAsset) => void;
}> = ({ item, onDownload, onDelete, onPreview }) => (
  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden group hover:shadow-md transition-shadow cursor-pointer" onClick={() => onPreview?.(item)}>
    <div className="relative aspect-video bg-gray-900 overflow-hidden">
      <video
        src={item.url}
        className="w-full h-full object-contain"
        muted
        loop
        playsInline
        preload="metadata"
        onMouseEnter={(e) => void (e.currentTarget as HTMLVideoElement).play()}
        onMouseLeave={(e) => {
          const v = e.currentTarget as HTMLVideoElement;
          v.pause();
          v.currentTime = 0;
        }}
      />
      <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <Film className="w-8 h-8 text-white" />
      </div>
    </div>
    <div className="px-2.5 py-2 flex items-center justify-between gap-1">
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-gray-700 truncate">
          {item.meta?.style || "動態影片"}
        </p>
        <p className="text-[10px] text-gray-400">
          {item.meta?.aspectRatio ? `${item.meta.aspectRatio} · ` : ""}
          {new Date(item.createdAt).toLocaleDateString("zh-TW")}
        </p>
      </div>
      <button
        onClick={() => onDownload(item.url, `video-${item.id}.mp4`)}
        className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-md shrink-0 transition-colors"
        title="下載影片"
      >
        <Download className="w-3.5 h-3.5" />
      </button>
      {onDelete && (
        <button
          onClick={() => onDelete(item.id)}
          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md shrink-0 transition-colors"
          title="移至垃圾桶"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  </div>
);

const TrashCard: React.FC<{
  item: MediaAsset;
  onRestore: (id: string) => void;
  onPermanentDelete: (id: string) => void;
}> = ({ item, onRestore, onPermanentDelete }) => {
  const daysLeft = item.deletedAt
    ? Math.max(0, 30 - Math.floor((Date.now() - new Date(item.deletedAt).getTime()) / (1000 * 60 * 60 * 24)))
    : 30;
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden group opacity-75 hover:opacity-100 transition-opacity">
      <div className="aspect-[4/3] bg-gray-100 flex items-center justify-center overflow-hidden relative">
        {item.kind === "video" ? (
          <video src={item.url} className="w-full h-full object-contain" muted preload="metadata" />
        ) : (
          <img src={item.url} alt="trash" className="w-full h-full object-cover" />
        )}
        <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/60 text-white text-[9px] rounded">
          {daysLeft} 天後刪除
        </div>
      </div>
      <div className="px-2.5 py-2">
        <p className="text-[10px] text-gray-500 truncate mb-1.5">
          {item.meta?.slotLabel || item.meta?.style || (item.kind === "video" ? "影片" : "圖片")}
        </p>
        <div className="flex gap-1.5">
          <button
            onClick={() => onRestore(item.id)}
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[11px] bg-brand-50 text-brand-700 hover:bg-brand-100 rounded-md transition-colors"
            title="還原"
          >
            <RotateCcw className="w-3 h-3" /> 還原
          </button>
          <button
            onClick={() => {
              if (confirm("確定永久刪除？此操作無法復原。")) onPermanentDelete(item.id);
            }}
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[11px] bg-red-50 text-red-600 hover:bg-red-100 rounded-md transition-colors"
            title="永久刪除"
          >
            <Trash2 className="w-3 h-3" /> 永久刪除
          </button>
        </div>
      </div>
    </div>
  );
};
