import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./Button";
import {
  Plus,
  Search,
  Calendar,
  User,
  DollarSign,
  Link2,
  X,
  Upload,
  Archive,
  Image as ImageIcon,
  Trash2,
  FolderArchive,
  CheckCircle,
} from "lucide-react";
import {
  Project,
  ProjectAuspiciousPlan,
  ProjectDressSelectionRecord,
  ProjectNotificationTemplate,
  ProjectQuotationItem,
  ProjectQuotationMeta,
  ProjectWorkflowTask,
} from "../types";

interface ProjectListProps {
  onSelectProject: (project: Project) => void;
}

type ProjectStatus = Project["status"];

interface ProjectApiItem {
  id: string;
  name: string;
  clientName: string;
  status: ProjectStatus;
  phase: string;
  budget: string;
  coverImageUrl: string;
  linkedContactId?: string;
  note?: string;
  lastSyncedToCrmAt?: string;
  archivedAt?: string;
  filedAt?: string;
  deletedAt?: string;
  deletePurgeAt?: string;
  quotationItems?: ProjectQuotationItem[];
  dressSelectionRecords?: ProjectDressSelectionRecord[];
  quotationMeta?: ProjectQuotationMeta;
  workflowTasks?: ProjectWorkflowTask[];
  auspiciousPlan?: ProjectAuspiciousPlan;
  notificationEmail?: string;
  notificationTemplates?: ProjectNotificationTemplate[];
  updatedAt: string;
}

interface CrmContactLite {
  id: string;
  displayName: string;
  source: "line" | "manual";
}

interface UploadAttachment {
  url?: string;
  dataUrl?: string;
  name?: string;
  mimeType?: string;
}

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "草稿",
  active: "進行中",
  quoted: "已報價",
  completed: "已結案",
};

const STATUS_BADGE: Record<ProjectStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  active: "bg-orange-100 text-orange-700",
  quoted: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
};

const mapProject = (item: ProjectApiItem): Project => ({
  id: item.id,
  name: item.name,
  client: item.clientName,
  status: item.status,
  phase: item.phase,
  budget: item.budget,
  date: new Date(item.updatedAt).toISOString().slice(0, 10),
  img: item.coverImageUrl,
  linkedContactId: item.linkedContactId,
  note: item.note,
  lastSyncedToCrmAt: item.lastSyncedToCrmAt,
  archivedAt: item.archivedAt,
  filedAt: item.filedAt,
  deletedAt: item.deletedAt,
  deletePurgeAt: item.deletePurgeAt,
  quotationItems: item.quotationItems || [],
  dressSelectionRecords: item.dressSelectionRecords || [],
  quotationMeta: item.quotationMeta,
  workflowTasks: item.workflowTasks || [],
  auspiciousPlan: item.auspiciousPlan,
  notificationEmail: item.notificationEmail,
  notificationTemplates: item.notificationTemplates || [],
});

const requestJson = async <T,>(input: RequestInfo, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, init);
  const raw = await response.text();
  const payload = raw ? (JSON.parse(raw) as T & { error?: string }) : ({} as T & { error?: string });
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
};

