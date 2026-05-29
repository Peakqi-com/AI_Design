import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "./Button";
import {
  AlertTriangle,
  Camera,
  Check,
  ClipboardCopy,
  Edit3,
  ExternalLink,
  Link2,
  Phone,
  Mail,
  MapPin,
  Building,
  Briefcase,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Tag,
  Trash2,
  Unlink,
  Upload,
  User,
  UserCircle,
  X,
} from "lucide-react";
import { resolveClientUserScopeId } from "@/lib/client/user-scope";
import { useCredits } from "@/lib/client/use-credits";

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
  cardImageUrl?: string;
  unread: number;
  lastMessageText?: string;
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

type CrmTab = "contacts" | "line-settings";

interface LineSettingsData {
  connected: boolean;
  channelId: string;
  hasChannelAccessToken: boolean;
  hasChannelSecret: boolean;
  updatedAt: string | null;
  lastWebhookAt: string | null;
  lastWebhookEventCount: number;
  lastWebhookProcessedCount: number;
  lastWebhookFailedCount: number;
  lastWebhookError: string | null;
  webhookUrl: string;
  storageBackend: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const CRMSystem: React.FC = () => {
  const { data: session } = useSession();
  const credits = useCredits();
  const sessionUser = session?.user as Record<string, unknown> | undefined;
  const userScope = resolveClientUserScopeId(
    (sessionUser?.id ?? sessionUser?.sub) as string | undefined,
    session?.user?.email,
  );

  /* ---- state ---- */
  const [activeTab, setActiveTab] = useState<CrmTab>("contacts");
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

  /* LINE OA settings */
  const [lineData, setLineData] = useState<LineSettingsData | null>(null);
  const [lineLoading, setLineLoading] = useState(false);
  const [lineSaving, setLineSaving] = useState(false);
  const [lineForm, setLineForm] = useState({ channelId: "", channelAccessToken: "", channelSecret: "" });
  const [lineMsg, setLineMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const selected = contacts.find((c) => c.id === selectedId) ?? null;
  const hasFetched = useRef(false);
  const userScopeRef = useRef(userScope);
  userScopeRef.current = userScope;

  /* ---- helpers ---- */
  const buildHeaders = useCallback(
    (): Record<string, string> => ({
      "Content-Type": "application/json",
      ...(userScopeRef.current ? { "x-user-scope": userScopeRef.current } : {}),
    }),
    [],
  );

  /* ---- fetch contacts (no flashing on background refresh) ---- */
  const fetchContacts = useCallback(async () => {
    const isInitial = !hasFetched.current;
    if (isInitial) setLoading(true);
    try {
      const scope = userScopeRef.current;
      const params = new URLSearchParams();
      if (scope) params.set("userId", scope);
      if (searchQuery) params.set("search", searchQuery);
      if (statusFilter !== "all") params.set("tag", statusFilter);
      const res = await fetch(`/api/crm/contacts?${params.toString()}`, {
        headers: buildHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setContacts(data.contacts ?? data);
        hasFetched.current = true;
      }
    } catch {
      /* network error — leave list as-is */
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [searchQuery, statusFilter, buildHeaders]);

  useEffect(() => {
    if (userScope) fetchContacts();
  }, [userScope, searchQuery, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- fetch LINE settings ---- */
  const fetchLineSettings = useCallback(async () => {
    setLineLoading(true);
    try {
      const scope = userScopeRef.current;
      const params = scope ? `?userId=${encodeURIComponent(scope)}` : "";
      const res = await fetch(`/api/crm/settings/line${params}`, { headers: buildHeaders() });
      if (res.ok) {
        setLineData(await res.json());
      }
    } catch { /* ignore */ } finally {
      setLineLoading(false);
    }
  }, [buildHeaders]);

  useEffect(() => {
    if (activeTab === "line-settings" && userScope) fetchLineSettings();
  }, [activeTab, userScope]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- save LINE settings ---- */
  const saveLineSettings = async () => {
    if (!lineForm.channelId.trim() || !lineForm.channelAccessToken.trim() || !lineForm.channelSecret.trim()) {
      setLineMsg({ type: "err", text: "三個欄位皆為必填" });
      return;
    }
    setLineSaving(true);
    setLineMsg(null);
    try {
      const scope = userScopeRef.current;
      const params = scope ? `?userId=${encodeURIComponent(scope)}` : "";
      const res = await fetch(`/api/crm/settings/line${params}`, {
        method: "PUT",
        headers: buildHeaders(),
        body: JSON.stringify(lineForm),
      });
      const data = await res.json();
      if (res.ok) {
        setLineData(data);
        setLineMsg({ type: "ok", text: "LINE OA 連線成功！Token 驗證通過" });
        setLineForm({ channelId: "", channelAccessToken: "", channelSecret: "" });
      } else {
        setLineMsg({ type: "err", text: data.error || "儲存失敗" });
      }
    } catch {
      setLineMsg({ type: "err", text: "網路錯誤，請重試" });
    } finally {
      setLineSaving(false);
    }
  };

  /* ---- disconnect LINE ---- */
  const disconnectLine = async () => {
    if (!confirm("確定要中斷 LINE OA 連線嗎？Webhook 將停止接收訊息。")) return;
    try {
      const scope = userScopeRef.current;
      const params = scope ? `?userId=${encodeURIComponent(scope)}` : "";
      await fetch(`/api/crm/settings/line${params}`, { method: "DELETE", headers: buildHeaders() });
      setLineData(null);
      setLineMsg({ type: "ok", text: "已中斷連線" });
    } catch {
      setLineMsg({ type: "err", text: "中斷連線失敗" });
    }
  };

  /* ---- create contact ---- */
  const createContact = async (body: Record<string, unknown>) => {
    try {
      // Remove cardImageUrl from body if too large (>1MB base64 causes API timeout)
      const cleanBody: Record<string, unknown> = { ...body, userId: userScope };
      if (typeof cleanBody.cardImageUrl === "string" && (cleanBody.cardImageUrl as string).length > 1_000_000) {
        delete cleanBody.cardImageUrl;
      }
      const res = await fetch("/api/crm/contacts", {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(cleanBody),
      });
      if (res.ok) {
        await fetchContacts();
        return true;
      }
      const errData = await res.json().catch(() => ({}));
      alert(`建立客戶失敗：${(errData as { error?: string }).error || res.statusText}`);
      return false;
    } catch (err) {
      alert(`建立客戶失敗：${err instanceof Error ? err.message : "網路錯誤"}`);
      return false;
    }
  };

  /* ---- update contact field ---- */
  const updateField = async (field: string, value: string) => {
    if (!selected) return;
    await fetch(`/api/crm/contacts/${selected.id}`, {
      method: "PATCH",
      headers: buildHeaders(),
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
      headers: buildHeaders(),
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
          headers: buildHeaders(),
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
      headers: buildHeaders(),
      body: JSON.stringify({ tag: tag.trim() }),
    });
    setNewTag("");
    await fetchContacts();
  };

  const removeTag = async (tag: string) => {
    if (!selected) return;
    await fetch(
      `/api/crm/contacts/${selected.id}/tags?tag=${encodeURIComponent(tag)}`,
      { method: "DELETE", headers: buildHeaders() },
    );
    await fetchContacts();
  };

  /* ---- delete contact ---- */
  const deleteContact = async () => {
    if (!selected || !confirm("確定要刪除此客戶嗎？")) return;
    await fetch(`/api/crm/contacts/${selected.id}`, {
      method: "DELETE",
      headers: buildHeaders(),
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
    const d = await credits.confirmAndDeduct("名片 OCR 掃描", "ai-social-post");
    if (!d.ok) { return; }
    setScanLoading(true);
    setScanResult(null);
    try {
      const res = await fetch("/api/ai/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: cardImage,
          prompt:
            "這是一張名片照片。請仔細辨識名片上的所有文字，提取以下欄位。" +
            "輸出 JSON 格式：{\"displayName\":\"姓名\",\"company\":\"公司名稱\",\"title\":\"職稱\",\"phone\":\"電話\",\"email\":\"電子信箱\",\"address\":\"地址\"}" +
            "\n找不到的欄位留空字串。只輸出 JSON，不要其他文字。",
          temperature: 0.2,
          jsonMode: true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = (data.text || "").trim();
        let parsed: Record<string, string> | null = null;
        try {
          const jsonCandidate = text.match(/\{[\s\S]*\}/)?.[0] || text;
          parsed = JSON.parse(jsonCandidate);
        } catch {
          try { parsed = JSON.parse(text); } catch { /* give up */ }
        }
        if (parsed && parsed.displayName) {
          setScanResult(parsed);
        } else {
          alert("無法從名片中辨識文字，請手動輸入");
        }
      } else {
        alert("名片辨識失敗，請重試");
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
      tags: ["名片掃描"],
      cardImageUrl: cardImage || undefined,
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

  /* ---- messages / chat ---- */
  interface ChatMessage {
    id: string;
    contactId: string;
    direction: "inbound" | "outbound";
    senderType: "customer" | "agent" | "system";
    messageType: string;
    text?: string;
    attachment?: { type: string; dataUrl?: string; url?: string; name?: string };
    timestamp: string;
  }

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContactIdRef = useRef<string | null>(null);

  const fetchMessages = useCallback(async (contactId: string) => {
    setChatLoading(true);
    try {
      const res = await fetch(
        `/api/crm/messages?contactId=${encodeURIComponent(contactId)}&markRead=1`,
        { headers: buildHeaders() },
      );
      if (res.ok) {
        const data = await res.json();
        setChatMessages(data.messages ?? []);
        setContacts((prev) =>
          prev.map((c) => (c.id === contactId ? { ...c, unread: 0 } : c)),
        );
      }
    } catch { /* ignore */ } finally {
      setChatLoading(false);
    }
  }, [buildHeaders]);

  useEffect(() => {
    if (selected && selected.id !== chatContactIdRef.current) {
      chatContactIdRef.current = selected.id;
      setShowDetail(false);
      fetchMessages(selected.id);
    }
    if (!selected) {
      chatContactIdRef.current = null;
      setChatMessages([]);
    }
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages.length]);

  const sendMessage = async () => {
    if (!selected || !chatInput.trim()) return;
    setChatSending(true);
    try {
      const res = await fetch("/api/crm/messages", {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({ contactId: selected.id, text: chatInput.trim() }),
      });
      if (res.ok) {
        setChatInput("");
        await fetchMessages(selected.id);
        await fetchContacts();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`傳送失敗：${(err as { error?: string }).error || res.statusText}`);
      }
    } catch {
      alert("傳送失敗：網路錯誤");
    } finally {
      setChatSending(false);
    }
  };

  /* ---- polling for new messages ---- */
  useEffect(() => {
    if (!selected) return;
    const interval = setInterval(() => {
      if (selected) fetchMessages(selected.id);
    }, 15000);
    return () => clearInterval(interval);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- copy webhook URL ---- */
  const copyWebhookUrl = async () => {
    if (!lineData?.webhookUrl) return;
    await navigator.clipboard.writeText(lineData.webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="flex flex-col h-full bg-white rounded-xl shadow overflow-hidden">
      {/* ===== TOP TAB BAR ===== */}
      <div className="flex border-b border-gray-200 shrink-0">
        <button
          onClick={() => setActiveTab("contacts")}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "contacts"
              ? "border-brand-600 text-brand-700"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          <UserCircle className="w-4 h-4" /> 客戶列表
        </button>
        <button
          onClick={() => setActiveTab("line-settings")}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "line-settings"
              ? "border-brand-600 text-brand-700"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          <MessageCircle className="w-4 h-4" /> LINE OA 設定
          {lineData?.connected && (
            <span className="w-2 h-2 rounded-full bg-green-500" />
          )}
        </button>
      </div>

      {/* ===== LINE SETTINGS TAB ===== */}
      {activeTab === "line-settings" && (
        <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">LINE Official Account 串接</h2>
          <p className="text-sm text-gray-500 mb-6">將你的 LINE OA 連接到 CRM，自動接收客戶訊息並管理對話</p>

          {/* Storage backend warning — memory mode breaks webhooks on serverless */}
          {lineData?.storageBackend === "memory" && (
            <div className="mb-6 border border-amber-300 bg-amber-50 rounded-xl p-4">
              <div className="flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <p className="font-semibold mb-1">資料庫尚未設定，LINE 訊息無法正常接收</p>
                  <p className="text-amber-700 leading-relaxed">
                    目前儲存模式為「記憶體」(memory)，在 Vercel serverless 環境下資料不會持久化、各實例不共用，
                    導致 LINE webhook 找不到設定而失敗（事件數卡住）。請在 Vercel 加上 Upstash Redis 或 Vercel KV，
                    設定 <span className="font-mono">UPSTASH_REDIS_REST_URL</span> /{" "}
                    <span className="font-mono">UPSTASH_REDIS_REST_TOKEN</span> 後重新部署，
                    儲存模式會自動變成 redis，再重新填寫下方設定即可。
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Connection status */}
          {lineLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-8 justify-center">
              <RefreshCw className="w-4 h-4 animate-spin" /> 載入中...
            </div>
          ) : lineData?.connected ? (
            <>
              {/* Connected state */}
              <div className="border border-green-200 bg-green-50 rounded-xl p-5 mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                    <Check className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-green-800">已連線</p>
                    <p className="text-xs text-green-600">Channel ID：{lineData.channelId}</p>
                  </div>
                </div>
                {lineData.updatedAt && (
                  <p className="text-xs text-green-600 mb-1">
                    設定時間：{new Date(lineData.updatedAt).toLocaleString("zh-TW")}
                  </p>
                )}
              </div>

              {/* Webhook URL */}
              <div className="mb-6">
                <label className="text-sm font-medium text-gray-700 block mb-2">
                  Webhook URL（貼到 LINE Developers Console）
                </label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={lineData.webhookUrl}
                    className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 font-mono text-gray-700 select-all"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={copyWebhookUrl}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-1.5"
                  >
                    {copied ? <Check className="w-4 h-4 text-green-600" /> : <ClipboardCopy className="w-4 h-4" />}
                    {copied ? "已複製" : "複製"}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  前往 <span className="font-medium">LINE Developers → Messaging API → Webhook URL</span>，貼上此連結並啟用 Use webhook
                </p>
              </div>

              {/* Webhook stats */}
              <div className="mb-6">
                <label className="text-sm font-medium text-gray-700 block mb-2">Webhook 接收記錄</label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                    <p className="text-xs text-gray-400">最近接收</p>
                    <p className="text-sm font-medium text-gray-800 mt-0.5">
                      {lineData.lastWebhookAt
                        ? new Date(lineData.lastWebhookAt).toLocaleString("zh-TW")
                        : "尚未收到"}
                    </p>
                  </div>
                  <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                    <p className="text-xs text-gray-400">事件數</p>
                    <p className="text-sm font-medium text-gray-800 mt-0.5">
                      {lineData.lastWebhookEventCount} 收 / {lineData.lastWebhookProcessedCount} 成功 / {lineData.lastWebhookFailedCount} 失敗
                    </p>
                  </div>
                </div>
                {lineData.lastWebhookError && (
                  <div className="mt-2 bg-red-50 border border-red-100 rounded-lg p-3">
                    <p className="text-xs text-red-600">最近錯誤：{lineData.lastWebhookError}</p>
                  </div>
                )}
              </div>

              {/* Refresh + Disconnect */}
              <div className="flex gap-3">
                <Button variant="outline" size="sm" onClick={fetchLineSettings} className="gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5" /> 重新整理
                </Button>
                <Button variant="ghost" size="sm" onClick={disconnectLine} className="text-red-500 hover:text-red-700 hover:bg-red-50 gap-1.5">
                  <Unlink className="w-3.5 h-3.5" /> 中斷連線
                </Button>
              </div>

              {/* Re-configure (collapsed) */}
              <details className="mt-6 border border-gray-200 rounded-xl">
                <summary className="px-4 py-3 text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50 rounded-xl flex items-center gap-2">
                  <Settings className="w-4 h-4" /> 重新設定（更新 Token）
                </summary>
                <div className="p-4 pt-2 space-y-3 border-t border-gray-100">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Channel ID</label>
                    <input
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder={lineData.channelId || "Channel ID"}
                      value={lineForm.channelId}
                      onChange={(e) => setLineForm((f) => ({ ...f, channelId: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Channel Access Token</label>
                    <input
                      type="password"
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder="留空則保持現有 Token"
                      value={lineForm.channelAccessToken}
                      onChange={(e) => setLineForm((f) => ({ ...f, channelAccessToken: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Channel Secret</label>
                    <input
                      type="password"
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder="留空則保持現有 Secret"
                      value={lineForm.channelSecret}
                      onChange={(e) => setLineForm((f) => ({ ...f, channelSecret: e.target.value }))}
                    />
                  </div>
                  <Button variant="primary" size="sm" onClick={saveLineSettings} disabled={lineSaving} className="gap-1.5">
                    {lineSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    {lineSaving ? "驗證中..." : "更新並驗證"}
                  </Button>
                </div>
              </details>
            </>
          ) : (
            <>
              {/* Not connected — setup form */}
              <div className="border border-gray-200 rounded-xl p-5 mb-6 bg-gray-50">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                    <Link2 className="w-5 h-5 text-gray-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800">尚未連線</p>
                    <p className="text-xs text-gray-500">輸入 LINE Messaging API 設定完成串接</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-600 block mb-1">Channel ID *</label>
                    <input
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                      placeholder="LINE Developers Console → Basic settings"
                      value={lineForm.channelId}
                      onChange={(e) => setLineForm((f) => ({ ...f, channelId: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 block mb-1">Channel Access Token (long-lived) *</label>
                    <input
                      type="password"
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                      placeholder="LINE Developers Console → Messaging API → Issue"
                      value={lineForm.channelAccessToken}
                      onChange={(e) => setLineForm((f) => ({ ...f, channelAccessToken: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 block mb-1">Channel Secret *</label>
                    <input
                      type="password"
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                      placeholder="LINE Developers Console → Basic settings"
                      value={lineForm.channelSecret}
                      onChange={(e) => setLineForm((f) => ({ ...f, channelSecret: e.target.value }))}
                    />
                  </div>
                </div>

                <Button
                  variant="primary"
                  className="mt-4 w-full gap-2"
                  onClick={saveLineSettings}
                  disabled={lineSaving}
                >
                  {lineSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                  {lineSaving ? "驗證連線中..." : "連接 LINE OA"}
                </Button>
              </div>

              {/* Setup guide */}
              <div className="border border-brand-100 bg-brand-50/50 rounded-xl p-5">
                <h4 className="text-sm font-semibold text-brand-800 mb-3 flex items-center gap-2">
                  <ExternalLink className="w-4 h-4" /> 如何取得 LINE OA API 資訊？
                </h4>
                <ol className="text-xs text-brand-700 space-y-2 list-decimal list-inside">
                  <li>前往 <span className="font-medium">LINE Developers Console</span> → 選擇你的 Provider</li>
                  <li>建立或選擇 <span className="font-medium">Messaging API Channel</span></li>
                  <li>在 Basic settings 複製 <span className="font-medium">Channel ID</span> 和 <span className="font-medium">Channel Secret</span></li>
                  <li>在 Messaging API 頁面按 Issue 取得 <span className="font-medium">Channel Access Token (long-lived)</span></li>
                  <li>串接成功後，將本系統產生的 <span className="font-medium">Webhook URL</span> 貼回 LINE Developers</li>
                  <li>啟用 <span className="font-medium">Use webhook</span>，完成！</li>
                </ol>
              </div>
            </>
          )}

          {/* Status message */}
          {lineMsg && (
            <div className={`mt-4 p-3 rounded-lg text-sm ${
              lineMsg.type === "ok" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
            }`}>
              {lineMsg.text}
            </div>
          )}
        </div>
      )}

      {/* ===== CONTACTS TAB ===== */}
      {activeTab === "contacts" && (
      <div className="flex flex-1 min-h-0 overflow-hidden">
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
                    <span className={`font-medium text-sm truncate ${c.unread > 0 ? "text-gray-900 font-semibold" : "text-gray-900"}`}>
                      {c.displayName}
                    </span>
                    {c.source === "line" && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-green-100 text-green-700">LINE</span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[c.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {STATUS_LABELS[c.status as StatusFilter] ?? c.status}
                    </span>
                  </div>
                  {c.lastMessageText ? (
                    <p className={`text-xs truncate mt-0.5 ${c.unread > 0 ? "text-gray-700 font-medium" : "text-gray-400"}`}>
                      {c.lastMessageText}
                    </p>
                  ) : c.company ? (
                    <p className="text-xs text-gray-500 truncate">{c.company}</p>
                  ) : null}
                  {c.lastMessageAt && (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {new Date(c.lastMessageAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                </div>
                {c.unread > 0 && (
                  <span className="shrink-0 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {c.unread > 9 ? "9+" : c.unread}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ---------- RIGHT PANEL: Chat + Detail ---------- */}
      <div className="w-2/3 flex flex-col">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <MessageCircle className="w-16 h-16 mb-3" />
            <p className="text-lg">選擇客戶查看對話</p>
            <p className="text-sm mt-1">LINE 客戶的訊息會即時顯示在這裡</p>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white shrink-0">
              {selected.avatarUrl ? (
                <img src={selected.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center">
                  <User className="w-4 h-4 text-gray-500" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-gray-900">{selected.displayName}</span>
                  {selected.source === "line" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">LINE</span>
                  )}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[selected.status]}`}>
                    {STATUS_LABELS[selected.status as StatusFilter] ?? selected.status}
                  </span>
                </div>
                {selected.company && <p className="text-xs text-gray-500 truncate">{selected.company}</p>}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowDetail(!showDetail)}
                  className={`p-2 rounded-lg transition-colors ${showDetail ? "bg-brand-50 text-brand-600" : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"}`}
                  title="客戶詳情"
                >
                  <User className="w-4 h-4" />
                </button>
                <select
                  value={selected.status}
                  onChange={(e) => updateStatus(e.target.value)}
                  className="text-xs px-2 py-1 rounded-lg border border-gray-200 cursor-pointer bg-white"
                >
                  <option value="new">新客戶</option>
                  <option value="contacted">已聯繫</option>
                  <option value="proposal">提案中</option>
                  <option value="signed">已簽約</option>
                </select>
              </div>
            </div>

            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Chat messages */}
              <div className="flex-1 flex flex-col min-w-0">
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
                  {chatLoading && chatMessages.length === 0 && (
                    <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
                      <RefreshCw className="w-4 h-4 animate-spin mr-2" /> 載入對話...
                    </div>
                  )}
                  {!chatLoading && chatMessages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-sm">
                      <MessageCircle className="w-8 h-8 mb-2 opacity-30" />
                      <p>尚無對話記錄</p>
                      {selected.source === "line" && <p className="text-xs mt-1">客戶在 LINE 傳送訊息後會顯示在這裡</p>}
                    </div>
                  )}
                  {chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
                    >
                      <div className={`max-w-[75%] ${msg.direction === "outbound" ? "" : ""}`}>
                        {msg.attachment?.dataUrl && msg.messageType === "image" && (
                          <img
                            src={msg.attachment.dataUrl}
                            alt="附件"
                            className="max-w-full max-h-60 rounded-lg mb-1 cursor-pointer border border-gray-200"
                            onClick={() => window.open(msg.attachment!.dataUrl!, "_blank")}
                          />
                        )}
                        {msg.attachment?.url && msg.messageType === "image" && !msg.attachment.dataUrl && (
                          <img
                            src={msg.attachment.url}
                            alt="附件"
                            className="max-w-full max-h-60 rounded-lg mb-1 cursor-pointer border border-gray-200"
                            onClick={() => window.open(msg.attachment!.url!, "_blank")}
                          />
                        )}
                        <div
                          className={`rounded-2xl px-4 py-2 text-sm ${
                            msg.direction === "outbound"
                              ? "bg-brand-600 text-white rounded-br-md"
                              : "bg-white text-gray-800 border border-gray-200 rounded-bl-md shadow-sm"
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{msg.text || `[${msg.messageType}]`}</p>
                        </div>
                        <p className={`text-[10px] mt-0.5 px-1 ${msg.direction === "outbound" ? "text-right text-gray-400" : "text-gray-400"}`}>
                          {new Date(msg.timestamp).toLocaleString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
                          {msg.direction === "outbound" && <span className="ml-1">· 你</span>}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>

                {/* Message input */}
                <div className="px-4 py-3 border-t border-gray-200 bg-white shrink-0">
                  <div className="flex gap-2">
                    <input
                      className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder={selected.source === "line" ? "輸入訊息（會推送到客戶的 LINE）..." : "輸入備註訊息..."}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      disabled={chatSending}
                    />
                    <button
                      onClick={sendMessage}
                      disabled={chatSending || !chatInput.trim()}
                      className="px-4 py-2 bg-brand-600 text-white rounded-xl hover:bg-brand-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium shrink-0"
                    >
                      {chatSending ? "傳送中..." : "傳送"}
                    </button>
                  </div>
                  {selected.source === "line" && (
                    <p className="text-[10px] text-gray-400 mt-1 text-center">訊息會透過 LINE OA 推送給客戶</p>
                  )}
                </div>
              </div>

              {/* Detail sidebar (toggleable) */}
              {showDetail && (
                <div className="w-72 border-l border-gray-200 overflow-y-auto shrink-0 bg-white">
                  {/* info grid */}
                  <div className="p-4 space-y-3 border-b border-gray-100">
                    {([
                      { key: "phone", icon: Phone, label: "電話" },
                      { key: "email", icon: Mail, label: "電子郵件" },
                      { key: "company", icon: Building, label: "公司" },
                      { key: "title", icon: Briefcase, label: "職稱" },
                      { key: "address", icon: MapPin, label: "地址" },
                    ] as const).map(({ key, icon: Icon, label }) => (
                      <div key={key} className="group">
                        <label className="text-[10px] text-gray-400 flex items-center gap-1 mb-0.5">
                          <Icon className="w-3 h-3" /> {label}
                        </label>
                        {editingField === key ? (
                          <div className="flex gap-1">
                            <input
                              autoFocus
                              className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitEdit();
                                if (e.key === "Escape") setEditingField(null);
                              }}
                            />
                            <button onClick={commitEdit} className="text-brand-600 text-xs">OK</button>
                          </div>
                        ) : (
                          <p
                            className="text-xs text-gray-800 cursor-pointer hover:text-brand-600 flex items-center gap-1"
                            onClick={() => startEdit(key, (selected[key] as string) ?? "")}
                          >
                            {(selected[key] as string) || <span className="text-gray-300">未填寫</span>}
                            <Edit3 className="w-2.5 h-2.5 opacity-0 group-hover:opacity-50" />
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* tags */}
                  <div className="p-4 border-b border-gray-100">
                    <label className="text-[10px] text-gray-400 flex items-center gap-1 mb-2">
                      <Tag className="w-3 h-3" /> 標籤
                    </label>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {selected.tags.map((t) => (
                        <span key={t} className="inline-flex items-center gap-0.5 text-[10px] bg-brand-50 text-brand-700 px-1.5 py-0.5 rounded-full">
                          {t}
                          <button onClick={() => removeTag(t)} className="hover:text-red-500"><X className="w-2.5 h-2.5" /></button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <input
                        className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        placeholder="新增標籤..."
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") addTag(newTag); }}
                      />
                      <button onClick={() => addTag(newTag)} className="text-brand-600 text-xs px-1">+</button>
                    </div>
                  </div>

                  {/* notes */}
                  <div className="p-4 border-b border-gray-100">
                    <label className="text-[10px] text-gray-400 mb-1 block">備註</label>
                    <textarea
                      className="w-full text-xs border border-gray-200 rounded-lg p-2 min-h-[80px] focus:outline-none focus:ring-1 focus:ring-brand-500 resize-y"
                      placeholder="輸入備註..."
                      value={notesDraft}
                      onChange={(e) => handleNotesChange(e.target.value)}
                    />
                    <p className="text-[9px] text-gray-400 mt-0.5">自動儲存</p>
                  </div>

                  {/* card image */}
                  {selected.cardImageUrl && (
                    <div className="p-4 border-b border-gray-100">
                      <label className="text-[10px] text-gray-400 mb-1 block">名片</label>
                      <img
                        src={selected.cardImageUrl}
                        alt="名片"
                        className="w-full rounded-lg border border-gray-200 max-h-32 object-contain bg-gray-50 cursor-pointer"
                        onClick={() => window.open(selected.cardImageUrl!, "_blank")}
                      />
                    </div>
                  )}

                  {/* delete */}
                  <div className="p-4">
                    <button onClick={deleteContact} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                      <Trash2 className="w-3 h-3" /> 刪除客戶
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
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
      )}
    </div>
  );
};
