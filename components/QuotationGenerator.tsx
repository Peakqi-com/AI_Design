import React, { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from './Button';
import { Printer, Download, Plus, Trash2, Sparkles, Calculator, FileText, MessageSquare, Bot, Paperclip, CheckCircle2, FileImage, RefreshCw } from 'lucide-react';
import { resolveClientUserScopeId } from "@/lib/client/user-scope";
import { COMMON_UNITS } from "@/lib/crm/pricing-standards";

interface QuoteItem {
  id: number;
  category: string;
  name: string;
  unit: string;
  quantity: number;
  price: number;
  source?: 'chat' | 'file' | 'manual'; // Track where this item came from
  confidence?: number;
}

interface QuotationGeneratorProps {
  initialProjectId?: string;
  onBack?: () => void;
}

interface ProjectListItem {
  id: string;
  name: string;
  clientName: string;
}

interface ProjectDetailItem extends ProjectListItem {
  linkedContactId?: string;
  status?: "draft" | "active" | "quoted" | "completed";
  phase?: string;
  budget?: string;
  coverImageUrl?: string;
  note?: string;
  quotationItems?: Array<{
    id: string;
    name: string;
    description?: string;
    unit?: string;
    quantity: number;
    unitPrice: number;
  }>;
  workflowTasks?: Array<{
    id: string;
    date?: string;
    time?: string;
    title: string;
    detail?: string;
    owner?: string;
    done?: boolean;
  }>;
  dressSelectionRecords?: Array<{
    id: string;
    dressName?: string;
    dressSpec?: string;
    sourceLabel?: string;
  }>;
  quotationMeta?: {
    quoteNo?: string;
    validUntil?: string;
    status?: "draft" | "sent" | "accepted";
    note?: string;
    updatedAt?: string;
  };
}

interface ProjectContextAttachment {
  name: string;
  type: "image" | "text" | "data";
  sizeLabel: string;
}

interface CrmContactLite {
  id: string;
  displayName: string;
  source: "line" | "manual";
  lineUserId?: string;
}

interface LineSettingsLite {
  connected: boolean;
  channelId: string;
  webhookUrl: string;
}

const requestJson = async <T,>(input: RequestInfo, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, init);
  const raw = await response.text();
  const payload = raw ? (JSON.parse(raw) as T & { error?: string }) : ({} as T & { error?: string });
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
};