export const ProjectList: React.FC<ProjectListProps> = ({ onSelectProject }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [includeFiled, setIncludeFiled] = useState(true);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [crmContacts, setCrmContacts] = useState<CrmContactLite[]>([]);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const projectLoadSeqRef = useRef(0);
  const didFirstProjectLoadRef = useRef(false);
  const [form, setForm] = useState({
    name: "",
    clientName: "",
    status: "draft" as ProjectStatus,
    phase: "需求訪談",
    budget: "待定",
    coverImageUrl: "",
    linkedContactId: "",
    linkedContactIds: [] as string[],
    linkedAssetIds: [] as string[],
    note: "",
  });
  const [mediaAssets, setMediaAssets] = useState<Array<{ id: string; url: string; meta?: { slotLabel?: string; style?: string } }>>([]);

  const loadProjects = useCallback(
    async (searchKey: string, showArchived: boolean, showFiled: boolean, showDeleted: boolean) => {
    const currentSeq = ++projectLoadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchKey.trim()) {
        params.set("search", searchKey.trim());
      }
      if (showArchived) {
        params.set("includeArchived", "1");
      }
      if (showFiled) {
        params.set("includeFiled", "1");
      }
      if (showDeleted) {
        params.set("includeDeleted", "1");
      }
      const query = params.toString();
      const data = await requestJson<{ projects: ProjectApiItem[] }>(
        `/api/projects${query ? `?${query}` : ""}`,
      );
      if (currentSeq !== projectLoadSeqRef.current) {
        return;
      }
      setProjects(data.projects.map(mapProject));
    } catch (err) {
      if (currentSeq !== projectLoadSeqRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : "讀取專案失敗");
    } finally {
      if (currentSeq === projectLoadSeqRef.current) {
        setLoading(false);
      }
    }
    },
    [],
  );

  const loadContacts = useCallback(async () => {
    try {
      const data = await requestJson<{ contacts: CrmContactLite[] }>("/api/crm/contacts");
      setCrmContacts(data.contacts);
    } catch {
      setCrmContacts([]);
    }
  }, []);

  const loadMediaAssets = useCallback(async () => {
    try {
      const res = await fetch("/api/social/assets?userId=guest_server&kind=image&limit=100");
      const data = await res.json();
      setMediaAssets((data.items || []).map((a: { id: string; url: string; meta?: Record<string, string> }) => ({ id: a.id, url: a.url, meta: a.meta })));
    } catch { setMediaAssets([]); }
  }, []);

  useEffect(() => {
    void loadContacts();
    void loadMediaAssets();
  }, [loadContacts, loadMediaAssets]);

  useEffect(() => {
    const delay = didFirstProjectLoadRef.current ? 250 : 0;
    const timer = setTimeout(() => {
      didFirstProjectLoadRef.current = true;
      void loadProjects(search, includeArchived, includeFiled, includeDeleted);
    }, delay);
    return () => clearTimeout(timer);
  }, [includeArchived, includeDeleted, includeFiled, loadProjects, search]);

  const selectedContactName = useMemo(
    () => crmContacts.find((contact) => contact.id === form.linkedContactId)?.displayName ?? "",
    [crmContacts, form.linkedContactId],
  );

  const handleCoverFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("封面圖片只接受 image 類型檔案。");
      return;
    }

    setUploadingCover(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const data = await requestJson<{ attachment: UploadAttachment }>("/api/crm/upload", {
        method: "POST",
        body: formData,
      });
      const source = data.attachment.url || data.attachment.dataUrl || "";
      if (!source) {
        throw new Error("上傳成功但未取得圖片 URL。");
      }
      setForm((prev) => ({ ...prev, coverImageUrl: source }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "上傳封面失敗");
    } finally {
      setUploadingCover(false);
    }
  };

  const handleCreate = async () => {
    if (creating) {
      return;
    }
    const name = form.name.trim();
    const clientName = form.clientName.trim();
    if (!name || !clientName) {
      setError("請填寫專案名稱與客戶名稱");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const data = await requestJson<{ project: ProjectApiItem }>("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          clientName,
          status: form.status,
          phase: form.phase,
          budget: form.budget,
          coverImageUrl: form.coverImageUrl,
          linkedContactId: form.linkedContactIds[0] || form.linkedContactId || undefined,
          linkedContactIds: form.linkedContactIds,
          linkedAssetIds: form.linkedAssetIds,
          note: form.note,
        }),
      });
      const created = mapProject(data.project);
      setProjects((prev) => [created, ...prev]);
      setShowCreate(false);
      setForm({
        name: "",
        clientName: "",
        status: "draft",
        phase: "需求訪談",
        budget: "待定",
        coverImageUrl: "",
        linkedContactId: "",
        linkedContactIds: [],
        linkedAssetIds: [],
        note: "",
      });
      setSearch("");
      void loadProjects("", includeArchived, includeFiled, includeDeleted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增室內設計專案失敗");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-900">室內設計專案管理</h2>
        <div className="flex gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜尋室內設計專案..."
              className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-brand-500 focus:border-brand-500 w-full sm:w-64"
            />
          </div>
          <Button variant="outline" className="gap-1" onClick={() => setIncludeArchived((v) => !v)}>
            <Archive className="w-4 h-4" />
            {includeArchived ? "隱藏封存" : "顯示封存"}
          </Button>
          <Button variant="outline" className="gap-1" onClick={() => setIncludeFiled((v) => !v)}>
            <FolderArchive className="w-4 h-4" />
            {includeFiled ? "隱藏建檔" : "顯示建檔"}
          </Button>
          <Button variant="outline" className="gap-1" onClick={() => setIncludeDeleted((v) => !v)}>
            <Trash2 className="w-4 h-4" />
            {includeDeleted ? "隱藏刪除區" : "顯示刪除區"}
          </Button>
          <Button className="gap-1" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> 新增室內設計專案
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && <p className="text-sm text-gray-500">載入專案中...</p>}

      {!loading && projects.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          目前沒有專案，請先新增一筆專案。
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
        {projects.map((project) => {
          const isArchived = Boolean(project.archivedAt);
          const isFiled = Boolean(project.filedAt);
          const isDeleted = Boolean(project.deletedAt);
          return (
            <div
              key={project.id}
              onClick={() => onSelectProject(project)}
              className={`bg-white rounded-xl border border-gray-200 shadow-sm transition-all cursor-pointer overflow-hidden group hover:ring-2 hover:ring-brand-500 hover:border-transparent ${
                isArchived || isFiled || isDeleted ? "opacity-80" : "hover:shadow-md"
              }`}
            >
              <div className="h-48 overflow-hidden relative">
                <img
                  src={project.img}
                  alt={project.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute top-3 right-3 flex gap-2">
                  {isDeleted && (
                    <span className="px-2 py-1 rounded text-xs font-semibold bg-red-100 text-red-700">
                      刪除區
                    </span>
                  )}
                  {isFiled && (
                    <span className="px-2 py-1 rounded text-xs font-semibold bg-slate-100 text-slate-700">
                      已建檔
                    </span>
                  )}
                  {isArchived && (
                    <span className="px-2 py-1 rounded text-xs font-semibold bg-purple-100 text-purple-700">
                      已封存
                    </span>
                  )}
                  <span
                    className={`px-2 py-1 rounded text-xs font-semibold ${STATUS_BADGE[project.status]}`}
                  >
                    {STATUS_LABELS[project.status]}
                  </span>
                </div>
              </div>

              <div className="p-5">
                <h3 className="font-bold text-lg text-gray-900 line-clamp-1 group-hover:text-brand-600 transition-colors">
                  {project.name}
                </h3>

                <div className="space-y-2 mb-4 mt-3">
                  <div className="flex items-center text-sm text-gray-600 gap-2">
                    <User className="w-4 h-4 text-gray-400" />
                    <span>{project.client}</span>
                  </div>
                  <div className="flex items-center text-sm text-gray-600 gap-2">
                    <DollarSign className="w-4 h-4 text-gray-400" />
                    <span>預算：{project.budget}</span>
                  </div>
                  <div className="flex items-center text-sm text-gray-600 gap-2">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <span>更新：{project.date}</span>
                  </div>
                  {project.deletedAt && project.deletePurgeAt && (
                    <div className="text-xs text-red-700">
                      刪除區保留至：{new Date(project.deletePurgeAt).toLocaleDateString("zh-TW")}
                    </div>
                  )}
                  {project.linkedContactId && (
                    <div className="flex items-center text-xs text-green-700 gap-2">
                      <Link2 className="w-3.5 h-3.5" />
                      <span>已綁定 CRM 客戶</span>
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-xs font-medium px-2 py-1 bg-gray-100 rounded text-gray-600">
                    {project.phase}
                  </span>
                  <button className="text-sm font-medium text-brand-600 hover:text-brand-800">
                    進入專案 &rarr;
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4">
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => void handleCoverFileSelected(event)}
          />
          <div className="w-full max-w-xl rounded-xl border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">新增室內設計專案</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-500 hover:text-gray-900">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-gray-600">室內設計專案名稱</label>
                  <input
                    value={form.name}
                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    placeholder="例如：林宅老屋翻新整合案"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-600">客戶名稱</label>
                  <input
                    value={form.clientName}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, clientName: event.target.value }))
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    placeholder="例如：林小姐"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-600">案件狀態</label>
                  <select
                    value={form.status}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        status: event.target.value as ProjectStatus,
                      }))
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                  >
                    <option value="draft">草稿</option>
                    <option value="active">進行中</option>
                    <option value="quoted">已報價</option>
                    <option value="completed">已結案</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-600">設計階段</label>
                  <input
                    value={form.phase}
                    onChange={(event) => setForm((prev) => ({ ...prev, phase: event.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-600">預算</label>
                  <input
                    value={form.budget}
                    onChange={(event) => setForm((prev) => ({ ...prev, budget: event.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-600">綁定客戶（可多選）</label>
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                    {crmContacts.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-gray-400">尚無客戶，請先至 CRM 建立</p>
                    ) : (
                      crmContacts.map((contact) => {
                        const checked = form.linkedContactIds.includes(contact.id);
                        return (
                          <label key={contact.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setForm((prev) => ({
                                  ...prev,
                                  linkedContactIds: checked
                                    ? prev.linkedContactIds.filter((cid) => cid !== contact.id)
                                    : [...prev.linkedContactIds, contact.id],
                                  clientName: prev.clientName || contact.displayName,
                                }))
                              }
                              className="rounded border-gray-300 text-brand-600"
                            />
                            <span className="text-gray-700">{contact.displayName}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                  {form.linkedContactIds.length > 0 && (
                    <p className="mt-1 text-[11px] text-gray-500">
                      已選 {form.linkedContactIds.length} 位：{form.linkedContactIds.map((cid) => crmContacts.find((c) => c.id === cid)?.displayName).filter(Boolean).join("、")}
                    </p>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-xs text-gray-600">關聯設計圖（可多選）</label>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
                    {mediaAssets.length === 0 ? (
                      <p className="px-2 py-2 text-xs text-gray-400">尚無設計圖，請先至 AI 空間渲染生成</p>
                    ) : (
                      <div className="grid grid-cols-4 gap-1.5">
                        {mediaAssets.slice(0, 24).map((asset) => {
                          const checked = form.linkedAssetIds.includes(asset.id);
                          return (
                            <button
                              key={asset.id}
                              type="button"
                              onClick={() =>
                                setForm((prev) => ({
                                  ...prev,
                                  linkedAssetIds: checked
                                    ? prev.linkedAssetIds.filter((aid) => aid !== asset.id)
                                    : [...prev.linkedAssetIds, asset.id],
                                  coverImageUrl: !prev.coverImageUrl && !checked ? asset.url : prev.coverImageUrl,
                                }))
                              }
                              className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                                checked ? "border-brand-500 ring-1 ring-brand-300" : "border-transparent hover:border-gray-300"
                              }`}
                            >
                              <img src={asset.url} alt="" className="w-full h-full object-cover" />
                              {checked && (
                                <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-brand-600 rounded-full flex items-center justify-center">
                                  <CheckCircle className="w-3 h-3 text-white" />
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {form.linkedAssetIds.length > 0 && (
                    <p className="mt-1 text-[11px] text-gray-500">已選 {form.linkedAssetIds.length} 張設計圖</p>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-600">封面圖片（可直接上傳）</label>
                <div className="flex items-center gap-3">
                  <div className="h-20 w-20 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center">
                    {form.coverImageUrl ? (
                      <img src={form.coverImageUrl} alt="cover" className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => coverInputRef.current?.click()}
                      disabled={uploadingCover}
                    >
                      <Upload className="w-4 h-4" />
                      {uploadingCover ? "上傳中..." : "上傳封面"}
                    </Button>
                    {form.coverImageUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setForm((prev) => ({ ...prev, coverImageUrl: "" }))}
                      >
                        清除
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-600">專案註記（可同步 CRM）</label>
                <textarea
                  value={form.note}
                  onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
                  className="w-full h-24 rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
                  placeholder="例如：偏好奶油白木質調、收納要足夠、客廳需投影牆..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <Button variant="outline" onClick={() => setShowCreate(false)} disabled={creating}>
                取消
              </Button>
              <Button onClick={() => void handleCreate()} disabled={creating || uploadingCover}>
                {creating ? "建立中..." : "建立室內設計專案"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
