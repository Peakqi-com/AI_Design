import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "./Button";
import {
  AlertTriangle,
  Calculator,
  Camera,
  Check,
  ClipboardCopy,
  Edit3,
  ExternalLink,
  FileText,
  FolderPlus,
  Link2,
  ListChecks,
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
import { buildPricingReferenceText, COMMON_UNITS } from "@/lib/crm/pricing-standards";

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

type CrmTab = "contacts" | "line-settings" | "pricing";

interface PricingItem {
  id: string;
  name: string;
  unit: string;
  unitPrice: number;
  category: string;
  aliases?: string[];
  note?: string;
}

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

interface CRMSystemProps {
  onNavigateToProjects?: () => void;
}

export const CRMSystem: React.FC<CRMSystemProps> = ({ onNavigateToProjects }) => {
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

  /* ---- pricing standards ---- */
  const [pricingItems, setPricingItems] = useState<PricingItem[]>([]);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingSaving, setPricingSaving] = useState(false);
  const [pricingDirty, setPricingDirty] = useState(false);
  const [pricingMsg, setPricingMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const fetchPricing = useCallback(async () => {
    setPricingLoading(true);
    try {
      const scope = userScopeRef.current;
      const params = scope ? `?userId=${encodeURIComponent(scope)}` : "";
      const res = await fetch(`/api/crm/settings/pricing${params}`, { headers: buildHeaders() });
      if (res.ok) {
        const data = await res.json();
        setPricingItems(data.items || []);
        setPricingDirty(false);
      }
    } catch { /* ignore */ } finally {
      setPricingLoading(false);
    }
  }, [buildHeaders]);

  useEffect(() => {
    if (activeTab === "pricing" && userScope) fetchPricing();
  }, [activeTab, userScope]); // eslint-disable-line react-hooks/exhaustive-deps

  const savePricing = async () => {
    setPricingSaving(true);
    setPricingMsg(null);
    try {
      const scope = userScopeRef.current;
      const res = await fetch(`/api/crm/settings/pricing`, {
        method: "PUT",
        headers: buildHeaders(),
        body: JSON.stringify({ userId: scope, items: pricingItems }),
      });
      if (res.ok) {
        const data = await res.json();
        setPricingItems(data.items || []);
        setPricingDirty(false);
        setPricingMsg({ type: "ok", text: "已儲存，AI 報價會立即套用新單價" });
      } else {
        setPricingMsg({ type: "err", text: "儲存失敗，請重試" });
      }
    } catch {
      setPricingMsg({ type: "err", text: "網路錯誤，請重試" });
    } finally {
      setPricingSaving(false);
    }
  };

  const resetPricing = async () => {
    if (!confirm("確定要重設為預設標準報價表嗎？你目前的自訂內容會被覆蓋。")) return;
    setPricingSaving(true);
    try {
      const scope = userScopeRef.current;
      const params = scope ? `?userId=${encodeURIComponent(scope)}` : "";
      const res = await fetch(`/api/crm/settings/pricing${params}`, { method: "DELETE", headers: buildHeaders() });
      if (res.ok) {
        const data = await res.json();
        setPricingItems(data.items || []);
        setPricingDirty(false);
        setPricingMsg({ type: "ok", text: "已重設為預設報價表" });
      }
    } catch { /* ignore */ } finally {
      setPricingSaving(false);
    }
  };

  const updatePricingItem = (id: string, patch: Partial<PricingItem>) => {
    setPricingItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    setPricingDirty(true);
  };
  const removePricingItem = (id: string) => {
    setPricingItems((prev) => prev.filter((it) => it.id !== id));
    setPricingDirty(true);
  };
  const addPricingItem = () => {
    setPricingItems((prev) => [
      ...prev,
      { id: `new_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: "", unit: "式", unitPrice: 0, category: "其他" },
    ]);
    setPricingDirty(true);
  };

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

  /* ---- AI conversation summary ---- */
  interface ChatSummary {
    topic: string;
    customerIntent: string;
    keyPoints: string[];
    nextActions: string[];
    sentiment: "positive" | "neutral" | "negative" | "urgent";
    suggestedReply?: string;
  }

  const [summary, setSummary] = useState<ChatSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  // Reset summary when switching contacts
  useEffect(() => {
    setSummary(null);
    setSummaryError(null);
    setShowSummary(false);
  }, [selected?.id]);

  const runSummary = async () => {
    if (!selected || chatMessages.length === 0) return;
    const d = await credits.confirmAndDeduct("AI 對話整理", "ai-social-post");
    if (!d.ok) return;

    setSummaryLoading(true);
    setSummaryError(null);
    setShowSummary(true);
    try {
      const transcript = chatMessages
        .slice(-50)
        .map((m) => {
          const who = m.direction === "outbound" ? "我方" : selected.displayName;
          const time = new Date(m.timestamp).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
          const content = m.text || `[${m.messageType}]`;
          return `[${time}] ${who}：${content}`;
        })
        .join("\n");

      const prompt = `你是一位專業的客戶服務顧問。下面是我（室內設計師）與客戶「${selected.displayName}」在 LINE 上的對話記錄，請幫我整理重點。

對話記錄：
${transcript}

請以 JSON 格式回覆，只輸出 JSON 不要其他文字，欄位如下：
{
  "topic": "這段對話的主題（一句話，10-20 字）",
  "customerIntent": "客戶目前的意圖或需求（具體說明，30-60 字）",
  "keyPoints": ["3-5 個對話中提到的關鍵資訊或客戶訴求"],
  "nextActions": ["2-4 個我應該採取的後續行動（具體、可執行）"],
  "sentiment": "positive / neutral / negative / urgent 其中一個（評估客戶情緒/急迫性）",
  "suggestedReply": "如果客戶最後一句話需要回覆，給我一句適合的回覆內容（沒必要回覆就留空字串）"
}`;

      const res = await fetch("/api/ai/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, temperature: 0.4, jsonMode: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "AI 整理失敗");
      }
      const data = await res.json();
      const text = (data.text || "").trim();
      const jsonStr = text.match(/\{[\s\S]*\}/)?.[0] || text;
      const parsed = JSON.parse(jsonStr) as ChatSummary;
      setSummary(parsed);
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : "整理失敗，請重試");
    } finally {
      setSummaryLoading(false);
    }
  };

  const useReplyDraft = () => {
    if (summary?.suggestedReply) {
      setChatInput(summary.suggestedReply);
    }
  };

  /* ---- AI: extract project + quotation + workflow from conversation ---- */
  interface ExtractedQuotationItem {
    name: string;
    description?: string;
    unit?: string;
    quantity: number;
    unitPrice: number;
  }
  interface ExtractedWorkflowTask {
    title: string;
    detail?: string;
    date?: string;
    time?: string;
  }
  interface ExtractedContactDetails {
    phone?: string;
    email?: string;
    company?: string;
    address?: string;
    title?: string;
  }
  interface ExtractedProject {
    projectName: string;
    clientName: string;
    phase: string;
    budget: string;
    note: string;
    quotationItems: ExtractedQuotationItem[];
    workflowTasks: ExtractedWorkflowTask[];
    contactDetails: ExtractedContactDetails;
  }

  interface ExistingProject {
    id: string;
    name: string;
    clientName: string;
    phase: string;
    budget: string;
    status: string;
    note?: string;
    quotationItems?: Array<{ id: string; name: string; description?: string; unit?: string; quantity: number; unitPrice: number }>;
    workflowTasks?: Array<{ id: string; title: string; detail?: string; date?: string; time?: string; done?: boolean }>;
    updatedAt: string;
  }

  // Mode: "picker" = choose new vs update existing | "preview" = show editable extraction
  const [extractStep, setExtractStep] = useState<"picker" | "preview">("picker");
  const [extractMode, setExtractMode] = useState<"create" | "update">("create");
  const [linkedProjectId, setLinkedProjectId] = useState<string | null>(null);
  const [existingProjects, setExistingProjects] = useState<ExistingProject[]>([]);
  const [existingProjectsLoading, setExistingProjectsLoading] = useState(false);
  const [showExtractModal, setShowExtractModal] = useState(false);
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedProject | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);

  // Open the modal — start by fetching existing projects for this contact
  const openExtractFlow = async () => {
    if (!selected || chatMessages.length === 0) return;
    setShowExtractModal(true);
    setExtractStep("picker");
    setExtracted(null);
    setExtractError(null);
    setExistingProjectsLoading(true);
    try {
      const params = new URLSearchParams();
      if (userScope) params.set("userId", userScope);
      const res = await fetch(`/api/projects?${params.toString()}`, { headers: buildHeaders() });
      if (res.ok) {
        const data = await res.json();
        const all: ExistingProject[] = (data.projects || []).map((p: Record<string, unknown>) => ({
          id: String(p.id),
          name: String(p.name || ""),
          clientName: String(p.clientName || ""),
          phase: String(p.phase || ""),
          budget: String(p.budget || ""),
          status: String(p.status || "draft"),
          note: typeof p.note === "string" ? p.note : "",
          quotationItems: Array.isArray(p.quotationItems) ? (p.quotationItems as ExistingProject["quotationItems"]) : [],
          workflowTasks: Array.isArray(p.workflowTasks) ? (p.workflowTasks as ExistingProject["workflowTasks"]) : [],
          updatedAt: String(p.updatedAt || ""),
        }));
        // Filter: this contact's linked projects + projects with matching clientName
        const filtered = all.filter((p) => {
          const linked = (p as unknown as { linkedContactId?: string }).linkedContactId === selected.id;
          const nameMatch = p.clientName && (
            p.clientName === selected.displayName ||
            p.clientName.includes(selected.displayName) ||
            selected.displayName.includes(p.clientName)
          );
          return linked || nameMatch;
        });
        setExistingProjects(filtered);
        // Auto-suggest: if exactly one match, preselect update mode
        if (filtered.length === 1) {
          setExtractMode("update");
          setLinkedProjectId(filtered[0].id);
        } else {
          setExtractMode("create");
          setLinkedProjectId(null);
        }
      } else {
        setExistingProjects([]);
      }
    } catch {
      setExistingProjects([]);
    } finally {
      setExistingProjectsLoading(false);
    }
  };

  const runExtraction = async () => {
    if (!selected || chatMessages.length === 0) return;
    const d = await credits.confirmAndDeduct(
      extractMode === "update" ? "AI 更新專案" : "AI 對話建立專案",
      "ai-social-post",
    );
    if (!d.ok) return;

    setExtractStep("preview");
    setExtractLoading(true);
    setExtractError(null);
    setExtracted(null);
    try {
      const transcript = chatMessages
        .slice(-80)
        .map((m) => {
          const who = m.direction === "outbound" ? "我方（設計師）" : `客戶（${selected.displayName}）`;
          const time = new Date(m.timestamp).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
          const content = m.text || `[${m.messageType}]`;
          return `[${time}] ${who}：${content}`;
        })
        .join("\n");

      const existingContact = `
現有客戶資料（不要覆蓋已有值）：
- 姓名：${selected.displayName}
- 電話：${selected.phone || "(未填)"}
- Email：${selected.email || "(未填)"}
- 公司：${selected.company || "(未填)"}
- 地址：${selected.address || "(未填)"}`;

      const targetProject = extractMode === "update" && linkedProjectId
        ? existingProjects.find((p) => p.id === linkedProjectId)
        : null;

      // 標準報價表 — 讀使用者帳號自訂的那份（管理介面可增修），讓 AI 在客戶
      // 沒明講價格時，依此填入參考單價
      let pricingItems: Array<{ name: string; unit: string; unitPrice: number; note?: string }> = [];
      try {
        const pr = await fetch(
          `/api/crm/settings/pricing?userId=${encodeURIComponent(userScope || "")}`,
          { headers: buildHeaders() },
        );
        if (pr.ok) {
          const pd = await pr.json();
          pricingItems = pd.items || [];
        }
      } catch { /* ignore — fall back to empty */ }
      const pricingBlock =
        `\n【公司標準報價表（客戶若沒明講單價，請優先對應此表填入 unitPrice，並在 description 標註「參考標準價」；對應不到才填 0 並標「待確認」）】\n` +
        buildPricingReferenceText(pricingItems) +
        `\n注意：工程管理費為工程總額的 8-10%，請以百分比在備註說明，不要當成固定單價項目。\n`;

      let prompt: string;
      if (targetProject) {
        // UPDATE MODE: send existing project snapshot, ask AI to return merged final state
        const existingItems = (targetProject.quotationItems || [])
          .map((i, idx) => `  ${idx + 1}. ${i.name} | ${i.description || "-"} | ${i.quantity} ${i.unit || "式"} | 單價 ${i.unitPrice}`)
          .join("\n") || "  （目前沒有報價項目）";
        const existingTasks = (targetProject.workflowTasks || [])
          .map((t, idx) => `  ${idx + 1}. ${t.title} | ${t.date || "未排"} ${t.time || ""} | ${t.done ? "✓已完成" : "進行中"}`)
          .join("\n") || "  （目前沒有工作流程任務）";

        prompt = `你是一位資深室內設計專案經理。客戶「${selected.displayName}」已有一個進行中的專案，我（設計師）和他在 LINE 上又聊了新內容。請根據新對話更新專案。

【現有專案資料】
專案名稱：${targetProject.name}
階段：${targetProject.phase}
預算：${targetProject.budget}
備註：${targetProject.note || "(無)"}

現有報價項目：
${existingItems}

現有工作流程任務：
${existingTasks}

${existingContact}
${pricingBlock}
【最新對話記錄】
${transcript}

請依照下列原則更新專案，並以 JSON 回覆「更新後的完整專案狀態」（不是只給新增的部分）：

1. **報價項目**：
   - 保留現有項目，除非對話明確表示取消（取消的不要放進結果）
   - 如果對話提到新的工程項目，加入結果；單價優先對應上方標準報價表，標註「參考標準價」
   - 如果對話提到已有項目的數量/單價變動，更新該項目（客戶明講的價格優先於標準價）
   - 對話沒提到的舊項目原樣保留（不要改動其單價）

2. **工作流程任務**：
   - 保留現有任務，除非對話明確表示取消
   - 如果對話約定新時程（例如「下週三量尺」），加入新任務
   - 如果對話提到舊任務的日期改變或已完成，更新該任務

3. **基本資訊**：
   - 階段：根據對話最新進展更新（例如從「需求訪談」進到「提案中」）
   - 預算：客戶有提到新預算就更新
   - 備註：在原備註後追加新進度（用 \\n 換行），不要刪掉舊內容

4. **客戶聯絡資料**：對話中新提到的才填，否則空字串

只輸出 JSON，不要其他文字。格式：
{
  "projectName": "專案名稱（通常保留原名）",
  "clientName": "客戶姓名（${selected.displayName}）",
  "phase": "更新後階段",
  "budget": "預算",
  "note": "更新後的完整備註",
  "quotationItems": [{ "name": "...", "description": "...", "unit": "對應標準表的單位（坪/尺/式/台/間/車/平方米/%）", "quantity": 數字, "unitPrice": 數字 }],
  "workflowTasks": [{ "title": "...", "detail": "...", "date": "YYYY-MM-DD 或空", "time": "HH:mm 或空" }],
  "contactDetails": { "phone": "", "email": "", "company": "", "address": "", "title": "" }
}`;
      } else {
        // CREATE MODE: original prompt
        prompt = `你是一位資深室內設計專案經理。下面是設計師與客戶在 LINE 上的對話。請從對話中提取資訊，建立一個室內設計專案的草稿，包含：基本資訊、報價項目、工作流程任務、客戶聯絡資訊。

${existingContact}
${pricingBlock}
對話記錄：
${transcript}

請以 JSON 格式回覆，只輸出 JSON 不要其他文字。如果某些資訊對話中沒提到，數字欄位填 0、字串欄位填合理推測或空字串、陣列可以給空陣列。
報價項目單價規則：(1) 客戶有明講價格 → 用客戶的價格。(2) 客戶沒講但對應得到上方標準報價表 → 填標準單價並在 description 標註「參考標準價」。(3) 都對應不到 → unitPrice 填 0 並標註「待確認」。

格式：
{
  "projectName": "簡短專案名稱（例如：王小姐三房兩廳裝修、北歐風新成屋）",
  "clientName": "客戶姓名（預設用「${selected.displayName}」）",
  "phase": "目前階段（需求訪談 / 提案中 / 報價中 / 簽約 / 施工中 / 完工 之一）",
  "budget": "預算範圍（例如：80-100萬、待定）",
  "note": "專案備註（30-100 字，概述客戶需求、風格偏好、特殊要求）",
  "quotationItems": [
    { "name": "項目名稱（例如：客廳系統櫃）", "description": "規格或說明（待確認的標註「待確認」）", "unit": "計價單位（對應標準表，如 坪/尺/式/台/間/車/平方米/%）", "quantity": 數字, "unitPrice": 數字 }
  ],
  "workflowTasks": [
    { "title": "任務名稱（例如：現場丈量、提案簡報、簽約）", "detail": "細節說明（可選）", "date": "YYYY-MM-DD 或空字串", "time": "HH:mm 或空字串" }
  ],
  "contactDetails": {
    "phone": "電話（對話中提到才填，否則空字串）",
    "email": "Email（同上）",
    "company": "公司（同上）",
    "address": "地址（同上）",
    "title": "職稱（同上）"
  }
}`;
      }

      const res = await fetch("/api/ai/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, temperature: 0.4, jsonMode: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "AI 提取失敗");
      }
      const data = await res.json();
      const text = (data.text || "").trim();
      const jsonStr = text.match(/\{[\s\S]*\}/)?.[0] || text;
      const parsed = JSON.parse(jsonStr) as ExtractedProject;

      // Sanitize defaults
      parsed.projectName = parsed.projectName?.trim() || targetProject?.name || `${selected.displayName} 的專案`;
      parsed.clientName = parsed.clientName?.trim() || selected.displayName;
      parsed.phase = parsed.phase?.trim() || targetProject?.phase || "需求訪談";
      parsed.budget = parsed.budget?.trim() || targetProject?.budget || "待定";
      parsed.note = parsed.note?.trim() || targetProject?.note || "";
      parsed.quotationItems = (parsed.quotationItems || []).map((it) => ({
        name: String(it.name || "").trim(),
        description: String(it.description || "").trim(),
        unit: String(it.unit || "").trim() || "式",
        quantity: Number(it.quantity) || 1,
        unitPrice: Number(it.unitPrice) || 0,
      })).filter((it) => it.name);
      parsed.workflowTasks = (parsed.workflowTasks || []).map((t) => ({
        title: String(t.title || "").trim(),
        detail: String(t.detail || "").trim(),
        date: String(t.date || "").trim(),
        time: String(t.time || "").trim(),
      })).filter((t) => t.title);
      parsed.contactDetails = parsed.contactDetails || {};

      setExtracted(parsed);
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : "提取失敗，請重試");
    } finally {
      setExtractLoading(false);
    }
  };

  const createProjectFromExtraction = async () => {
    if (!extracted || !selected) return;
    setCreatingProject(true);
    try {
      // 1) Update contact details if AI extracted new ones (non-empty + not already set)
      const cd = extracted.contactDetails;
      const contactPatch: Record<string, string> = {};
      if (cd.phone && !selected.phone) contactPatch.phone = cd.phone;
      if (cd.email && !selected.email) contactPatch.email = cd.email;
      if (cd.company && !selected.company) contactPatch.company = cd.company;
      if (cd.address && !selected.address) contactPatch.address = cd.address;
      if (cd.title && !selected.title) contactPatch.title = cd.title;
      if (Object.keys(contactPatch).length > 0) {
        await fetch(`/api/crm/contacts/${selected.id}`, {
          method: "PATCH",
          headers: buildHeaders(),
          body: JSON.stringify(contactPatch),
        }).catch(() => undefined);
      }

      const isUpdate = extractMode === "update" && linkedProjectId;
      const targetProject = isUpdate ? existingProjects.find((p) => p.id === linkedProjectId) : null;

      // 2) Build quotationItems — preserve IDs for items that match existing ones by name (allows downstream tracking)
      const existingItemsByName = new Map(
        (targetProject?.quotationItems || []).map((i) => [i.name.trim(), i.id]),
      );
      const quotationItems = extracted.quotationItems.map((it) => ({
        id: existingItemsByName.get(it.name.trim()) || `qi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: it.name,
        description: it.description || "",
        unit: it.unit || "式",
        quantity: it.quantity,
        unitPrice: it.unitPrice,
      }));

      // 3) Build workflowTasks — preserve IDs and done-state for matching tasks
      const existingTasksByTitle = new Map(
        (targetProject?.workflowTasks || []).map((t) => [t.title.trim(), t]),
      );
      const workflowTasks = extracted.workflowTasks.map((t) => {
        const existing = existingTasksByTitle.get(t.title.trim());
        return {
          id: existing?.id || `wt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          title: t.title,
          detail: t.detail || existing?.detail || "",
          date: t.date || existing?.date || "",
          time: t.time || existing?.time || "",
          owner: "",
          done: existing?.done || false,
          isCustom: true,
        };
      });

      if (isUpdate && targetProject) {
        // PATCH existing project — append-merge note so manual edits aren't lost
        const mergedNote = extracted.note.includes(targetProject.note || "")
          ? extracted.note
          : `${targetProject.note || ""}\n\n[${new Date().toLocaleString("zh-TW", { month: "numeric", day: "numeric" })} AI 更新]\n${extracted.note}`.trim();

        const res = await fetch(`/api/projects/${targetProject.id}`, {
          method: "PATCH",
          headers: buildHeaders(),
          body: JSON.stringify({
            name: extracted.projectName,
            phase: extracted.phase,
            budget: extracted.budget,
            note: mergedNote,
            linkedContactId: selected.id,
            quotationItems,
            workflowTasks,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || "更新失敗");
        }
      } else {
        // POST new project
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: buildHeaders(),
          body: JSON.stringify({
            userId: userScope,
            name: extracted.projectName,
            clientName: extracted.clientName,
            status: "draft",
            phase: extracted.phase,
            budget: extracted.budget,
            note: extracted.note || `從 LINE 對話自動建立 · 客戶：${selected.displayName}`,
            linkedContactId: selected.id,
            quotationItems,
            workflowTasks,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || "建立失敗");
        }
      }

      setShowExtractModal(false);
      setExtracted(null);
      setExtractStep("picker");
      setLinkedProjectId(null);
      // Navigate to projects page so user can see the result
      onNavigateToProjects?.();
    } catch (e) {
      alert(`建立專案失敗：${e instanceof Error ? e.message : "未知錯誤"}`);
    } finally {
      setCreatingProject(false);
    }
  };

  // Editable updaters for the preview Modal
  const updateExtractedField = <K extends keyof ExtractedProject>(key: K, value: ExtractedProject[K]) => {
    setExtracted((prev) => (prev ? { ...prev, [key]: value } : prev));
  };
  const updateQuotationItem = (idx: number, patch: Partial<ExtractedQuotationItem>) => {
    setExtracted((prev) => {
      if (!prev) return prev;
      const items = [...prev.quotationItems];
      items[idx] = { ...items[idx], ...patch };
      return { ...prev, quotationItems: items };
    });
  };
  const removeQuotationItem = (idx: number) => {
    setExtracted((prev) => {
      if (!prev) return prev;
      return { ...prev, quotationItems: prev.quotationItems.filter((_, i) => i !== idx) };
    });
  };
  const addQuotationItem = () => {
    setExtracted((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        quotationItems: [...prev.quotationItems, { name: "", description: "", unit: "式", quantity: 1, unitPrice: 0 }],
      };
    });
  };
  const updateWorkflowTask = (idx: number, patch: Partial<ExtractedWorkflowTask>) => {
    setExtracted((prev) => {
      if (!prev) return prev;
      const tasks = [...prev.workflowTasks];
      tasks[idx] = { ...tasks[idx], ...patch };
      return { ...prev, workflowTasks: tasks };
    });
  };
  const removeWorkflowTask = (idx: number) => {
    setExtracted((prev) => {
      if (!prev) return prev;
      return { ...prev, workflowTasks: prev.workflowTasks.filter((_, i) => i !== idx) };
    });
  };
  const addWorkflowTask = () => {
    setExtracted((prev) => {
      if (!prev) return prev;
      return { ...prev, workflowTasks: [...prev.workflowTasks, { title: "", detail: "", date: "", time: "" }] };
    });
  };

  const quotationTotal = (extracted?.quotationItems || []).reduce(
    (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
    0,
  );

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
    <div className="flex flex-col bg-white rounded-xl shadow overflow-hidden h-full min-h-[calc(100vh-8rem)]">
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
        <button
          onClick={() => setActiveTab("pricing")}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "pricing"
              ? "border-brand-600 text-brand-700"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          <Calculator className="w-4 h-4" /> 報價標準
        </button>
      </div>

      {/* ===== PRICING STANDARDS TAB ===== */}
      {activeTab === "pricing" && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto w-full">
            <div className="flex items-start justify-between gap-4 mb-1">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">標準報價表</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  AI 從 LINE 對話歸納報價時，客戶沒明講價格就依這份表自動填入單價。隨時可增修。
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={resetPricing}
                  disabled={pricingSaving}
                  className="text-xs px-3 py-2 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                >
                  重設預設
                </button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={savePricing}
                  disabled={pricingSaving || !pricingDirty}
                  className="gap-1.5"
                >
                  {pricingSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {pricingSaving ? "儲存中" : pricingDirty ? "儲存變更" : "已儲存"}
                </Button>
              </div>
            </div>

            {pricingMsg && (
              <div className={`mt-3 mb-2 p-2.5 rounded-lg text-sm ${
                pricingMsg.type === "ok" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
              }`}>
                {pricingMsg.text}
              </div>
            )}

            {pricingLoading ? (
              <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" /> 載入中...
              </div>
            ) : (
              <div className="mt-4 border border-gray-200 rounded-xl overflow-hidden">
                {/* header row */}
                <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[11px] font-semibold text-gray-500">
                  <div className="col-span-3">工項名稱</div>
                  <div className="col-span-2">分類</div>
                  <div className="col-span-1">單位</div>
                  <div className="col-span-2">單價(NT$)</div>
                  <div className="col-span-3">別名 / 備註（逗號分隔）</div>
                  <div className="col-span-1"></div>
                </div>
                <div className="max-h-[calc(100vh-22rem)] overflow-y-auto divide-y divide-gray-100">
                  {pricingItems.map((it) => (
                    <div key={it.id} className="grid grid-cols-12 gap-2 px-3 py-2 items-center hover:bg-gray-50/60">
                      <input
                        className="col-span-3 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        placeholder="例：木作天花板"
                        value={it.name}
                        onChange={(e) => updatePricingItem(it.id, { name: e.target.value })}
                      />
                      <input
                        className="col-span-2 text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        placeholder="分類"
                        value={it.category}
                        onChange={(e) => updatePricingItem(it.id, { category: e.target.value })}
                      />
                      <input
                        className="col-span-1 text-xs border border-gray-200 rounded px-1.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 text-center"
                        placeholder="坪"
                        value={it.unit}
                        onChange={(e) => updatePricingItem(it.id, { unit: e.target.value })}
                      />
                      <input
                        type="number"
                        className="col-span-2 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        placeholder="0"
                        value={it.unitPrice}
                        onChange={(e) => updatePricingItem(it.id, { unitPrice: Number(e.target.value) || 0 })}
                      />
                      <input
                        className="col-span-3 text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 text-gray-600"
                        placeholder="拆除,打牆 / 8-10%"
                        value={[...(it.aliases || []), ...(it.note ? [it.note] : [])].join(", ")}
                        onChange={(e) => {
                          // crude split: everything is alias unless it looks like a note (contains %, 區間, 元)
                          const parts = e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
                          const notes = parts.filter((p) => /[%％]|區間|元|備註/.test(p));
                          const aliases = parts.filter((p) => !notes.includes(p));
                          updatePricingItem(it.id, { aliases, note: notes.join("；") || undefined });
                        }}
                      />
                      <div className="col-span-1 flex justify-end">
                        <button
                          onClick={() => removePricingItem(it.id)}
                          className="text-gray-300 hover:text-red-500 p-1"
                          title="刪除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={addPricingItem}
                  className="w-full py-2.5 text-sm text-brand-600 hover:bg-brand-50 border-t border-gray-200 flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Plus className="w-4 h-4" /> 新增工項
                </button>
              </div>
            )}

            <p className="text-[11px] text-gray-400 mt-3">
              提示：單位可填「坪 / 尺 / 式 / 台 / 間 / 車 / 平方米 / %」。別名讓 AI 對得上客戶的口語說法（例如「打牆」對應「拆除」）。百分比類（如工程管理費）單價填 0，在備註寫「8-10%」。
            </p>
          </div>
        </div>
      )}

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
      <div className="w-80 shrink-0 border-r border-gray-200 flex flex-col min-w-0">
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
                <div className="flex-1 min-w-0 overflow-hidden">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`font-medium text-sm truncate min-w-0 ${c.unread > 0 ? "text-gray-900 font-semibold" : "text-gray-900"}`}>
                      {c.displayName}
                    </span>
                    {c.source === "line" && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-green-100 text-green-700 shrink-0">LINE</span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[c.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {STATUS_LABELS[c.status as StatusFilter] ?? c.status}
                    </span>
                  </div>
                  {c.lastMessageText ? (
                    <p
                      className={`text-xs mt-0.5 truncate overflow-hidden whitespace-nowrap ${c.unread > 0 ? "text-gray-700 font-medium" : "text-gray-400"}`}
                      title={c.lastMessageText}
                    >
                      {c.lastMessageText}
                    </p>
                  ) : c.company ? (
                    <p className="text-xs text-gray-500 truncate overflow-hidden whitespace-nowrap">{c.company}</p>
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
      <div className="flex-1 flex flex-col min-w-0">
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
                  onClick={() => {
                    if (summary && !summaryLoading) {
                      setShowSummary((v) => !v);
                    } else {
                      void runSummary();
                    }
                  }}
                  disabled={summaryLoading || chatMessages.length === 0}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    showSummary && summary
                      ? "bg-brand-50 text-brand-700 border border-brand-200"
                      : "bg-brand-600 text-white hover:bg-brand-700"
                  }`}
                  title="AI 整理整段對話"
                >
                  {summaryLoading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  {summaryLoading ? "整理中..." : summary ? (showSummary ? "收合摘要" : "展開摘要") : "AI 整理對話"}
                </button>
                <button
                  onClick={openExtractFlow}
                  disabled={extractLoading || chatMessages.length === 0}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="AI 從對話建立或更新室內設計專案"
                >
                  {extractLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FolderPlus className="w-3.5 h-3.5" />}
                  {extractLoading ? "分析中..." : "AI 建立 / 更新專案"}
                </button>
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
                {/* AI Summary card */}
                {showSummary && (
                  <div className="shrink-0 border-b border-brand-200 bg-gradient-to-br from-brand-50 to-purple-50 px-4 py-3 max-h-[40%] overflow-y-auto">
                    {summaryLoading && !summary && (
                      <div className="flex items-center gap-2 text-sm text-brand-700 py-2">
                        <RefreshCw className="w-4 h-4 animate-spin" /> AI 正在分析這段對話...
                      </div>
                    )}
                    {summaryError && (
                      <div className="text-sm text-red-600 py-2 flex items-center justify-between gap-2">
                        <span>整理失敗：{summaryError}</span>
                        <button onClick={runSummary} className="text-xs underline">重試</button>
                      </div>
                    )}
                    {summary && (
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Sparkles className="w-4 h-4 text-brand-600 shrink-0" />
                            <h4 className="text-sm font-semibold text-gray-900 truncate">{summary.topic}</h4>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              summary.sentiment === "urgent" ? "bg-red-100 text-red-700"
                              : summary.sentiment === "negative" ? "bg-orange-100 text-orange-700"
                              : summary.sentiment === "positive" ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-600"
                            }`}>
                              {summary.sentiment === "urgent" ? "緊急" : summary.sentiment === "negative" ? "不滿" : summary.sentiment === "positive" ? "正面" : "中性"}
                            </span>
                            <button
                              onClick={runSummary}
                              disabled={summaryLoading}
                              className="p-1 text-gray-400 hover:text-brand-600 hover:bg-white/50 rounded transition-colors disabled:opacity-40"
                              title="重新整理"
                            >
                              <RefreshCw className={`w-3 h-3 ${summaryLoading ? "animate-spin" : ""}`} />
                            </button>
                            <button
                              onClick={() => setShowSummary(false)}
                              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-white/50 rounded transition-colors"
                              title="收合"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        <div className="bg-white/70 rounded-lg p-2.5 border border-brand-100">
                          <p className="text-[10px] font-semibold text-brand-700 mb-0.5">客戶意圖</p>
                          <p className="text-xs text-gray-800 leading-relaxed">{summary.customerIntent}</p>
                        </div>

                        {summary.keyPoints?.length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold text-brand-700 mb-1">關鍵重點</p>
                            <ul className="space-y-0.5">
                              {summary.keyPoints.map((p, i) => (
                                <li key={i} className="text-xs text-gray-700 flex gap-1.5">
                                  <span className="text-brand-500 shrink-0">•</span>
                                  <span>{p}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {summary.nextActions?.length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold text-brand-700 mb-1">建議行動</p>
                            <ul className="space-y-0.5">
                              {summary.nextActions.map((a, i) => (
                                <li key={i} className="text-xs text-gray-700 flex gap-1.5">
                                  <Check className="w-3 h-3 text-green-600 shrink-0 mt-0.5" />
                                  <span>{a}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {summary.suggestedReply && (
                          <div className="bg-white border border-brand-200 rounded-lg p-2.5">
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-[10px] font-semibold text-brand-700">建議回覆</p>
                              <button
                                onClick={useReplyDraft}
                                className="text-[10px] px-2 py-0.5 bg-brand-600 text-white rounded hover:bg-brand-700 transition-colors"
                              >
                                使用此回覆
                              </button>
                            </div>
                            <p className="text-xs text-gray-800 leading-relaxed italic">「{summary.suggestedReply}」</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

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

      {/* ========== AI 建立專案預覽 MODAL ========== */}
      {showExtractModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-purple-50 to-brand-50">
              <div className="flex items-center gap-2">
                <FolderPlus className="w-5 h-5 text-purple-600" />
                <h3 className="text-base font-bold text-gray-900">
                  {extractStep === "picker"
                    ? "選擇處理方式"
                    : extractMode === "update"
                    ? "AI 更新專案預覽"
                    : "AI 建立新專案預覽"}
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowExtractModal(false);
                  setExtracted(null);
                  setExtractError(null);
                  setExtractStep("picker");
                  setLinkedProjectId(null);
                }}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-white/60"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* ========== STEP 1: PICKER ========== */}
              {extractStep === "picker" && (
                <div className="space-y-4">
                  {existingProjectsLoading ? (
                    <div className="flex items-center justify-center py-8 text-gray-500">
                      <RefreshCw className="w-5 h-5 animate-spin mr-2" /> 檢查現有專案...
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-gray-600">
                        客戶「<span className="font-semibold">{selected?.displayName}</span>」
                        {existingProjects.length > 0
                          ? `已有 ${existingProjects.length} 個相關專案。你想要：`
                          : "目前沒有相關專案。"}
                      </p>

                      {/* Option: Create new */}
                      <button
                        onClick={() => { setExtractMode("create"); setLinkedProjectId(null); }}
                        className={`w-full text-left p-4 rounded-xl border-2 transition-colors ${
                          extractMode === "create"
                            ? "border-purple-500 bg-purple-50"
                            : "border-gray-200 hover:border-purple-300 bg-white"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                            extractMode === "create" ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-500"
                          }`}>
                            <Plus className="w-5 h-5" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-gray-900">建立新專案</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              AI 會從整段對話建立全新的專案、報價項目和工作流程
                            </p>
                          </div>
                          {extractMode === "create" && <Check className="w-5 h-5 text-purple-600 shrink-0" />}
                        </div>
                      </button>

                      {/* Existing projects list */}
                      {existingProjects.length > 0 && (
                        <>
                          <div className="flex items-center gap-2 text-xs text-gray-400 px-1">
                            <div className="flex-1 border-t border-gray-200" />
                            或更新現有專案
                            <div className="flex-1 border-t border-gray-200" />
                          </div>

                          {existingProjects.map((p) => {
                            const isSelected = extractMode === "update" && linkedProjectId === p.id;
                            return (
                              <button
                                key={p.id}
                                onClick={() => { setExtractMode("update"); setLinkedProjectId(p.id); }}
                                className={`w-full text-left p-4 rounded-xl border-2 transition-colors ${
                                  isSelected
                                    ? "border-purple-500 bg-purple-50"
                                    : "border-gray-200 hover:border-purple-300 bg-white"
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                                    isSelected ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-500"
                                  }`}>
                                    <FileText className="w-5 h-5" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">{p.phase}</span>
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">{p.budget}</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                      {p.quotationItems?.length || 0} 個報價項目 · {p.workflowTasks?.length || 0} 個任務
                                      {p.updatedAt && ` · 上次更新 ${new Date(p.updatedAt).toLocaleDateString("zh-TW")}`}
                                    </p>
                                    {p.note && (
                                      <p className="text-xs text-gray-400 mt-1 line-clamp-2">{p.note}</p>
                                    )}
                                  </div>
                                  {isSelected && <Check className="w-5 h-5 text-purple-600 shrink-0" />}
                                </div>
                              </button>
                            );
                          })}

                          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
                            💡 <span className="font-medium">更新模式</span>會保留原專案內容，AI 只會：新增新提到的項目／更新有變動的數量、單價、日期／在備註後追加新進度。手動勾選過的「完成」任務也會保留。
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ========== STEP 2: PREVIEW ========== */}
              {extractStep === "preview" && extractLoading && (
                <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                  <RefreshCw className="w-8 h-8 animate-spin text-purple-600 mb-3" />
                  <p className="text-sm font-medium">
                    {extractMode === "update" ? "AI 正在比對現有專案與新對話..." : "AI 正在分析整段對話..."}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">提取專案資訊、報價項目和工作流程</p>
                </div>
              )}

              {extractStep === "preview" && extractError && !extractLoading && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
                  <span className="text-sm text-red-700">提取失敗：{extractError}</span>
                  <button onClick={runExtraction} className="text-xs text-red-700 underline">重試</button>
                </div>
              )}

              {extractStep === "preview" && extracted && !extractLoading && (
                <div className="space-y-5">
                  <div className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                    <span>💡</span>
                    <div>
                      {extractMode === "update" ? (
                        <>
                          AI 已比對「<span className="font-semibold">{existingProjects.find((p) => p.id === linkedProjectId)?.name}</span>」與新對話，產生<span className="font-semibold text-purple-700">合併後</span>的完整狀態。
                          按「更新專案」會覆蓋專案的報價項目和工作流程清單（備註會在原內容後追加）。
                        </>
                      ) : (
                        <>以下是 AI 從對話推測的資訊。請檢視並修改後再按「建立專案」。建立後仍可在專案頁繼續編輯。</>
                      )}
                    </div>
                  </div>

                  {/* Basic info */}
                  <section>
                    <h4 className="text-sm font-bold text-gray-800 mb-2 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-brand-600" /> 專案基本資訊
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-gray-500 block mb-1">專案名稱 *</label>
                        <input
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                          value={extracted.projectName}
                          onChange={(e) => updateExtractedField("projectName", e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-gray-500 block mb-1">客戶名稱 *</label>
                        <input
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                          value={extracted.clientName}
                          onChange={(e) => updateExtractedField("clientName", e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-gray-500 block mb-1">目前階段</label>
                        <select
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                          value={extracted.phase}
                          onChange={(e) => updateExtractedField("phase", e.target.value)}
                        >
                          {["需求訪談", "提案中", "報價中", "簽約", "施工中", "完工"].map((p) => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] text-gray-500 block mb-1">預算</label>
                        <input
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                          placeholder="例如：80-100萬"
                          value={extracted.budget}
                          onChange={(e) => updateExtractedField("budget", e.target.value)}
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="text-[11px] text-gray-500 block mb-1">專案備註</label>
                        <textarea
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 min-h-[60px] focus:outline-none focus:ring-2 focus:ring-brand-500"
                          value={extracted.note}
                          onChange={(e) => updateExtractedField("note", e.target.value)}
                        />
                      </div>
                    </div>
                  </section>

                  {/* Quotation items */}
                  <section>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                        <Calculator className="w-4 h-4 text-brand-600" />
                        報價項目（{extracted.quotationItems.length}）
                      </h4>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">小計：</span>
                        <span className="text-sm font-bold text-brand-700">NT$ {quotationTotal.toLocaleString()}</span>
                        <button
                          onClick={addQuotationItem}
                          className="text-xs px-2 py-1 border border-brand-200 text-brand-700 rounded-lg hover:bg-brand-50 flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" /> 加項目
                        </button>
                      </div>
                    </div>
                    {extracted.quotationItems.length === 0 ? (
                      <p className="text-xs text-gray-400 italic py-4 text-center bg-gray-50 rounded-lg">對話中未提到具體報價項目，請手動新增</p>
                    ) : (
                      <div className="space-y-2">
                        {extracted.quotationItems.map((item, idx) => (
                          <div key={idx} className="border border-gray-200 rounded-lg p-2.5 bg-gray-50/40">
                            <div className="flex items-start gap-2">
                              <div className="flex-1 grid grid-cols-12 gap-2">
                                <input
                                  className="col-span-5 text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white"
                                  placeholder="項目名稱"
                                  value={item.name}
                                  onChange={(e) => updateQuotationItem(idx, { name: e.target.value })}
                                />
                                <input
                                  type="number"
                                  className="col-span-2 text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white"
                                  placeholder="數量"
                                  value={item.quantity}
                                  onChange={(e) => updateQuotationItem(idx, { quantity: Number(e.target.value) || 0 })}
                                />
                                <select
                                  className="col-span-2 text-xs border border-gray-200 rounded px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white"
                                  value={item.unit || "式"}
                                  onChange={(e) => updateQuotationItem(idx, { unit: e.target.value })}
                                >
                                  {COMMON_UNITS.map((u) => (
                                    <option key={u} value={u}>{u}</option>
                                  ))}
                                  {item.unit && !COMMON_UNITS.includes(item.unit as typeof COMMON_UNITS[number]) && (
                                    <option value={item.unit}>{item.unit}</option>
                                  )}
                                </select>
                                <input
                                  type="number"
                                  className="col-span-3 text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white"
                                  placeholder="單價"
                                  value={item.unitPrice}
                                  onChange={(e) => updateQuotationItem(idx, { unitPrice: Number(e.target.value) || 0 })}
                                />
                                <input
                                  className="col-span-12 text-[11px] border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white text-gray-600"
                                  placeholder="說明 / 規格（選填）"
                                  value={item.description || ""}
                                  onChange={(e) => updateQuotationItem(idx, { description: e.target.value })}
                                />
                              </div>
                              <button
                                onClick={() => removeQuotationItem(idx)}
                                className="text-gray-300 hover:text-red-500 p-1 shrink-0"
                                title="刪除"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Workflow tasks */}
                  <section>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                        <ListChecks className="w-4 h-4 text-brand-600" />
                        工作流程任務（{extracted.workflowTasks.length}）
                      </h4>
                      <button
                        onClick={addWorkflowTask}
                        className="text-xs px-2 py-1 border border-brand-200 text-brand-700 rounded-lg hover:bg-brand-50 flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" /> 加任務
                      </button>
                    </div>
                    {extracted.workflowTasks.length === 0 ? (
                      <p className="text-xs text-gray-400 italic py-4 text-center bg-gray-50 rounded-lg">對話中未提到具體任務</p>
                    ) : (
                      <div className="space-y-2">
                        {extracted.workflowTasks.map((task, idx) => (
                          <div key={idx} className="border border-gray-200 rounded-lg p-2.5 bg-gray-50/40">
                            <div className="flex items-start gap-2">
                              <div className="flex-1 grid grid-cols-12 gap-2">
                                <input
                                  className="col-span-6 text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white"
                                  placeholder="任務名稱"
                                  value={task.title}
                                  onChange={(e) => updateWorkflowTask(idx, { title: e.target.value })}
                                />
                                <input
                                  type="date"
                                  className="col-span-4 text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white"
                                  value={task.date || ""}
                                  onChange={(e) => updateWorkflowTask(idx, { date: e.target.value })}
                                />
                                <input
                                  type="time"
                                  className="col-span-2 text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white"
                                  value={task.time || ""}
                                  onChange={(e) => updateWorkflowTask(idx, { time: e.target.value })}
                                />
                                {task.detail && (
                                  <input
                                    className="col-span-12 text-[11px] border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white text-gray-600"
                                    placeholder="細節說明"
                                    value={task.detail}
                                    onChange={(e) => updateWorkflowTask(idx, { detail: e.target.value })}
                                  />
                                )}
                              </div>
                              <button
                                onClick={() => removeWorkflowTask(idx)}
                                className="text-gray-300 hover:text-red-500 p-1 shrink-0"
                                title="刪除"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Contact details patch (only show if AI extracted any) */}
                  {(extracted.contactDetails.phone || extracted.contactDetails.email || extracted.contactDetails.company || extracted.contactDetails.address || extracted.contactDetails.title) && (
                    <section>
                      <h4 className="text-sm font-bold text-gray-800 mb-2 flex items-center gap-1.5">
                        <UserCircle className="w-4 h-4 text-brand-600" />
                        客戶聯絡資料更新
                      </h4>
                      <p className="text-[11px] text-gray-500 mb-2">AI 從對話中發現的新資訊，建立專案時會更新到客戶資料（不覆蓋已有值）</p>
                      <div className="grid grid-cols-2 gap-2 bg-gray-50 rounded-lg p-3 border border-gray-200">
                        {(["phone", "email", "company", "title", "address"] as const).map((key) => {
                          const labels = { phone: "電話", email: "Email", company: "公司", title: "職稱", address: "地址" };
                          const existing = selected?.[key];
                          const newVal = extracted.contactDetails[key];
                          if (!newVal) return null;
                          return (
                            <div key={key}>
                              <label className="text-[10px] text-gray-500 block">{labels[key]}</label>
                              {existing ? (
                                <p className="text-xs text-gray-400 line-through">{existing}（保留）</p>
                              ) : (
                                <input
                                  className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                                  value={newVal}
                                  onChange={(e) =>
                                    updateExtractedField("contactDetails", { ...extracted.contactDetails, [key]: e.target.value })
                                  }
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </div>

            {/* Modal footer — picker step */}
            {extractStep === "picker" && !existingProjectsLoading && (
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50">
                <Button variant="outline" size="sm" onClick={() => { setShowExtractModal(false); setLinkedProjectId(null); }}>
                  取消
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={runExtraction}
                  disabled={extractMode === "update" && !linkedProjectId}
                  className="gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {extractMode === "update" ? "下一步：AI 比對更新" : "下一步：AI 開始分析"}
                </Button>
              </div>
            )}

            {/* Modal footer — preview step */}
            {extractStep === "preview" && extracted && !extractLoading && (
              <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-100 bg-gray-50">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setExtractStep("picker"); setExtracted(null); }}
                    className="text-xs text-gray-500 hover:text-brand-700"
                  >
                    ← 重選
                  </button>
                  <button
                    onClick={runExtraction}
                    className="text-xs text-gray-500 hover:text-brand-700 flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" /> 重新分析
                  </button>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setShowExtractModal(false); setExtracted(null); setExtractStep("picker"); }}>
                    取消
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={createProjectFromExtraction}
                    disabled={creatingProject || !extracted.projectName.trim() || !extracted.clientName.trim()}
                    className="gap-1.5"
                  >
                    {creatingProject ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    {creatingProject
                      ? (extractMode === "update" ? "更新中..." : "建立中...")
                      : (extractMode === "update" ? "更新專案並前往" : "建立專案並前往")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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
