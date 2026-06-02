import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./Button";
import {
  Project,
  ProjectAuspiciousPlan,
  ProjectDressSelectionRecord,
  ProjectNotificationTemplate,
  ProjectQuotationItem,
  ProjectQuotationMeta,
  ProjectWorkflowTask,
} from "../types";
import { COMMON_UNITS } from "@/lib/crm/pricing-standards";
import { GanttChart } from "./project/GanttChart";
import { CalendarView } from "./project/CalendarView";
import { exportElementToPng, exportElementToPdf } from "@/lib/project/export-element";
import {
  ArrowLeft,
  MessageSquare,
  PenTool,
  Save,
  RefreshCw,
  Link2,
  Upload,
  Trash2,
  Archive,
  ArchiveRestore,
  Plus,
  Wand2,
  FolderArchive,
  Presentation,
  Download,
  Pencil,
  Eye,
  Calculator,
  ChevronDown,
} from "lucide-react";

interface ProjectDetailProps {
  project: Project;
  onBack: () => void;
  onGoToAI: () => void;
  onGoToQuotation?: () => void;
  onGoToPresentation?: (projectId: string) => void;
  onProjectUpdated?: (project: Project) => void;
}

interface CrmContactLite {
  id: string;
  displayName: string;
  source: "line" | "manual";
  lineUserId?: string;
  tags?: string[];
  email?: string;
  phone?: string;
  avatarUrl?: string | null;
  status?: "new" | "contacted" | "proposal" | "signed";
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

interface UploadAttachment {
  url?: string;
  dataUrl?: string;
}

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "草稿",
  active: "進行中",
  quoted: "已報價",
  completed: "已結案",
};

const DEFAULT_QUOTATION_ITEMS: ProjectQuotationItem[] = [
  { id: `quote_seed_1`, name: "室內設計規劃服務費", quantity: 1, unitPrice: 68000 },
  { id: `quote_seed_2`, name: "施工現場協調執行", quantity: 1, unitPrice: 18000 },
];

const DEFAULT_NOTIFICATION_TEMPLATES: ProjectNotificationTemplate[] = [
  {
    id: "default_timeline",
    name: "流程提醒",
    content: "提醒您：{projectName} 的「{taskTitle}」將在 {taskDateTime} 開始，負責人：{taskOwner}。",
  },
  {
    id: "default_preparation",
    name: "行前準備提醒",
    content: "您好，{projectName} 即將進行「{taskTitle}」（{taskDateTime}），請提前確認準備項目。",
  },
  {
    id: "default_followup",
    name: "追蹤確認提醒",
    content: "溫馨提醒：{projectName} 的「{taskTitle}」將於 {taskDateTime} 執行，若需異動請立即回覆。",
  },
];

const WORKFLOW_TEMPLATES: Array<{ id: string; label: string; tasks: Omit<ProjectWorkflowTask, "id">[] }> = [
  {
    id: "classic-lunch",
    label: "住宅標準流程模板",
    tasks: [
      { time: "07:30", title: "現況丈量與需求確認", detail: "丈量尺寸與需求盤點", owner: "專案經理", done: false, isCustom: false },
      { time: "10:00", title: "平面配置與動線初稿", detail: "提出動線、收納與機能分區方案", owner: "設計師", done: false, isCustom: false },
      { time: "12:00", title: "材質與燈光提案會議", detail: "確認材質樣板、色系與預算分配", owner: "工務監工", done: false, isCustom: false },
    ],
  },
  {
    id: "classic-dinner",
    label: "商空標準流程模板",
    tasks: [
      { time: "09:00", title: "現況丈量與需求確認", detail: "晨間丈量尺寸與需求盤點", owner: "專案經理", done: false, isCustom: false },
      { time: "14:30", title: "3D 渲染與提案簡報", detail: "輸出多角度渲染圖與報價版本", owner: "3D 視覺師", done: false, isCustom: false },
      { time: "18:30", title: "材質與燈光提案會議", detail: "確認樣板、預算與施工節點", owner: "工務監工", done: false, isCustom: false },
    ],
  },
];

const createFlowTask = (task?: Partial<ProjectWorkflowTask>): ProjectWorkflowTask => ({
  id: `task_${crypto.randomUUID()}`,
  date: task?.date || "",
  durationDays: Number.isFinite(task?.durationDays) ? Math.max(1, Number(task?.durationDays)) : 1,
  stage: task?.stage || "",
  time: task?.time || "",
  title: task?.title || "新流程項目",
  detail: task?.detail || "",
  owner: task?.owner || "",
  done: Boolean(task?.done),
  isCustom: task?.isCustom ?? true,
  reminderMinutesBefore: Number.isFinite(task?.reminderMinutesBefore)
    ? Math.max(0, Number(task?.reminderMinutesBefore))
    : 60,
  templateId: task?.templateId || "default_timeline",
  lastReminderSentAt: task?.lastReminderSentAt,
  lastReminderFor: task?.lastReminderFor,
});

const createDressSelectionRecord = (
  partial?: Partial<ProjectDressSelectionRecord>,
): ProjectDressSelectionRecord => {
  const now = new Date().toISOString();
  return {
    id: partial?.id || `dress_${crypto.randomUUID()}`,
    dressName: partial?.dressName || "新渲染紀錄",
    dressSpec: partial?.dressSpec || "",
    sourceLabel: partial?.sourceLabel || "自訂",
    referenceAssetId: partial?.referenceAssetId || "",
    referenceImageUrl: partial?.referenceImageUrl || "",
    generatedImageUrl: partial?.generatedImageUrl || "",
    summary: partial?.summary || "",
    model: partial?.model || "",
    note: partial?.note || "",
    createdAt: partial?.createdAt || now,
    updatedAt: partial?.updatedAt || now,
  };
};

