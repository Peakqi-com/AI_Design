import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "./Button";
import {
  Camera,
  Edit3,
  Phone,
  Mail,
  MapPin,
  Building,
  Briefcase,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  User,
  UserCircle,
  X,
} from "lucide-react";
import { resolveClientUserScopeId } from "@/lib/client/user-scope";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CrmContact {
  id: string;
  source: "line" | "manual";
  displayName: string;
  avatarUrl?: string | null;
  tags: string[];
  status: "new" | "contacted" | "proposal" | "signed";
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  address?: string;
  notes?: string;
  unread: number;
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
}

type StatusFilter = "all" | "new" | "contacted" | "proposal" | "signed";

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "全部",
  new: "新客戶",
  contacted: "已聯繫",
  proposal: "提案中",
  signed: "已簽約",
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-yellow-100 text-yellow-700",
  proposal: "bg-purple-100 text-purple-700",
  signed: "bg-green-100 text-green-700",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const CRMSystem: React.FC = () => {
  const { data: session } = useSession();
  const sessionUser = session?.user as Record<string, unknown> | undefined;
  const userScope = resolveClientUserScopeId(
    (sessionUser?.id ?? sessionUser?.sub) as string | undefined,
    session?.user?.email,
  );

  /* ---- state ---- */
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showScanModal, setShowScanModal] = useState(false);

  /* detail panel edits */
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newTag, setNewTag] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* add-client form */
  const [addForm, setAddForm] = useState({
    displayName: "",
    email: "",
    phone: "",
    company: "",
    title: "",
    address: "",
    notes: "",
    tags: "",
  });

  /* scan card */
  const [cardImage, setCardImage] = useState<string | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResult, setScanResult] = useState<Record<string, string> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = contacts.find((c) => c.id === selectedId) ?? null;

  /* ---- helpers ---- */
  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      ...(userScope ? { "x-user-scope": userScope } : {}),
    }),
    [userScope],
  );

  /* ---- fetch contacts ---- */
  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set("search", searchQuery);
      if (statusFilter !== "all") params.set("tag", statusFilter);
      const res = await fetch(`/api/crm/contacts?${params.toString()}`, {
        headers: headers(),
      });
      if (res.ok) {
        const data = await res.json();
        setContacts(data.contacts ?? data);
      }
    } catch {
      /* network error — leave list as-is */
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, headers]);

  useEffect(() => {
    if (userScope) fetchContacts();
  }, [fetchContacts, userScope]);

  /* ---- create contact ---- */
  const createContact = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/crm/contacts", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (res.ok) {
      await fetchContacts();
      return true;
    }
    return false;
  };

  /* ---- update contact field ---- */
  const updateField = async (field: string, value: string) => {
    if (!selected) return;
    await fetch(`/api/crm/contacts/${selected.id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ [field]: value }),
    });
    await fetchContacts();
    setEditingField(null);
  };

  /* ---- update status ---- */
  const updateStatus = async (status: string) => {
    if (!selected) return;
    await fetch(`/api/crm/contacts/${selected.id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ status }),
    });
    await fetchContacts();
  };

  /* ---- notes auto-save ---- */
  const handleNotesChange = (value: string) => {
    setNotesDraft(value);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => {
      if (selected) {
        fetch(`/api/crm/contacts/${selected.id}`, {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify({ notes: value }),
        }).then(() => fetchContacts());
      }
    }, 1000);
  };

  /* sync notesDraft when selection changes */
  useEffect(() => {
    setNotesDraft(selected?.notes ?? "");
  }, [selected?.id, selected?.notes]);

  /* ---- tag management ---- */
  const addTag = async (tag: string) => {
    if (!selected || !tag.trim()) return;
    await fetch(`/api/crm/contacts/${selected.id}/tags`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ tag: tag.trim() }),
    });
    setNewTag("");
    await fetchContacts();
  };

  const removeTag = async (tag: string) => {
    if (!selected) return;
    await fetch(
      `/api/crm/contacts/${selected.id}/tags?tag=${encodeURIComponent(tag)}`,
      { method: "DELETE", headers: headers() },
    );
    await fetchContacts();
  };

  /* ---- delete contact ---- */
  const deleteContact = async () => {
    if (!selected || !confirm("確定要刪除此客戶嗎？")) return;
    await fetch(`/api/crm/contacts/${selected.id}`, {
      method: "DELETE",
      headers: headers(),
    });
    setSelectedId(null);
    await fetchContacts();
  };

  /* ---- scan business card ---- */
  const handleCardUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCardImage(reader.result as string);
    reader.readAsDataURL(file);
  };

  const runCardScan = async () => {
    if (!cardImage) return;
    setScanLoading(true);
    setScanResult(null);
    try {
      const res = await fetch("/api/ai/render", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          imageDataUrl: cardImage,
          roomType: "全室整合",
          style: "名片辨識",
          customPrompt:
            "This is a business card image. Extract the following fields as JSON: displayName, email, phone, company, title, address. Return ONLY valid JSON with these keys. If a field is not found, use empty string.",
          creativity: 5,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const summary: string = data.summary ?? data.result ?? "";
        const match = summary.match(/\{[\s\S]*\}/);
        if (match) {
          setScanResult(JSON.parse(match[0]));
        } else {
          alert("無法從名片中提取資訊，請手動輸入");
        }
      }
    } catch {
      alert("名片掃描失敗，請重試");
    } finally {
      setScanLoading(false);
    }
  };

  const confirmScanResult = async () => {
    if (!scanResult) return;
    const ok = await createContact({
      displayName: scanResult.displayName || "未知",
      email: scanResult.email || "",
      phone: scanResult.phone || "",
      company: scanResult.company || "",
      title: scanResult.title || "",
      address: scanResult.address || "",
      notes: "",
      tags: [],
    });
    if (ok) {
      setShowScanModal(false);
      setCardImage(null);
      setScanResult(null);
    }
  };

  /* ---- add client submit ---- */
  const handleAddSubmit = async () => {
    if (!addForm.displayName.trim()) return;
    const ok = await createContact({
      displayName: addForm.displayName.trim(),
      email: addForm.email,
      phone: addForm.phone,
      company: addForm.company,
      title: addForm.title,
      address: addForm.address,
      notes: addForm.notes,
      tags: addForm.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
    if (ok) {
      setShowAddModal(false);
      setAddForm({ displayName: "", email: "", phone: "", company: "", title: "", address: "", notes: "", tags: "" });
    }
  };

  /* ---- inline edit helpers ---- */
  const startEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue);
  };

  const commitEdit = () => {
    if (editingField) updateField(editingField, editValue);
  };

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="flex h-full bg-white rounded-xl shadow overflow-hidden">
      {/* ---------- LEFT PANEL: Client List ---------- */}
      <div className="w-1/3 border-r border-gray-200 flex flex-col">
        {/* search */}
        <div className="p-3 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="搜尋客戶..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchContacts()}
            />
          </div>
        </div>

        {/* status filter tabs */}
        <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-gray-100">
          {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2 py-1 text-xs rounded-full transition-colors ${
                statusFilter === s
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        {/* action buttons */}
        <div className="flex gap-2 px-3 py-2 border-b border-gray-100">
          <Button size="sm" variant="primary" onClick={() => setShowAddModal(true)} className="flex-1 gap-1">
            <Plus className="w-4 h-4" /> 新增客戶
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowScanModal(true)} className="flex-1 gap-1">
            <Camera className="w-4 h-4" /> 掃描名片
          </Button>
        </div>

        {/* contact list */}
        <div className="flex-1 overflow-y-auto">
          {loading && contacts.length === 0 && (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> 載入中...
            </div>
          )}
          {!loading && contacts.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-sm">
              <UserCircle className="w-8 h-8 mb-2" />
              尚無客戶
            </div>
          )}
          {contacts.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`w-full text-left px-3 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                selectedId === c.id ? "bg-brand-50" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                {c.avatarUrl ? (
                  <img src={c.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                    <User className="w-5 h-5 text-gray-500" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-900 truncate">
                      {c.displayName}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[c.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {STATUS_LABELS[c.status as StatusFilter] ?? c.status}
                    </span>
                  </div>
                  {c.company && (
                    <p className="text-xs text-gray-500 truncate">{c.company}</p>
                  )}
                  {c.phone && (
                    <p className="text-xs text-gray-400 truncate">{c.phone}</p>
                  )}
                  {c.tags.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {c.tags.slice(0, 3).map((t) => (
                        <span key={t} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                          {t}
                        </span>
                      ))}
                      {c.tags.length > 3 && (
                        <span className="text-[10px] text-gray-400">+{c.tags.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ---------- RIGHT PANEL: Detail ---------- */}
      <div className="w-2/3 flex flex-col">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <UserCircle className="w-16 h-16 mb-3" />
            <p className="text-lg">選擇客戶查看詳情</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* header */}
            <div className="flex items-center gap-4 p-6 border-b border-gray-100">
              {selected.avatarUrl ? (
                <img src={selected.avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center">
                  <User className="w-8 h-8 text-gray-500" />
                </div>
              )}
              <div className="flex-1">
                <h2 className="text-xl font-semibold text-gray-900">{selected.displayName}</h2>
                {selected.company && (
                  <p className="text-sm text-gray-500">{selected.company}</p>
                )}
              </div>
              <select
                value={selected.status}
                onChange={(e) => updateStatus(e.target.value)}
                className={`text-sm px-3 py-1.5 rounded-full border-0 cursor-pointer ${STATUS_COLORS[selected.status]}`}
              >
                <option value="new">新客戶</option>
                <option value="contacted">已聯繫</option>
                <option value="proposal">提案中</option>
                <option value="signed">已簽約</option>
              </select>
            </div>

            {/* info grid */}
            <div className="grid grid-cols-2 gap-4 p-6 border-b border-gray-100">
              {([
                { key: "phone", icon: Phone, label: "電話" },
                { key: "email", icon: Mail, label: "電子郵件" },
                { key: "title", icon: Briefcase, label: "職稱" },
                { key: "address", icon: MapPin, label: "地址" },
              ] as const).map(({ key, icon: Icon, label }) => (
                <div key={key} className="group">
                  <label className="text-xs text-gray-400 flex items-center gap-1 mb-1">
                    <Icon className="w-3 h-3" /> {label}
                  </label>
                  {editingField === key ? (
                    <div className="flex gap-1">
                      <input
                        autoFocus
                        className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit();
                          if (e.key === "Escape") setEditingField(null);
                        }}
                      />
                      <button onClick={commitEdit} className="text-brand-600 text-sm">
                        儲存
                      </button>
                    </div>
                  ) : (
                    <p
                      className="text-sm text-gray-800 cursor-pointer hover:text-brand-600 flex items-center gap-1"
                      onClick={() =>
                        startEdit(key, (selected[key] as string) ?? "")
                      }
                    >
                      {(selected[key] as string) || (
                        <span className="text-gray-300">未填寫</span>
                      )}
                      <Edit3 className="w-3 h-3 opacity-0 group-hover:opacity-50" />
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* company (editable) */}
            <div className="px-6 py-4 border-b border-gray-100 group">
              <label className="text-xs text-gray-400 flex items-center gap-1 mb-1">
                <Building className="w-3 h-3" /> 公司
              </label>
              {editingField === "company" ? (
                <div className="flex gap-1">
                  <input
                    autoFocus
                    className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit();
                      if (e.key === "Escape") setEditingField(null);
                    }}
                  />
                  <button onClick={commitEdit} className="text-brand-600 text-sm">
                    儲存
                  </button>
                </div>
              ) : (
                <p
                  className="text-sm text-gray-800 cursor-pointer hover:text-brand-600 flex items-center gap-1"
                  onClick={() => startEdit("company", selected.company ?? "")}
                >
                  {selected.company || <span className="text-gray-300">未填寫</span>}
                  <Edit3 className="w-3 h-3 opacity-0 group-hover:opacity-50" />
                </p>
              )}
            </div>

            {/* tags */}
            <div className="px-6 py-4 border-b border-gray-100">
              <label className="text-xs text-gray-400 flex items-center gap-1 mb-2">
                <Tag className="w-3 h-3" /> 標籤
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {selected.tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 text-xs bg-brand-50 text-brand-700 px-2 py-1 rounded-full"
                  >
                    {t}
                    <button onClick={() => removeTag(t)} className="hover:text-red-500">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1">
                <input
                  className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  placeholder="新增標籤..."
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addTag(newTag);
                  }}
                />
                <Button size="sm" variant="ghost" onClick={() => addTag(newTag)}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* notes */}
            <div className="px-6 py-4 border-b border-gray-100">
              <label className="text-xs text-gray-400 mb-2 block">備註</label>
              <textarea
                className="w-full text-sm border border-gray-200 rounded-lg p-3 min-h-[120px] focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
                placeholder="輸入備註..."
                value={notesDraft}
                onChange={(e) => handleNotesChange(e.target.value)}
              />
              <p className="text-[10px] text-gray-400 mt-1">自動儲存</p>
            </div>

            {/* delete button */}
            <div className="px-6 py-4">
              <Button size="sm" variant="ghost" onClick={deleteContact} className="text-red-500 hover:text-red-700 hover:bg-red-50 gap-1">
                <Trash2 className="w-4 h-4" /> 刪除客戶
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ========== ADD CLIENT MODAL ========== */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold">新增客戶</h3>
              <button onClick={() => setShowAddModal(false)}>
                <X className="w-5 h-5 text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {([
                { key: "displayName", label: "姓名 *", ph: "客戶姓名" },
                { key: "email", label: "電子郵件", ph: "email@example.com" },
                { key: "phone", label: "電話", ph: "0912-345-678" },
                { key: "company", label: "公司", ph: "公司名稱" },
                { key: "title", label: "職稱", ph: "職稱" },
                { key: "address", label: "地址", ph: "地址" },
                { key: "tags", label: "標籤 (逗號分隔)", ph: "VIP, 北區" },
              ] as const).map(({ key, label, ph }) => (
                <div key={key}>
                  <label className="text-sm text-gray-600 block mb-1">{label}</label>
                  <input
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder={ph}
                    value={addForm[key]}
                    onChange={(e) => setAddForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </div>
              ))}
              <div>
                <label className="text-sm text-gray-600 block mb-1">備註</label>
                <textarea
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 min-h-[60px] focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="備註..."
                  value={addForm.notes}
                  onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-gray-100">
              <Button variant="outline" onClick={() => setShowAddModal(false)}>
                取消
              </Button>
              <Button variant="primary" onClick={handleAddSubmit}>
                新增
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ========== SCAN BUSINESS CARD MODAL ========== */}
      {showScanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-brand-600" /> 掃描名片
              </h3>
              <button
                onClick={() => {
                  setShowScanModal(false);
                  setCardImage(null);
                  setScanResult(null);
                }}
              >
                <X className="w-5 h-5 text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {!cardImage && (
                <div
                  className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-brand-500 hover:bg-brand-50/30 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600">點擊上傳名片照片</p>
                  <p className="text-xs text-gray-400 mt-1">支援 JPG / PNG</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleCardUpload}
                  />
                </div>
              )}

              {cardImage && !scanResult && (
                <div className="space-y-3">
                  <img src={cardImage} alt="名片" className="w-full rounded-lg" />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setCardImage(null)}
                      className="flex-1"
                    >
                      重新上傳
                    </Button>
                    <Button
                      variant="primary"
                      onClick={runCardScan}
                      disabled={scanLoading}
                      className="flex-1 gap-1"
                    >
                      {scanLoading ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" /> 辨識中...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" /> AI 辨識
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {scanResult && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-gray-700">辨識結果：</p>
                  {(["displayName", "email", "phone", "company", "title", "address"] as const).map(
                    (field) => (
                      <div key={field}>
                        <label className="text-xs text-gray-400 block mb-0.5">
                          {
                            {
                              displayName: "姓名",
                              email: "電子郵件",
                              phone: "電話",
                              company: "公司",
                              title: "職稱",
                              address: "地址",
                            }[field]
                          }
                        </label>
                        <input
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                          value={scanResult[field] ?? ""}
                          onChange={(e) =>
                            setScanResult((prev) =>
                              prev ? { ...prev, [field]: e.target.value } : prev,
                            )
                          }
                        />
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
            {scanResult && (
              <div className="flex justify-end gap-2 p-4 border-t border-gray-100">
                <Button
                  variant="outline"
                  onClick={() => {
                    setScanResult(null);
                    setCardImage(null);
                  }}
                >
                  重新掃描
                </Button>
                <Button variant="primary" onClick={confirmScanResult}>
                  建立客戶
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