const parseBudgetValue = (value?: string): number => {
  const digits = String(value || "").replace(/[^\d]/g, "");
  const parsed = Number(digits || "0");
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundToThousand = (value: number): number => Math.max(0, Math.round(value / 1000) * 1000);

const buildQuoteItemsFromProject = (project: ProjectDetailItem): QuoteItem[] => {
  const budgetBase = parseBudgetValue(project.budget) || 360000;
  const renderCount = Math.max(1, project.dressSelectionRecords?.length || 0);
  const workflowCount = Math.max(1, project.workflowTasks?.length || 0);
  const workflowDone = (project.workflowTasks || []).filter((task) => task.done).length;
  const completionRate = workflowCount > 0 ? workflowDone / workflowCount : 0;
  const phaseLabel = project.phase?.trim() || "室內設計規劃";

  return [
    {
      id: 1,
      category: "設計師",
      name: `${phaseLabel}服務費`,
      unit: "式",
      quantity: 1,
      price: roundToThousand(budgetBase * 0.08),
      source: "chat",
      confidence: 94,
    },
    {
      id: 2,
      category: "渲染與提案",
      name: `空間渲染與風格提案（${renderCount} 版）`,
      unit: "式",
      quantity: 1,
      price: roundToThousand(renderCount * 18000),
      source: "file",
      confidence: 90,
    },
    {
      id: 3,
      category: "流程執行",
      name: `工程流程管理與現場協調（${workflowCount} 項）`,
      unit: "式",
      quantity: 1,
      price: roundToThousand(12000 + workflowCount * 3200),
      source: "chat",
      confidence: 92,
    },
    {
      id: 4,
      category: "軟裝配置",
      name: "家具與軟裝配置提案",
      unit: "式",
      quantity: 1,
      price: roundToThousand(budgetBase * 0.12),
      source: "manual",
      confidence: 86,
    },
    {
      id: 5,
      category: "視覺內容",
      name: completionRate >= 0.5 ? "空間動態影片分鏡提案" : "空間導覽短影音製作",
      unit: "式",
      quantity: 1,
      price: roundToThousand(budgetBase * 0.1),
      source: "manual",
      confidence: 88,
    },
  ];
};

export const QuotationGenerator: React.FC<QuotationGeneratorProps> = ({ initialProjectId, onBack }) => {
  const { data: session } = useSession();
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [crmContacts, setCrmContacts] = useState<CrmContactLite[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId || "");
  const [selectedProject, setSelectedProject] = useState<ProjectDetailItem | null>(null);
  const [lineScopeId, setLineScopeId] = useState("guest_server");
  const [lineOaSettings, setLineOaSettings] = useState<LineSettingsLite | null>(null);
  const [quoteNo, setQuoteNo] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [draftStatus, setDraftStatus] = useState<"draft" | "sent" | "accepted">("draft");
  const [draftNote, setDraftNote] = useState("");
  const [loadingProjectDraft, setLoadingProjectDraft] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const projectContext = useMemo(() => {
    if (!selectedProject) {
      return null;
    }
    const linkedContact = selectedProject.linkedContactId
      ? crmContacts.find((item) => item.id === selectedProject.linkedContactId)
      : undefined;
    const workflowCount = selectedProject.workflowTasks?.length || 0;
    const workflowDone = (selectedProject.workflowTasks || []).filter((task) => task.done).length;
    const dressCount = selectedProject.dressSelectionRecords?.length || 0;
    const summaryLines = [
      `1. 專案名稱：${selectedProject.name}`,
      `2. 客戶名稱：${selectedProject.clientName}`,
      `3. CRM 客戶：${linkedContact?.displayName || "未綁定"}${linkedContact?.source === "line" ? "（LINE）" : ""}`,
      `4. 對應 LINE OA：${
        lineOaSettings?.connected && lineOaSettings.channelId
          ? `Channel ${lineOaSettings.channelId}`
          : "目前帳號尚未串接 LINE OA"
      }`,
      `5. 階段 / 狀態：${selectedProject.phase || "未填寫"} / ${selectedProject.status || "draft"}`,
      `6. 預算：${selectedProject.budget || "待定"}`,
      `7. 流程進度：${workflowDone}/${workflowCount || 0} 已完成`,
      `8. 渲染紀錄：${dressCount} 筆`,
      `9. 專案備註：${selectedProject.note?.trim() || "未填寫"}`,
    ].join("\n");

    const attachments: ProjectContextAttachment[] = [];
    if (selectedProject.coverImageUrl) {
      attachments.push({ name: "專案封面圖", type: "image", sizeLabel: "URL" });
    }
    if (dressCount > 0) {
      attachments.push({
        name: `空間渲染紀錄 x${dressCount}`,
        type: "data",
        sizeLabel: "專案資料",
      });
    }
    if (workflowCount > 0) {
      attachments.push({
        name: `工程流程清單 x${workflowCount}`,
        type: "text",
        sizeLabel: "專案資料",
      });
    }
    if (attachments.length === 0) {
      attachments.push({ name: "尚無可用附件資料", type: "text", sizeLabel: "--" });
    }
    if (linkedContact?.source === "line" && linkedContact.lineUserId) {
      attachments.push({
        name: `LINE 客戶 ID：${linkedContact.lineUserId}`,
        type: "data",
        sizeLabel: "CRM",
      });
    }
    if (lineOaSettings?.connected && lineOaSettings.channelId) {
      attachments.push({
        name: `LINE OA Channel：${lineOaSettings.channelId}`,
        type: "data",
        sizeLabel: "LINE OA",
      });
    }

    return {
      name: `${selectedProject.clientName}（${selectedProject.name}）`,
      source: linkedContact?.source === "line" ? "LINE Official Account" : "Project Store",
      summaryLines,
      attachments,
    };
  }, [crmContacts, lineOaSettings, selectedProject]);

  useEffect(() => {
    const sessionUser = session?.user as { id?: string; email?: string | null } | undefined;
    setLineScopeId(resolveClientUserScopeId(sessionUser?.id || null, sessionUser?.email || null));
  }, [session?.user]);

  useEffect(() => {
    setSelectedProjectId(initialProjectId || "");
  }, [initialProjectId]);

  useEffect(() => {
    let cancelled = false;
    const loadProjects = async () => {
      try {
        const [projectData, contactData] = await Promise.all([
          requestJson<{ projects: ProjectListItem[] }>(
            "/api/projects?includeFiled=1&includeArchived=1",
          ),
          requestJson<{ contacts: CrmContactLite[] }>("/api/crm/contacts"),
        ]);
        if (!cancelled) {
          setProjects(projectData.projects || []);
          setCrmContacts(contactData.contacts || []);
          if (!selectedProjectId && initialProjectId) {
            setSelectedProjectId(initialProjectId);
          }
        }
      } catch {
        if (!cancelled) {
          setProjects([]);
        }
      }
    };
    void loadProjects();
    return () => {
      cancelled = true;
    };
  }, [initialProjectId, selectedProjectId]);

  useEffect(() => {
    if (!lineScopeId) {
      return;
    }
    let cancelled = false;
    const loadLineOa = async () => {
      try {
        const data = await requestJson<LineSettingsLite>(
          `/api/crm/settings/line?userId=${encodeURIComponent(lineScopeId)}`,
        );
        if (!cancelled) {
          setLineOaSettings(data);
        }
      } catch {
        if (!cancelled) {
          setLineOaSettings(null);
        }
      }
    };
    void loadLineOa();
    return () => {
      cancelled = true;
    };
  }, [lineScopeId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedProject(null);
      setItems([]);
      setHasGenerated(false);
      return;
    }
    let cancelled = false;
    const loadProjectDraft = async () => {
      setLoadingProjectDraft(true);
      setError(null);
      try {
        const data = await requestJson<{ project: ProjectDetailItem }>(`/api/projects/${selectedProjectId}`);
        if (cancelled) {
          return;
        }
        setSelectedProject(data.project);
        const incomingItems = (data.project.quotationItems || []).map((item, idx) => ({
          id: Number(item.id.replace(/\D+/g, "")) || idx + 1,
          category: "室內設計服務",
          name: item.name,
          unit: item.unit || "式",
          quantity: item.quantity,
          price: item.unitPrice,
          source: "manual" as const,
          confidence: 100,
        }));
        setItems(incomingItems);
        setHasGenerated(incomingItems.length > 0);
        setQuoteNo(data.project.quotationMeta?.quoteNo || "");
        setValidUntil(data.project.quotationMeta?.validUntil || "");
        setDraftStatus(data.project.quotationMeta?.status || "draft");
        setDraftNote(data.project.quotationMeta?.note || "");
        setNotice(null);
      } catch (err) {
        if (!cancelled) {
          setSelectedProject(null);
          setItems([]);
          setHasGenerated(false);
          setError(err instanceof Error ? err.message : "讀取專案報價草稿失敗");
        }
      } finally {
        if (!cancelled) {
          setLoadingProjectDraft(false);
        }
      }
    };
    void loadProjectDraft();
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  const quotePayloadItems = useMemo(
    () =>
      items.map((item) => ({
        id: String(item.id),
        name: item.name,
        description: `${item.category}${item.source ? `（${item.source}）` : ""}`,
        unit: item.unit || "式",
        quantity: item.quantity,
        unitPrice: item.price,
      })),
    [items],
  );

  const calculateTotal = () => {
    return items.reduce((acc, item) => acc + (item.quantity * item.price), 0);
  };

  const handleAIGenerate = () => {
    if (!selectedProjectId || !selectedProject) {
      setError("請先選擇專案，系統才會讀取專案資料後生成報價單。");
      return;
    }
    setError(null);
    setNotice(null);
    setIsAnalyzing(true);
    setItems([]); // Clear current

    // Simulate AI processing and build quotation from selected project context.
    setTimeout(() => {
        const generatedItems = buildQuoteItemsFromProject(selectedProject);
        setItems(generatedItems);
        setIsAnalyzing(false);
        setHasGenerated(true);
        if (!quoteNo) {
          const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, "");
          const projectTag = selectedProject.id.slice(-4).toUpperCase();
          setQuoteNo(`Q-${dateTag}-${projectTag}`);
        }
        setNotice("已根據所選專案資料完成報價生成。");
    }, 2500);
  };

  const handleSaveDraftToProject = async () => {
    if (!selectedProjectId) {
      setError("請先選擇要回存的專案。");
      return;
    }
    setSavingDraft(true);
    setError(null);
    setNotice(null);
    try {
      await requestJson<{ project: ProjectDetailItem }>(`/api/projects/${selectedProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotationItems: quotePayloadItems,
          quotationMeta: {
            quoteNo,
            validUntil,
            status: draftStatus,
            note: draftNote,
            updatedAt: new Date().toISOString(),
          },
        }),
      });
      setNotice("報價草稿已成功回存到專案。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存草稿失敗");
    } finally {
      setSavingDraft(false);
    }
  };

  const addManualItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: prev.length + 1,
        category: "手動項目",
        name: "新增服務",
        unit: "式",
        quantity: 1,
        price: 0,
        source: "manual",
        confidence: 100,
      },
    ]);
    setHasGenerated(true);
  };

  const removeItem = (id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const updateItem = (id: number, patch: Partial<QuoteItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const handlePrint = () => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  const handleExportQuoteFile = () => {
    if (!selectedProject) {
      setError("請先選擇專案再匯出報價檔案。");
      return;
    }
    if (items.length === 0) {
      setError("請先生成報價內容再匯出。");
      return;
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      projectId: selectedProject.id,
      projectName: selectedProject.name,
      clientName: selectedProject.clientName,
      quoteNo: quoteNo || `Q-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${selectedProject.id.slice(-4).toUpperCase()}`,
      validUntil,
      status: draftStatus,
      note: draftNote,
      subtotal: calculateTotal(),
      tax: Math.round(calculateTotal() * 0.05),
      total: Math.round(calculateTotal() * 1.05),
      items,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${payload.quoteNo}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("已匯出報價單檔案（JSON）。");
  };

  const content = (
    <div className={onBack ? "flex flex-col lg:flex-row gap-6" : "h-[calc(100vh-8rem)] flex flex-col lg:flex-row gap-6"}>

      {/* Left Sidebar: AI Context & Source Data */}
      <div className="w-full lg:w-96 flex flex-col gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex-shrink-0">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Bot className="w-5 h-5 text-brand-600" /> AI 報價助理
            </h3>
            <div className="mb-4 space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">回存專案</label>
                <select
                    value={selectedProjectId}
                    onChange={(event) => setSelectedProjectId(event.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                >
                    <option value="">請選擇專案</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}（{project.clientName}）
                      </option>
                    ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                    <input
                        value={quoteNo}
                        onChange={(event) => setQuoteNo(event.target.value)}
                        placeholder="報價單號"
                        className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
                    />
                    <input
                        type="date"
                        value={validUntil}
                        onChange={(event) => setValidUntil(event.target.value)}
                        className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
                    />
                    <select
                        value={draftStatus}
                        onChange={(event) => setDraftStatus(event.target.value as "draft" | "sent" | "accepted")}
                        className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs bg-white"
                    >
                        <option value="draft">草稿</option>
                        <option value="sent">已送出</option>
                        <option value="accepted">已接受</option>
                    </select>
                    <input
                        value={draftNote}
                        onChange={(event) => setDraftNote(event.target.value)}
                        placeholder="草稿註記"
                        className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
                    />
                </div>
                {loadingProjectDraft && <p className="text-xs text-gray-500">讀取專案草稿中...</p>}
            </div>
            
            <div className="bg-brand-50 rounded-lg p-4 border border-brand-100 mb-4">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white font-bold text-xs">
                      {selectedProject?.clientName?.trim().charAt(0) || "專"}
                    </div>
                    <div>
                        <p className="text-sm font-bold text-gray-900">
                          {projectContext?.name || "尚未選擇專案"}
                        </p>
                        <p className="text-xs text-gray-500 flex items-center gap-1">
                             來源: {projectContext?.source || "--"}{" "}
                             {selectedProject ? <CheckCircle2 className="w-3 h-3 text-green-600" /> : null}
                        </p>
                    </div>
                </div>
            </div>

            {/* Analyzed Files */}
            <div className="mb-6">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Paperclip className="w-3 h-3" /> 已讀取檔案
                </h4>
                <div className="space-y-2">
                    {(projectContext?.attachments || []).map((file, idx) => (
                        <div key={idx} className="flex items-center gap-3 p-2 bg-gray-50 rounded border border-gray-200 text-sm">
                            {file.type === 'image' ? <FileImage className="w-4 h-4 text-purple-500" /> : <FileText className="w-4 h-4 text-blue-500" />}
                            <div className="flex-1 overflow-hidden">
                                <p className="truncate font-medium text-gray-700">{file.name}</p>
                                <p className="text-xs text-gray-400">{file.sizeLabel}</p>
                            </div>
                            <div className={`w-2 h-2 rounded-full ${selectedProject ? "bg-green-500" : "bg-gray-300"}`}></div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Chat Summary */}
            <div className="flex-1 flex flex-col">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <MessageSquare className="w-3 h-3" /> 專案需求摘要
                </h4>
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 text-sm text-gray-700 leading-relaxed flex-1 overflow-y-auto max-h-64">
                    <div className="whitespace-pre-line">
                      {projectContext?.summaryLines || "請先選擇專案，系統會自動讀取專案資料作為報價依據。"}
                    </div>
                </div>
            </div>

            {(notice || error) && (
              <div className="mt-3 space-y-2">
                {notice && <div className="rounded border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700">{notice}</div>}
                {error && <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">{error}</div>}
              </div>
            )}

            <Button 
                fullWidth 
                className="mt-6 gap-2 bg-gradient-to-r from-brand-600 to-purple-600 border-none shadow-lg hover:shadow-xl transition-all"
                onClick={handleAIGenerate}
                disabled={isAnalyzing || !selectedProjectId || loadingProjectDraft}
            >
                {isAnalyzing ? (
                    <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        分析專案資料中...
                    </>
                ) : (
                    <>
                        <Sparkles className="w-4 h-4" />
                        {hasGenerated ? '重新生成報價' : '生成專案報價單'}
                    </>
                )}
            </Button>
        </div>
      </div>

      {/* Right Panel: Quotation Table */}
      <div className="flex-1 flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Quote Header */}
        <div className="p-6 border-b border-gray-200 bg-gray-50/50 flex justify-between items-center">
            <div>
                <h2 className="text-xl font-bold text-gray-900">報價單預覽</h2>
                <p className="text-sm text-gray-500 mt-1">
                  單號：{quoteNo || "--"} • 有效期：{validUntil || "--"}
                </p>
            </div>
            <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={handlePrint}>
                  <Printer className="w-4 h-4"/> 列印
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={handleExportQuoteFile}>
                  <Download className="w-4 h-4"/> 匯出報價檔
                </Button>
            </div>
        </div>

        {/* Items Table */}
        <div className="flex-1 overflow-y-auto">
            {!hasGenerated && !isAnalyzing ? (
                 <div className="h-full flex flex-col items-center justify-center text-gray-400">
                     <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                         <Calculator className="w-10 h-10 text-gray-300" />
                     </div>
                     <p className="text-lg font-medium text-gray-600">等待生成</p>
                     <p className="text-sm">請先選擇專案，再點擊左側按鈕生成報價檔案。</p>
                 </div>
            ) : isAnalyzing ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-4">
                    <div className="relative w-24 h-24">
                         <div className="absolute inset-0 border-4 border-gray-200 rounded-full"></div>
                         <div className="absolute inset-0 border-4 border-brand-500 rounded-full border-t-transparent animate-spin"></div>
                         <Bot className="absolute inset-0 m-auto w-8 h-8 text-brand-600 animate-pulse" />
                    </div>
                    <div className="text-center">
                        <p className="font-bold text-gray-900">AI 正在計算服務項目...</p>
                        <p className="text-sm text-gray-500 mt-2">正在比對歷史裝修報價資料庫 (1/3)</p>
                    </div>
                </div>
            ) : (
                <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50 text-gray-700 border-b border-gray-200 sticky top-0 z-10">
                        <tr>
                            <th className="px-6 py-3 font-semibold w-24">類別</th>
                            <th className="px-6 py-3 font-semibold">項目名稱</th>
                            <th className="px-6 py-3 font-semibold w-16">單位</th>
                            <th className="px-6 py-3 font-semibold w-16">數量</th>
                            <th className="px-6 py-3 font-semibold w-24">單價</th>
                            <th className="px-6 py-3 font-semibold w-24">複價</th>
                            <th className="px-6 py-3 font-semibold w-10"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {items.map((item) => (
                            <tr key={item.id} className="hover:bg-gray-50/50 group">
                                <td className="px-6 py-4 text-gray-500 font-medium">{item.category}</td>
                                <td className="px-6 py-4 text-gray-900">
                                    <div className="flex items-center gap-2">
                                        {item.name}
                                        {/* Source Indicator */}
                                        {item.source === 'chat' && (
                                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-purple-50 text-purple-600 border border-purple-100" title="AI 依據對話紀錄生成">
                                                <MessageSquare className="w-3 h-3" /> 對話
                                            </span>
                                        )}
                                        {item.source === 'file' && (
                                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-600 border border-blue-100" title="AI 依據附件檔案生成">
                                                <FileText className="w-3 h-3" /> 附件
                                            </span>
                                        )}
                                    </div>
                                    {/* Confidence Bar (Optional visual) */}
                                    <div className="w-full bg-gray-100 h-1 rounded-full mt-2 overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity">
                                        <div className={`h-full ${item.confidence! > 90 ? 'bg-green-500' : 'bg-yellow-500'}`} style={{ width: `${item.confidence}%` }}></div>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <select
                                      value={item.unit || "式"}
                                      onChange={(e) => updateItem(item.id, { unit: e.target.value })}
                                      className="text-sm border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
                                    >
                                      {COMMON_UNITS.map((u) => (
                                        <option key={u} value={u}>{u}</option>
                                      ))}
                                      {item.unit && !COMMON_UNITS.includes(item.unit as typeof COMMON_UNITS[number]) && (
                                        <option value={item.unit}>{item.unit}</option>
                                      )}
                                    </select>
                                </td>
                                <td className="px-6 py-4">
                                    <input
                                      type="number"
                                      value={item.quantity}
                                      onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) || 0 })}
                                      className="w-16 text-sm border border-gray-200 rounded px-2 py-1 text-gray-900 focus:outline-none focus:ring-1 focus:ring-brand-500"
                                    />
                                </td>
                                <td className="px-6 py-4">
                                    <input
                                      type="number"
                                      value={item.price}
                                      onChange={(e) => updateItem(item.id, { price: Number(e.target.value) || 0 })}
                                      className="w-24 text-sm border border-gray-200 rounded px-2 py-1 text-gray-900 focus:outline-none focus:ring-1 focus:ring-brand-500"
                                    />
                                </td>
                                <td className="px-6 py-4 font-bold text-gray-900">${(item.quantity * item.price).toLocaleString()}</td>
                                <td className="px-6 py-4">
                                    <button
                                      className="text-gray-300 hover:text-red-500 transition-colors"
                                      onClick={() => removeItem(item.id)}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        <tr>
                            <td colSpan={7} className="px-6 py-4">
                                <button
                                  className="flex items-center gap-1 text-brand-600 hover:text-brand-700 font-medium text-sm transition-colors"
                                  onClick={addManualItem}
                                >
                                    <Plus className="w-4 h-4" /> 手動新增項目
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            )}
        </div>

        {/* Footer Total */}
        <div className="p-6 bg-gray-50 border-t border-gray-200">
            <div className="flex flex-col sm:flex-row justify-end items-end gap-8">
                <div className="w-64 space-y-2">
                    <div className="flex justify-between text-gray-600 text-sm">
                        <span>小計 Subtotal</span>
                        <span>${calculateTotal().toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-gray-600 text-sm">
                        <span>稅金 Tax (5%)</span>
                        <span>${(calculateTotal() * 0.05).toLocaleString()}</span>
                    </div>
                    <div className="border-t border-gray-300 my-2 pt-2 flex justify-between text-2xl font-bold text-brand-600">
                        <span>總計 Total</span>
                        <span>${(calculateTotal() * 1.05).toLocaleString()}</span>
                    </div>
                </div>
                <div>
                     <Button
                       className="w-full sm:w-auto"
                       onClick={() => void handleSaveDraftToProject()}
                       disabled={savingDraft || !selectedProjectId}
                     >
                       {savingDraft ? "儲存中..." : "儲存草稿回專案"}
                     </Button>
                </div>
            </div>
        </div>
      </div>
    </div>
  );

  // 子頁模式：全螢幕 + 返回列（從專案進入時）
  if (onBack) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 md:px-8 py-3 flex items-center gap-3 shadow-sm">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-brand-700 font-medium"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            返回專案管理
          </button>
          <span className="text-gray-300">|</span>
          <h1 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <Calculator className="w-4 h-4 text-brand-600" /> AI 裝修報價
          </h1>
        </div>
        <div className="p-4 md:p-8">{content}</div>
      </div>
    );
  }

  return content;
};