const normalizeDraftProject = (value: Project): Project => ({
  ...value,
  quotationItems:
    value.quotationItems && value.quotationItems.length > 0
      ? value.quotationItems
      : DEFAULT_QUOTATION_ITEMS.map((item) => ({ ...item, id: `quote_${crypto.randomUUID()}` })),
  workflowTasks:
    value.workflowTasks && value.workflowTasks.length > 0
      ? value.workflowTasks.map((task) => createFlowTask(task))
      : WORKFLOW_TEMPLATES[0].tasks.map((task) => createFlowTask({ ...task, date: value.date || "" })),
  auspiciousPlan: {
    ceremonyDate: value.auspiciousPlan?.ceremonyDate || "",
    preferredWindow: value.auspiciousPlan?.preferredWindow || "afternoon",
    recommendedStartTime: value.auspiciousPlan?.recommendedStartTime || "",
    recommendations: value.auspiciousPlan?.recommendations || [],
    generatedAt: value.auspiciousPlan?.generatedAt,
  },
  dressSelectionRecords: Array.isArray(value.dressSelectionRecords)
    ? value.dressSelectionRecords.map((item) => createDressSelectionRecord(item))
    : [],
  quotationMeta: {
    quoteNo: value.quotationMeta?.quoteNo || "",
    validUntil: value.quotationMeta?.validUntil || "",
    status: value.quotationMeta?.status || "draft",
    note: value.quotationMeta?.note || "",
    updatedAt: value.quotationMeta?.updatedAt || "",
  },
  notificationEmail: value.notificationEmail || "",
  notificationTemplates:
    value.notificationTemplates && value.notificationTemplates.length > 0
      ? value.notificationTemplates
      : DEFAULT_NOTIFICATION_TEMPLATES,
});

const buildAuspiciousPlan = (
  draft: Project,
  preferredWindow: ProjectAuspiciousPlan["preferredWindow"],
): ProjectAuspiciousPlan => {
  const startTimeMap: Record<NonNullable<ProjectAuspiciousPlan["preferredWindow"]>, string> = {
    morning: "09:18",
    afternoon: "13:18",
    evening: "18:18",
  };
  const startTime = startTimeMap[preferredWindow || "afternoon"];
  return {
    ceremonyDate: draft.auspiciousPlan?.ceremonyDate || draft.date || "",
    preferredWindow: preferredWindow || "afternoon",
    recommendedStartTime: startTime,
    recommendations: [
      `建議關鍵施工節點安排在 ${startTime} 左右啟動，預留 20 分鐘彈性緩衝。`,
      "施工前一天完成材料、設備與保護工程確認，避免臨時延誤。",
      "若涉及社區施工申請或大樓搬運時段，請提前完成管理規約與動線申請。",
    ],
    generatedAt: new Date().toISOString(),
  };
};

const toProject = (item: ProjectApiItem): Project => ({
  id: item.id,
  name: item.name,
  client: item.clientName,
  status: item.status,
  phase: item.phase,
  budget: item.budget,
  date: item.updatedAt.slice(0, 10),
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

const isProjectNotFoundError = (message: string): boolean => /project not found/i.test(message);

export const ProjectDetail: React.FC<ProjectDetailProps> = ({
  project,
  onBack,
  onGoToAI,
  onGoToQuotation,
  onGoToPresentation,
  onProjectUpdated,
}) => {
  const [draft, setDraft] = useState<Project>(normalizeDraftProject(project));
  const [contacts, setContacts] = useState<CrmContactLite[]>([]);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(normalizeDraftProject(project));
    setError(null);
    setNotice(null);
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [projectResult, contactResult] = await Promise.allSettled([
          requestJson<{ project: ProjectApiItem }>(`/api/projects/${project.id}`),
          requestJson<{ contacts: CrmContactLite[] }>("/api/crm/contacts"),
        ]);
        if (cancelled) {
          return;
        }
        if (contactResult.status === "fulfilled") {
          setContacts(contactResult.value.contacts);
        } else {
          setContacts([]);
        }

        if (projectResult.status === "fulfilled") {
          const normalized = toProject(projectResult.value.project);
          setDraft(normalizeDraftProject(normalized));
          onProjectUpdated?.(normalized);
          setError(null);
          return;
        }

        const message =
          projectResult.reason instanceof Error
            ? projectResult.reason.message
            : "讀取專案資料失敗";
        if (isProjectNotFoundError(message)) {
          setNotice("此專案在伺服器上暫時不存在，已保留目前內容，可直接按「儲存專案」重新建立。");
          setError(null);
        } else {
          setError(message);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "讀取專案資料失敗");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const linkedContact = useMemo(
    () => contacts.find((item) => item.id === draft.linkedContactId) || null,
    [contacts, draft.linkedContactId],
  );
  const linkedContactName = linkedContact?.displayName || "未綁定";
  const isArchived = Boolean(draft.archivedAt);
  const isFiled = Boolean(draft.filedAt);
  const isDeleted = Boolean(draft.deletedAt);
  const [workflowEditing, setWorkflowEditing] = useState(false);
  const [workflowFullscreen, setWorkflowFullscreen] = useState(false);
  const [workflowViewMode, setWorkflowViewMode] = useState<"gantt" | "calendar">("gantt");
  const [exportingGantt, setExportingGantt] = useState(false);
  const ganttRef = useRef<HTMLDivElement>(null);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);

  const exportGantt = async (format: "png" | "pdf") => {
    if (!ganttRef.current) return;
    setExportingGantt(true);
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 200));
      const fileName = `${draft.name || "工程進度"}_甘特圖`;
      if (format === "png") await exportElementToPng(ganttRef.current, fileName);
      else await exportElementToPdf(ganttRef.current, fileName);
    } catch {
      setNotice("甘特圖匯出失敗，請重試");
    } finally {
      setExportingGantt(false);
    }
  };

  const quotationTotal = useMemo(
    () =>
      (draft.quotationItems || []).reduce(
        (sum, item) => sum + Math.max(0, item.quantity || 0) * Math.max(0, item.unitPrice || 0),
        0,
      ),
    [draft.quotationItems],
  );

  const sortedWorkflowTasks = useMemo(
    () =>
      [...(draft.workflowTasks || [])].sort((a, b) => {
        const aDate = a.date || draft.auspiciousPlan?.ceremonyDate || draft.date || "";
        const bDate = b.date || draft.auspiciousPlan?.ceremonyDate || draft.date || "";
        const byDate = aDate.localeCompare(bDate);
        if (byDate !== 0) {
          return byDate;
        }
        return (a.time || "").localeCompare(b.time || "");
      }),
    [draft.auspiciousPlan?.ceremonyDate, draft.date, draft.workflowTasks],
  );

  const timelineBounds = useMemo(() => {
    const hours = sortedWorkflowTasks
      .map((task) => Number(task.time?.split(":")[0] || "0"))
      .filter((hour) => Number.isFinite(hour));
    if (hours.length === 0) {
      return { start: 8, end: 20 };
    }
    const minHour = Math.max(0, Math.min(...hours) - 1);
    const maxHour = Math.min(23, Math.max(...hours) + 1);
    return { start: minHour, end: maxHour };
  }, [sortedWorkflowTasks]);

  const workflowByDate = useMemo(() => {
    const grouped = new Map<string, ProjectWorkflowTask[]>();
    const fallbackDate = draft.auspiciousPlan?.ceremonyDate || draft.date || "未指定日期";
    for (const task of sortedWorkflowTasks) {
      const key = task.date || fallbackDate;
      const bucket = grouped.get(key) || [];
      bucket.push(task);
      grouped.set(key, bucket);
    }
    return Array.from(grouped.entries());
  }, [draft.auspiciousPlan?.ceremonyDate, draft.date, sortedWorkflowTasks]);

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
      setDraft((prev) => ({ ...prev, img: source }));
      setNotice("封面已更新，記得儲存專案。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "封面上傳失敗");
    } finally {
      setUploadingCover(false);
    }
  };

  const handleQuotationChange = (
    itemId: string,
    field: keyof Pick<ProjectQuotationItem, "name" | "description" | "unit" | "quantity" | "unitPrice">,
    value: string,
  ) => {
    setDraft((prev) => ({
      ...prev,
      quotationItems: (prev.quotationItems || []).map((item) =>
        item.id === itemId
          ? {
              ...item,
              [field]:
                field === "quantity" || field === "unitPrice"
                  ? Math.max(0, Number(value) || 0)
                  : value,
            }
          : item,
      ),
    }));
  };

  const addQuotationItem = () => {
    setDraft((prev) => ({
      ...prev,
      quotationItems: [
        ...(prev.quotationItems || []),
        { id: `quote_${crypto.randomUUID()}`, name: "新增項目", description: "", unit: "式", quantity: 1, unitPrice: 0 },
      ],
    }));
  };

  const removeQuotationItem = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      quotationItems: (prev.quotationItems || []).filter((item) => item.id !== id),
    }));
  };

  const addDressSelectionRecord = () => {
    setDraft((prev) => ({
      ...prev,
      dressSelectionRecords: [
        ...(prev.dressSelectionRecords || []),
        createDressSelectionRecord(),
      ],
    }));
  };

  const updateDressSelectionRecord = (
    recordId: string,
    field: keyof ProjectDressSelectionRecord,
    value: string,
  ) => {
    setDraft((prev) => ({
      ...prev,
      dressSelectionRecords: (prev.dressSelectionRecords || []).map((item) =>
        item.id === recordId
          ? {
              ...item,
              [field]: value,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    }));
  };

  const removeDressSelectionRecord = (recordId: string) => {
    setDraft((prev) => ({
      ...prev,
      dressSelectionRecords: (prev.dressSelectionRecords || []).filter((item) => item.id !== recordId),
    }));
  };

  const addWorkflowTask = () => {
    const fallbackDate = draft.auspiciousPlan?.ceremonyDate || draft.date || "";
    setDraft((prev) => ({
      ...prev,
      workflowTasks: [...(prev.workflowTasks || []), createFlowTask({ date: fallbackDate })],
    }));
  };

  const [generatingGantt, setGeneratingGantt] = useState(false);

  /**
   * AI 依報價項目 + 整體施作需求，自動排出一份以「天」為單位的施工排程（甘特圖）。
   * 每個報價工項對應一個施工階段，並補上整體必要工項（保護、放樣、清潔、驗收等）。
   */
  const generateGanttSchedule = async () => {
    setGeneratingGantt(true);
    setNotice(null);
    try {
      const items = (draft.quotationItems || []).map((i) => `${i.name}（${i.quantity}${i.unit || "式"}）`).join("、") || "（報價單尚無項目）";
      const startDate =
        draft.workflowTasks?.find((t) => t.date)?.date ||
        new Date().toISOString().slice(0, 10);

      const prompt =
        `你是資深室內裝修工程的工務經理。請根據以下「報價項目」排出一份完整的施工排程（甘特圖），以天為單位。\n\n` +
        `專案：${draft.name}（${draft.budget || "預算未定"}）\n` +
        `報價項目：${items}\n` +
        `預計開工日：${startDate}\n\n` +
        `排程原則：\n` +
        `1. 依正確的裝修施工順序排列（保護→拆除→水電配管→泥作/防水→木作→油漆→系統櫃/設備安裝→地板→廚衛設備→清潔→驗收）\n` +
        `2. 每個報價項目都要有對應的施工工項；同時補上「整體施作」必要工項（如全室保護、放樣定位、垃圾清運、完工清潔、驗收交屋），即使報價單沒列\n` +
        `3. 合理估算每個工項的工期天數（durationDays），可重疊的工項給接近的開始日\n` +
        `4. 用 date 給每個工項的開始日期（從開工日往後排，YYYY-MM-DD）\n` +
        `5. stage 填階段分類（保護/拆除/水電/泥作/防水/木作/油漆/系統櫃/地板/廚衛/空調/清潔/收尾 其中之一）\n\n` +
        `只輸出 JSON 陣列，不要其他文字。格式：\n` +
        `[{"title":"工項名稱","stage":"階段","date":"YYYY-MM-DD","durationDays":數字,"detail":"簡短說明","owner":"工班/負責人"}]`;

      const res = await fetch("/api/ai/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, temperature: 0.4, jsonMode: true }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "生成失敗");
      const text = (data.text || "").trim();
      const m = text.match(/\[[\s\S]*\]/);
      const parsed: Array<Record<string, unknown>> = m ? JSON.parse(m[0]) : [];
      if (parsed.length === 0) throw new Error("AI 未產生工項");

      const tasks = parsed.map((p) =>
        createFlowTask({
          title: String(p.title || "工項").trim(),
          stage: String(p.stage || "").trim(),
          date: String(p.date || startDate).trim(),
          durationDays: Math.max(1, Number(p.durationDays) || 1),
          detail: String(p.detail || "").trim(),
          owner: String(p.owner || "").trim(),
          isCustom: false,
        }),
      );
      setDraft((prev) => ({ ...prev, workflowTasks: tasks }));
      setWorkflowEditing(false);
      setNotice(`已依報價項目生成 ${tasks.length} 個施工工項的甘特圖，記得儲存專案。`);
    } catch (err) {
      setNotice(err instanceof Error ? `甘特圖生成失敗：${err.message}` : "甘特圖生成失敗");
    } finally {
      setGeneratingGantt(false);
    }
  };

  const updateWorkflowTask = (
    taskId: string,
    field: keyof ProjectWorkflowTask,
    value: string | boolean | number,
  ) => {
    setDraft((prev) => ({
      ...prev,
      workflowTasks: (prev.workflowTasks || []).map((task) =>
        task.id === taskId ? { ...task, [field]: value } : task,
      ),
    }));
  };

  const addNotificationTemplate = () => {
    setDraft((prev) => ({
      ...prev,
      notificationTemplates: [
        ...(prev.notificationTemplates || []),
        {
          id: `custom_template_${crypto.randomUUID()}`,
          name: "自訂提醒模板",
          content: "提醒：{projectName} 的 {taskTitle} 將在 {taskDateTime} 開始。",
        },
      ],
    }));
  };

  const updateNotificationTemplate = (
    templateId: string,
    field: keyof ProjectNotificationTemplate,
    value: string,
  ) => {
    setDraft((prev) => ({
      ...prev,
      notificationTemplates: (prev.notificationTemplates || []).map((template) =>
        template.id === templateId ? { ...template, [field]: value } : template,
      ),
    }));
  };

  const removeNotificationTemplate = (templateId: string) => {
    setDraft((prev) => ({
      ...prev,
      notificationTemplates: (prev.notificationTemplates || []).filter((template) => template.id !== templateId),
      workflowTasks: (prev.workflowTasks || []).map((task) =>
        task.templateId === templateId ? { ...task, templateId: "default_timeline" } : task,
      ),
    }));
  };

  const removeWorkflowTask = (taskId: string) => {
    setDraft((prev) => ({
      ...prev,
      workflowTasks: (prev.workflowTasks || []).filter((task) => task.id !== taskId),
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: draft.name,
        clientName: draft.client,
        status: draft.status,
        phase: draft.phase,
        budget: draft.budget,
        coverImageUrl: draft.img,
        linkedContactId: draft.linkedContactId || null,
        note: draft.note || "",
        quotationItems: draft.quotationItems || [],
        dressSelectionRecords: draft.dressSelectionRecords || [],
        quotationMeta: draft.quotationMeta,
        workflowTasks: draft.workflowTasks || [],
        auspiciousPlan: draft.auspiciousPlan,
        notificationEmail: draft.notificationEmail || "",
        notificationTemplates: draft.notificationTemplates || [],
      };
      const data = await requestJson<{ project: ProjectApiItem }>(`/api/projects/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const next = toProject(data.project);
      setDraft(normalizeDraftProject(next));
      onProjectUpdated?.(next);
      if (draft.linkedContactId && !next.linkedContactId) {
        setNotice("專案資料已儲存；原綁定 CRM 客戶已不存在，已自動解除綁定。");
      } else {
        setNotice("專案資料已儲存");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "儲存專案失敗";
      if (isProjectNotFoundError(message)) {
        try {
          const recreated = await requestJson<{ project: ProjectApiItem }>("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: draft.name,
              clientName: draft.client,
              status: draft.status,
              phase: draft.phase,
              budget: draft.budget,
              coverImageUrl: draft.img,
              linkedContactId: draft.linkedContactId || undefined,
              note: draft.note || "",
              quotationItems: draft.quotationItems || [],
              dressSelectionRecords: draft.dressSelectionRecords || [],
              quotationMeta: draft.quotationMeta,
              workflowTasks: draft.workflowTasks || [],
              auspiciousPlan: draft.auspiciousPlan,
              notificationEmail: draft.notificationEmail || "",
              notificationTemplates: draft.notificationTemplates || [],
            }),
          });
          const next = toProject(recreated.project);
          setDraft(normalizeDraftProject(next));
          onProjectUpdated?.(next);
          setNotice("偵測到原專案遺失，已自動重建並完成儲存。");
          setError(null);
          return;
        } catch (recreateErr) {
          setError(recreateErr instanceof Error ? recreateErr.message : "專案重建失敗");
          return;
        }
      }
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleSyncNoteToCrm = async () => {
    setSyncing(true);
    setError(null);
    try {
      const data = await requestJson<{ project: ProjectApiItem }>(
        `/api/projects/${draft.id}/sync-crm-note`,
        {
          method: "POST",
        },
      );
      const next = toProject(data.project);
      setDraft(normalizeDraftProject(next));
      onProjectUpdated?.(next);
      setNotice("已將專案註記同步到 CRM（不會推播給 LINE 客戶）");
    } catch (err) {
      setError(err instanceof Error ? err.message : "同步 CRM 註記失敗");
    } finally {
      setSyncing(false);
    }
  };

  /** 由下拉選單切換專案狀態：作用中 / 已封存 / 已建檔 / 刪除區。 */
  const handleStatusChange = async (target: string) => {
    const current = isDeleted ? "deleted" : isFiled ? "filed" : isArchived ? "archived" : "active";
    if (target === current) return;
    setError(null);

    const callApi = async (path: string, method: "POST" | "DELETE") =>
      requestJson<{ project: ProjectApiItem }>(`/api/projects/${draft.id}${path}`, { method });

    try {
      if (target === "deleted") {
        const ok = window.confirm("確定要移到刪除區嗎？30 天內可還原，之後系統自動清除。");
        if (!ok) return;
        await requestJson<{ ok: boolean }>(`/api/projects/${draft.id}`, { method: "DELETE" });
        const data = await requestJson<{ project: ProjectApiItem }>(`/api/projects/${draft.id}`);
        const next = toProject(data.project);
        setDraft(normalizeDraftProject(next));
        onProjectUpdated?.(next);
        setNotice("專案已移到刪除區，30 天後自動清除。");
        return;
      }

      // From deleted → restore first
      if (current === "deleted") {
        await callApi(`/restore`, "POST");
      }
      // Clear states that aren't the target
      if (isArchived && target !== "archived") await callApi(`/archive`, "DELETE");
      if (isFiled && target !== "filed") await callApi(`/file`, "DELETE");

      // Apply target
      let next: ProjectApiItem | null = null;
      if (target === "archived" && !isArchived) next = (await callApi(`/archive`, "POST")).project;
      else if (target === "filed" && !isFiled) next = (await callApi(`/file`, "POST")).project;

      // Re-fetch to get the final consolidated state
      const data = await requestJson<{ project: ProjectApiItem }>(`/api/projects/${draft.id}`);
      const resolved = toProject((next && data.project) || data.project);
      setDraft(normalizeDraftProject(resolved));
      onProjectUpdated?.(resolved);
      const label = { active: "作用中", archived: "已封存", filed: "已建檔" }[target] || target;
      setNotice(`專案狀態已更新為「${label}」`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新專案狀態失敗");
    }
  };

  const handleArchiveToggle = async () => {
    if (isDeleted) {
      setError("刪除區中的專案請先還原再操作。");
      return;
    }
    setError(null);
    try {
      const data = await requestJson<{ project: ProjectApiItem }>(
        `/api/projects/${draft.id}/archive`,
        {
          method: isArchived ? "DELETE" : "POST",
        },
      );
      const next = toProject(data.project);
      setDraft(normalizeDraftProject(next));
      onProjectUpdated?.(next);
      setNotice(isArchived ? "專案已取消封存" : "專案已封存");
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新封存狀態失敗");
    }
  };

  const handleFileToggle = async () => {
    if (isDeleted) {
      setError("刪除區中的專案請先還原再操作。");
      return;
    }
    setError(null);
    try {
      const data = await requestJson<{ project: ProjectApiItem }>(
        `/api/projects/${draft.id}/file`,
        {
          method: isFiled ? "DELETE" : "POST",
        },
      );
      const next = toProject(data.project);
      setDraft(normalizeDraftProject(next));
      onProjectUpdated?.(next);
      setNotice(isFiled ? "專案已取消建檔" : "專案已歸納建檔");
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新建檔狀態失敗");
    }
  };

  const handleRestoreFromTrash = async () => {
    setError(null);
    try {
      const data = await requestJson<{ project: ProjectApiItem }>(
        `/api/projects/${draft.id}/restore`,
        {
          method: "POST",
        },
      );
      const next = toProject(data.project);
      setDraft(normalizeDraftProject(next));
      onProjectUpdated?.(next);
      setNotice("已從刪除區還原專案");
    } catch (err) {
      setError(err instanceof Error ? err.message : "還原專案失敗");
    }
  };

  const handleDeleteProject = async () => {
    if (isDeleted) {
      setNotice("此專案已在刪除區，可於 30 天內還原。");
      return;
    }
    const ok = window.confirm("確定要移到刪除區嗎？30 天內可還原，之後系統自動清除。");
    if (!ok) {
      return;
    }
    setError(null);
    try {
      await requestJson<{ ok: boolean }>(`/api/projects/${draft.id}`, {
        method: "DELETE",
      });
      setNotice("專案已移到刪除區，30 天後自動清除。");
      const data = await requestJson<{ project: ProjectApiItem }>(`/api/projects/${draft.id}`);
      const next = toProject(data.project);
      setDraft(normalizeDraftProject(next));
      onProjectUpdated?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除專案失敗");
    }
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-right duration-300">
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handleCoverFileSelected(event)}
      />
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-gray-900">{draft.name}</h2>
              {isDeleted && (
                <span className="px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-bold">
                  刪除區
                </span>
              )}
              {isFiled && (
                <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-bold">
                  已建檔
                </span>
              )}
              {isArchived && (
                <span className="px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-700 text-xs font-bold">
                  已封存
                </span>
              )}
              <span className="px-2.5 py-0.5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold">
                {STATUS_LABELS[draft.status]}
              </span>
            </div>
            <p className="text-gray-500 text-sm mt-1">
              客戶：{draft.client} • 綁定客戶：{linkedContactName}
            </p>
            {linkedContact?.tags && linkedContact.tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {linkedContact.tags.slice(0, 6).map((tag) => (
                  <span
                    key={`linked_contact_header_tag_${tag}`}
                    className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {isDeleted && draft.deletePurgeAt && (
              <p className="text-red-600 text-xs mt-1">
                將於 {new Date(draft.deletePurgeAt).toLocaleDateString("zh-TW")} 自動清除
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-3 w-full lg:w-auto">
          {/* 狀態下拉選單（取代封存/建檔/刪除三按鈕） */}
          <select
            value={isDeleted ? "deleted" : isFiled ? "filed" : isArchived ? "archived" : "active"}
            onChange={(event) => void handleStatusChange(event.target.value)}
            className="flex-1 lg:flex-none rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
            title="專案狀態"
          >
            <option value="active">作用中</option>
            <option value="archived">已封存</option>
            <option value="filed">已建檔</option>
            <option value="deleted">移到刪除區</option>
          </select>
          {/* 專案工具下拉選單（收納渲染/簡報/報價/工程安排，避免按鈕爆版） */}
          <div className="relative flex-1 lg:flex-none">
            <Button
              variant="outline"
              className="w-full lg:w-auto gap-2"
              onClick={() => setStatusMenuOpen((v) => !v)}
            >
              <Wand2 className="w-4 h-4" /> 專案工具
              <ChevronDown className={`w-4 h-4 transition-transform ${statusMenuOpen ? "rotate-180" : ""}`} />
            </Button>
            {statusMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setStatusMenuOpen(false)} />
                <div className="absolute right-0 mt-1 w-56 z-40 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
                  <button
                    onClick={() => { setStatusMenuOpen(false); onGoToAI(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <PenTool className="w-4 h-4 text-brand-600" /> 線稿轉渲染工坊
                  </button>
                  <button
                    onClick={() => { setStatusMenuOpen(false); onGoToPresentation?.(project.id); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Presentation className="w-4 h-4 text-brand-600" /> 生成提案簡報
                  </button>
                  <button
                    onClick={() => { setStatusMenuOpen(false); onGoToQuotation?.(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Calculator className="w-4 h-4 text-brand-600" /> 報價單系統
                  </button>
                  <button
                    onClick={() => { setStatusMenuOpen(false); setWorkflowFullscreen(true); setWorkflowEditing(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Wand2 className="w-4 h-4 text-brand-600" /> 工程安排 / 甘特圖
                  </button>
                </div>
              </>
            )}
          </div>
          <Button onClick={() => void handleSave()} disabled={saving || isDeleted} className="flex-1 lg:flex-none gap-2">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "儲存中..." : "儲存專案"}
          </Button>
        </div>
      </div>

      {(notice || error) && (
        <div className="space-y-2">
          {notice && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              {notice}
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6 lg:col-span-2">
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <h3 className="font-bold text-gray-900 mb-4">室內設計專案基本資料</h3>
            {loading && <p className="mb-3 text-xs text-gray-500">同步最新專案資料中...</p>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <label className="mb-1 block text-xs text-gray-600">室內設計專案名稱</label>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">客戶名稱</label>
                <input
                  value={draft.client}
                  onChange={(event) => setDraft((prev) => ({ ...prev, client: event.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">案件狀態</label>
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, status: event.target.value as ProjectStatus }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white"
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
                  value={draft.phase}
                  onChange={(event) => setDraft((prev) => ({ ...prev, phase: event.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">預算</label>
                <input
                  value={draft.budget}
                  onChange={(event) => setDraft((prev) => ({ ...prev, budget: event.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">封面圖片 URL</label>
                <input
                  value={draft.img}
                  onChange={(event) => setDraft((prev) => ({ ...prev, img: event.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                />
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => coverInputRef.current?.click()}
                    disabled={uploadingCover}
                  >
                    {uploadingCover ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {uploadingCover ? "上傳中..." : "上傳封面圖片"}
                  </Button>
                  <p className="text-[11px] text-gray-500">可直接上傳，或手動貼上 URL</p>
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs text-gray-600">綁定 LINE CRM 客戶</label>
                <select
                  value={draft.linkedContactId || ""}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      linkedContactId: event.target.value || undefined,
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white"
                >
                  <option value="">不綁定</option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.displayName}
                    </option>
                  ))}
                </select>
                {linkedContact?.tags && linkedContact.tags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {linkedContact.tags.map((tag) => (
                      <span
                        key={`linked_contact_tag_${tag}`}
                        className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-700"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-gray-500">此客戶目前沒有 CRM 標籤</p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900">報價單管理（可由獨立報價系統回存草稿）</h3>
                <p className="text-xs text-gray-500 mt-1">
                  可在報價單系統維護草稿與內容，儲存後回寫至本專案。
                </p>
              </div>
              <Button size="sm" variant="outline" className="gap-1" onClick={addQuotationItem}>
                <Plus className="w-4 h-4" />
                新增項目
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
              <input
                value={draft.quotationMeta?.quoteNo || ""}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    quotationMeta: { ...(prev.quotationMeta || {}), quoteNo: event.target.value },
                  }))
                }
                className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                placeholder="報價單號"
              />
              <input
                type="date"
                value={draft.quotationMeta?.validUntil || ""}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    quotationMeta: { ...(prev.quotationMeta || {}), validUntil: event.target.value },
                  }))
                }
                className="rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
              <select
                value={draft.quotationMeta?.status || "draft"}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    quotationMeta: {
                      ...(prev.quotationMeta || {}),
                      status: event.target.value as "draft" | "sent" | "accepted",
                    },
                  }))
                }
                className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
              >
                <option value="draft">草稿</option>
                <option value="sent">已送出</option>
                <option value="accepted">已接受</option>
              </select>
              <input
                value={draft.quotationMeta?.note || ""}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    quotationMeta: { ...(prev.quotationMeta || {}), note: event.target.value },
                  }))
                }
                className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                placeholder="草稿註記"
              />
            </div>
            <div className="space-y-3">
              {(draft.quotationItems || []).map((item) => (
                <div key={item.id} className="grid grid-cols-12 gap-2 items-center rounded-lg border border-gray-200 p-3">
                  <input
                    value={item.name}
                    onChange={(event) => handleQuotationChange(item.id, "name", event.target.value)}
                    className="col-span-12 md:col-span-4 rounded border border-gray-300 px-2 py-1.5 text-sm"
                    placeholder="項目名稱"
                  />
                  <input
                    value={item.description || ""}
                    onChange={(event) => handleQuotationChange(item.id, "description", event.target.value)}
                    className="col-span-12 md:col-span-3 rounded border border-gray-300 px-2 py-1.5 text-sm"
                    placeholder="說明"
                  />
                  <input
                    type="number"
                    value={item.quantity}
                    min={0}
                    onChange={(event) => handleQuotationChange(item.id, "quantity", event.target.value)}
                    className="col-span-3 md:col-span-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                    placeholder="數量"
                  />
                  <select
                    value={item.unit || "式"}
                    onChange={(event) => handleQuotationChange(item.id, "unit", event.target.value)}
                    className="col-span-3 md:col-span-1 rounded border border-gray-300 px-1 py-1.5 text-sm bg-white"
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
                    value={item.unitPrice}
                    min={0}
                    onChange={(event) => handleQuotationChange(item.id, "unitPrice", event.target.value)}
                    className="col-span-3 md:col-span-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                    placeholder="單價"
                  />
                  <div className="col-span-2 md:col-span-1 text-sm text-right text-gray-700">
                    {(item.quantity * item.unitPrice).toLocaleString("zh-TW")}
                  </div>
                  <button
                    onClick={() => removeQuotationItem(item.id)}
                    className="col-span-1 text-red-600 hover:text-red-800 justify-self-end"
                    title="刪除項目"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <div className="flex justify-end border-t border-gray-100 pt-3">
                <p className="text-sm font-semibold text-gray-900">總計：NT$ {quotationTotal.toLocaleString("zh-TW")}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900">空間渲染紀錄</h3>
                <p className="text-xs text-gray-500 mt-1">
                  建議每次 AI 渲染後記錄版本、來源、參考圖與備註，方便專案追蹤。
                </p>
              </div>
              <Button size="sm" variant="outline" className="gap-1" onClick={addDressSelectionRecord}>
                <Plus className="w-4 h-4" />
                新增紀錄
              </Button>
            </div>
            <div className="space-y-3">
              {(draft.dressSelectionRecords || []).length === 0 && (
                <p className="text-sm text-gray-500">目前尚無渲染紀錄，可由 AI Studio 產生後回填。</p>
              )}
              {(draft.dressSelectionRecords || []).map((record) => (
                <div key={record.id} className="rounded-lg border border-gray-200 p-3 space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <input
                      value={record.dressName}
                      onChange={(event) =>
                        updateDressSelectionRecord(record.id, "dressName", event.target.value)
                      }
                      className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                      placeholder="渲染主題"
                    />
                    <input
                      value={record.sourceLabel || ""}
                      onChange={(event) =>
                        updateDressSelectionRecord(record.id, "sourceLabel", event.target.value)
                      }
                      className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                      placeholder="來源（預設模板/自訂需求）"
                    />
                    <input
                      value={record.model || ""}
                      onChange={(event) =>
                        updateDressSelectionRecord(record.id, "model", event.target.value)
                      }
                      className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                      placeholder="模型版本"
                    />
                    <input
                      value={record.createdAt.slice(0, 10)}
                      onChange={(event) =>
                        updateDressSelectionRecord(
                          record.id,
                          "createdAt",
                          `${event.target.value}T00:00:00.000Z`,
                        )
                      }
                      type="date"
                      className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                  <textarea
                    value={record.dressSpec || ""}
                    onChange={(event) =>
                      updateDressSelectionRecord(record.id, "dressSpec", event.target.value)
                    }
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm h-16 resize-y"
                    placeholder="渲染重點（材質、燈光、動線）"
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      value={record.referenceImageUrl || ""}
                      onChange={(event) =>
                        updateDressSelectionRecord(record.id, "referenceImageUrl", event.target.value)
                      }
                      className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                      placeholder="參考圖片 URL"
                    />
                    <input
                      value={record.generatedImageUrl || ""}
                      onChange={(event) =>
                        updateDressSelectionRecord(record.id, "generatedImageUrl", event.target.value)
                      }
                      className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                      placeholder="生成結果圖片 URL"
                    />
                  </div>
                  <textarea
                    value={record.note || ""}
                    onChange={(event) =>
                      updateDressSelectionRecord(record.id, "note", event.target.value)
                    }
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm h-16 resize-y"
                    placeholder="備註（客戶偏好、修改方向、待確認重點）"
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-red-700 border-red-200 hover:bg-red-50"
                      onClick={() => removeDressSelectionRecord(record.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                      刪除紀錄
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ===== 工程安排 / 甘特圖 啟動卡 ===== */}
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h3 className="font-bold text-gray-900">工程安排（甘特圖）</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  依報價項目 + 整體施作需求自動排程，全螢幕編輯與輸出。目前 {(draft.workflowTasks || []).length} 個工項。
                </p>
              </div>
              <Button
                variant="primary"
                className="gap-2"
                onClick={() => { setWorkflowFullscreen(true); setWorkflowEditing(false); }}
              >
                <Calculator className="w-4 h-4" /> 開啟工程安排
              </Button>
            </div>
            {(draft.workflowTasks || []).length > 0 && (
              <div className="mt-4 overflow-x-auto rounded-lg border border-gray-100 bg-white max-h-64 overflow-y-hidden">
                <GanttChart
                  tasks={draft.workflowTasks || []}
                  projectName={draft.name}
                  fallbackDate={draft.date || new Date().toISOString().slice(0, 10)}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== 工程安排全螢幕子頁 ===== */}
      {workflowFullscreen && (
        <div className="fixed inset-0 z-[70] bg-gray-50 flex flex-col">
          {/* 返回列 */}
          <div className="bg-white border-b border-gray-200 px-4 md:px-8 py-3 flex items-center gap-3 shadow-sm shrink-0">
            <button
              onClick={() => setWorkflowFullscreen(false)}
              className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-brand-700 font-medium"
            >
              <ArrowLeft className="w-5 h-5" /> 返回專案管理
            </button>
            <span className="text-gray-300">|</span>
            <h1 className="text-base font-bold text-gray-800">工程安排 · {draft.name}</h1>
            <div className="ml-auto flex flex-wrap gap-2">
              {!workflowEditing && (
                <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => setWorkflowViewMode("gantt")}
                    className={`px-3 py-1.5 text-sm ${workflowViewMode === "gantt" ? "bg-brand-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
                  >
                    甘特圖
                  </button>
                  <button
                    onClick={() => setWorkflowViewMode("calendar")}
                    className={`px-3 py-1.5 text-sm border-l border-gray-200 ${workflowViewMode === "calendar" ? "bg-brand-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
                  >
                    日曆
                  </button>
                </div>
              )}
              <Button size="sm" variant="outline" className="gap-1" onClick={() => void generateGanttSchedule()} disabled={generatingGantt}>
                {generatingGantt ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {generatingGantt ? "排程中..." : "AI 依報價生成排程"}
              </Button>
              {!workflowEditing ? (
                <Button size="sm" variant="outline" className="gap-1" onClick={() => setWorkflowEditing(true)}>
                  <Pencil className="w-4 h-4" /> 編輯
                </Button>
              ) : (
                <Button size="sm" variant="primary" className="gap-1" onClick={() => setWorkflowEditing(false)}>
                  <Eye className="w-4 h-4" /> 完成編輯（看甘特圖）
                </Button>
              )}
              <Button size="sm" variant="outline" className="gap-1" onClick={() => void exportGantt("png")} disabled={exportingGantt || (draft.workflowTasks || []).length === 0}>
                {exportingGantt ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} PNG
              </Button>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => void exportGantt("pdf")} disabled={exportingGantt || (draft.workflowTasks || []).length === 0}>
                <Download className="w-4 h-4" /> PDF
              </Button>
              <Button size="sm" onClick={() => void handleSave()} disabled={saving} className="gap-1">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 儲存
              </Button>
            </div>
          </div>

          {/* 內容 */}
          <div className="flex-1 overflow-auto p-4 md:p-8">
            {notice && (
              <div className="mb-3 rounded-lg bg-brand-50 border border-brand-100 px-3 py-2 text-sm text-brand-700">{notice}</div>
            )}
            {!workflowEditing && workflowViewMode === "gantt" && (
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
                <div ref={ganttRef}>
                  <GanttChart
                    tasks={draft.workflowTasks || []}
                    projectName={draft.name}
                    fallbackDate={draft.date || new Date().toISOString().slice(0, 10)}
                  />
                </div>
              </div>
            )}
            {!workflowEditing && workflowViewMode === "calendar" && (
              <div ref={ganttRef}>
                <CalendarView
                  tasks={draft.workflowTasks || []}
                  fallbackDate={draft.date || new Date().toISOString().slice(0, 10)}
                />
              </div>
            )}
            {workflowEditing && (
              <div className="space-y-2 max-w-5xl">
                <div className="flex justify-between items-center">
                  <p className="text-sm text-gray-500">為每個工項設定階段、開始日與工期天數，甘特圖會自動排列。</p>
                  <Button size="sm" variant="outline" className="gap-1" onClick={addWorkflowTask}>
                    <Plus className="w-4 h-4" /> 新增工項
                  </Button>
                </div>
                {(draft.workflowTasks || []).length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-8">
                    尚無工項。按「AI 依報價生成排程」自動建立，或手動新增。
                  </p>
                )}
                {(draft.workflowTasks || []).map((task) => (
                  <div key={task.id} className="grid grid-cols-12 gap-2 items-center rounded-lg border border-gray-200 bg-white p-3">
                    <input
                      value={task.title}
                      onChange={(event) => updateWorkflowTask(task.id, "title", event.target.value)}
                      className="col-span-12 md:col-span-3 rounded border border-gray-300 px-2 py-1.5 text-sm"
                      placeholder="工項名稱"
                    />
                    <input
                      value={task.stage || ""}
                      onChange={(event) => updateWorkflowTask(task.id, "stage", event.target.value)}
                      className="col-span-4 md:col-span-2 rounded border border-gray-300 px-2 py-1.5 text-sm"
                      placeholder="階段(如:木作)"
                    />
                    <input
                      type="date"
                      value={task.date || ""}
                      onChange={(event) => updateWorkflowTask(task.id, "date", event.target.value)}
                      className="col-span-5 md:col-span-2 rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <div className="col-span-3 md:col-span-2 flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        value={task.durationDays || 1}
                        onChange={(event) => updateWorkflowTask(task.id, "durationDays", Math.max(1, Number(event.target.value) || 1))}
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      />
                      <span className="text-xs text-gray-400">天</span>
                    </div>
                    <input
                      value={task.owner || ""}
                      onChange={(event) => updateWorkflowTask(task.id, "owner", event.target.value)}
                      className="col-span-8 md:col-span-2 rounded border border-gray-300 px-2 py-1.5 text-sm"
                      placeholder="工班/負責人"
                    />
                    <button
                      onClick={() => removeWorkflowTask(task.id)}
                      className="col-span-4 md:col-span-1 text-red-600 hover:text-red-800 justify-self-end"
                      title="刪除工項"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <input
                      value={task.detail || ""}
                      onChange={(event) => updateWorkflowTask(task.id, "detail", event.target.value)}
                      className="col-span-12 rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-600"
                      placeholder="工項說明（選填）"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
