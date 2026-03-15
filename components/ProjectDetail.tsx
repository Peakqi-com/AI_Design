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
} from "lucide-react";

interface ProjectDetailProps {
  project: Project;
  onBack: () => void;
  onGoToAI: () => void;
  onGoToQuotation?: () => void;
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
  }, [onProjectUpdated, project.id]);

  const linkedContact = useMemo(
    () => contacts.find((item) => item.id === draft.linkedContactId) || null,
    [contacts, draft.linkedContactId],
  );
  const linkedContactName = linkedContact?.displayName || "未綁定";
  const isArchived = Boolean(draft.archivedAt);
  const isFiled = Boolean(draft.filedAt);
  const isDeleted = Boolean(draft.deletedAt);
  const [workflowTemplateId, setWorkflowTemplateId] = useState(WORKFLOW_TEMPLATES[0].id);
  const [workflowView, setWorkflowView] = useState<"list" | "gantt" | "calendar">("list");
  const [dispatchingReminder, setDispatchingReminder] = useState(false);

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
    field: keyof Pick<ProjectQuotationItem, "name" | "description" | "quantity" | "unitPrice">,
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
        { id: `quote_${crypto.randomUUID()}`, name: "新增項目", description: "", quantity: 1, unitPrice: 0 },
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

  const applyWorkflowTemplate = () => {
    const selected = WORKFLOW_TEMPLATES.find((item) => item.id === workflowTemplateId) || WORKFLOW_TEMPLATES[0];
    const fallbackDate = draft.auspiciousPlan?.ceremonyDate || draft.date || "";
    setDraft((prev) => ({
      ...prev,
      workflowTasks: selected.tasks.map((task) => createFlowTask({ ...task, date: fallbackDate })),
    }));
    setNotice(`已套用流程模板：${selected.label}`);
  };

  const addWorkflowTask = () => {
    const fallbackDate = draft.auspiciousPlan?.ceremonyDate || draft.date || "";
    setDraft((prev) => ({
      ...prev,
      workflowTasks: [...(prev.workflowTasks || []), createFlowTask({ date: fallbackDate })],
    }));
  };

  const generateWorkflowByAi = () => {
    const fallbackDate = draft.auspiciousPlan?.ceremonyDate || draft.date || "";
    const base = (draft.workflowTasks || []).length
      ? [...(draft.workflowTasks || [])]
      : WORKFLOW_TEMPLATES[0].tasks.map((task) => createFlowTask({ ...task, date: fallbackDate }));
    const hasSiteCheck = base.some((task) => /放樣|工序確認|site review/i.test(task.title));
    if (!hasSiteCheck) {
      base.unshift(
        createFlowTask({
          date: fallbackDate,
          time: "16:30",
          title: "現場放樣與工序確認",
          detail: "確認保護工程、動線與工班交接節點",
          owner: "設計師",
          isCustom: false,
        }),
      );
    }
    base.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    setDraft((prev) => ({ ...prev, workflowTasks: base }));
    setNotice("已完成 AI 流程優化（排序與關鍵節點補全）。");
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

  const generateAuspiciousPlan = () => {
    const preferred = draft.auspiciousPlan?.preferredWindow || "afternoon";
    const generated = buildAuspiciousPlan(draft, preferred);
    setDraft((prev) => ({
      ...prev,
      auspiciousPlan: generated,
    }));
    setNotice("已產生 AI 工期節點建議，可再手動微調。");
  };

  const handleDispatchReminders = async (force: boolean) => {
    setDispatchingReminder(true);
    setError(null);
    try {
      const response = await requestJson<{
        result: {
          processed: number;
          sent: number;
          failed: number;
          skipped: number;
          nextWorkflowTasks: ProjectWorkflowTask[];
        };
      }>(`/api/projects/${draft.id}/reminders/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      if (response.result.processed > 0) {
        setDraft((prev) => ({
          ...prev,
          workflowTasks: response.result.nextWorkflowTasks || prev.workflowTasks || [],
        }));
      }
      setNotice(
        `提醒處理完成：共 ${response.result.processed} 筆，已送出 ${response.result.sent}，失敗 ${response.result.failed}，略過 ${response.result.skipped}。`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "派送提醒失敗");
    } finally {
      setDispatchingReminder(false);
    }
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
          {isDeleted ? (
            <Button
              variant="outline"
              className="flex-1 lg:flex-none gap-2"
              onClick={() => void handleRestoreFromTrash()}
            >
              <ArchiveRestore className="w-4 h-4" />
              還原專案
            </Button>
          ) : (
            <>
          <Button
            variant="outline"
            className="flex-1 lg:flex-none gap-2"
            onClick={() => void handleArchiveToggle()}
          >
            {isArchived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
            {isArchived ? "取消封存" : "封存專案"}
          </Button>
          <Button
            variant="outline"
            className="flex-1 lg:flex-none gap-2"
            onClick={() => void handleFileToggle()}
          >
            <FolderArchive className="w-4 h-4" />
            {isFiled ? "取消建檔" : "歸納建檔"}
          </Button>
          <Button
            variant="outline"
            className="flex-1 lg:flex-none gap-2 text-red-700 border-red-200 hover:bg-red-50"
            onClick={() => void handleDeleteProject()}
          >
            <Trash2 className="w-4 h-4" />
            移到刪除區
          </Button>
            </>
          )}
          <Button onClick={onGoToAI} variant="outline" className="flex-1 lg:flex-none gap-2">
            <PenTool className="w-4 h-4" /> 進入 線稿轉渲染工坊
          </Button>
          <Button onClick={onGoToQuotation} variant="outline" className="flex-1 lg:flex-none gap-2">
            報價單系統
          </Button>
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
                    className="col-span-4 md:col-span-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                    placeholder="數量"
                  />
                  <input
                    type="number"
                    value={item.unitPrice}
                    min={0}
                    onChange={(event) => handleQuotationChange(item.id, "unitPrice", event.target.value)}
                    className="col-span-5 md:col-span-2 rounded border border-gray-300 px-2 py-1.5 text-sm"
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

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <div className="mb-4 flex flex-col gap-2">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <h3 className="font-bold text-gray-900">工程流程安排（清單 / 甘特圖 / 日曆）</h3>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={workflowTemplateId}
                    onChange={(event) => setWorkflowTemplateId(event.target.value)}
                    className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
                  >
                    {WORKFLOW_TEMPLATES.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.label}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="outline" onClick={applyWorkflowTemplate}>
                    套用模板
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1" onClick={generateWorkflowByAi}>
                    <Wand2 className="w-4 h-4" />
                    AI 流程優化
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1" onClick={addWorkflowTask}>
                    <Plus className="w-4 h-4" />
                    新增流程
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={workflowView === "list" ? "primary" : "outline"}
                  onClick={() => setWorkflowView("list")}
                >
                  清單編輯
                </Button>
                <Button
                  size="sm"
                  variant={workflowView === "gantt" ? "primary" : "outline"}
                  onClick={() => setWorkflowView("gantt")}
                >
                  甘特圖
                </Button>
                <Button
                  size="sm"
                  variant={workflowView === "calendar" ? "primary" : "outline"}
                  onClick={() => setWorkflowView("calendar")}
                >
                  日曆視圖
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleDispatchReminders(false)}
                  disabled={dispatchingReminder}
                >
                  {dispatchingReminder ? "派送中..." : "執行到期提醒"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleDispatchReminders(true)}
                  disabled={dispatchingReminder}
                >
                  立即測試提醒
                </Button>
              </div>
            </div>

            {workflowView === "list" && (
              <div className="space-y-2">
                {(draft.workflowTasks || []).map((task) => (
                  <div key={task.id} className="space-y-2 rounded-lg border border-gray-200 p-3">
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <input
                        type="date"
                        value={task.date || ""}
                        onChange={(event) => updateWorkflowTask(task.id, "date", event.target.value)}
                        className="col-span-12 md:col-span-2 rounded border border-gray-300 px-2 py-1.5 text-sm"
                      />
                      <input
                        type="time"
                        value={task.time}
                        onChange={(event) => updateWorkflowTask(task.id, "time", event.target.value)}
                        className="col-span-6 md:col-span-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                        placeholder="時間"
                      />
                      <input
                        value={task.title}
                        onChange={(event) => updateWorkflowTask(task.id, "title", event.target.value)}
                        className="col-span-6 md:col-span-2 rounded border border-gray-300 px-2 py-1.5 text-sm"
                        placeholder="流程名稱"
                      />
                      <input
                        value={task.detail || ""}
                        onChange={(event) => updateWorkflowTask(task.id, "detail", event.target.value)}
                        className="col-span-12 md:col-span-3 rounded border border-gray-300 px-2 py-1.5 text-sm"
                        placeholder="流程細節"
                      />
                      <input
                        value={task.owner || ""}
                        onChange={(event) => updateWorkflowTask(task.id, "owner", event.target.value)}
                        className="col-span-6 md:col-span-2 rounded border border-gray-300 px-2 py-1.5 text-sm"
                        placeholder="負責人"
                      />
                      <label className="col-span-4 md:col-span-1 inline-flex items-center justify-center gap-1 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          checked={Boolean(task.done)}
                          onChange={(event) => updateWorkflowTask(task.id, "done", event.target.checked)}
                        />
                        完成
                      </label>
                      <button
                        onClick={() => removeWorkflowTask(task.id)}
                        className="col-span-2 text-red-600 hover:text-red-800 justify-self-end"
                        title="刪除流程"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <div>
                        <label className="mb-1 block text-xs text-gray-500">提醒提前分鐘</label>
                        <input
                          type="number"
                          min={0}
                          value={task.reminderMinutesBefore || 0}
                          onChange={(event) =>
                            updateWorkflowTask(task.id, "reminderMinutesBefore", Math.max(0, Number(event.target.value) || 0))
                          }
                          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-500">提醒模板</label>
                        <select
                          value={task.templateId || "default_timeline"}
                          onChange={(event) => updateWorkflowTask(task.id, "templateId", event.target.value)}
                          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
                        >
                          {(draft.notificationTemplates || []).map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="text-xs text-gray-500 flex items-end">
                        上次提醒：{task.lastReminderSentAt ? new Date(task.lastReminderSentAt).toLocaleString("zh-TW") : "尚未發送"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {workflowView === "gantt" && (
              <div className="space-y-3">
                <div className="text-xs text-gray-500">
                  時間軸：{timelineBounds.start.toString().padStart(2, "0")}:00 ~{" "}
                  {timelineBounds.end.toString().padStart(2, "0")}:59
                </div>
                {sortedWorkflowTasks.map((task) => {
                  const [h, m] = (task.time || "00:00").split(":");
                  const hour = Number(h || "0");
                  const minute = Number(m || "0");
                  const ratioBase = Math.max(1, timelineBounds.end - timelineBounds.start + 1);
                  const hourFloat = hour + minute / 60;
                  const left = Math.min(96, Math.max(0, ((hourFloat - timelineBounds.start) / ratioBase) * 100));
                  const width = Math.max(4, 100 / ratioBase);
                  return (
                    <div key={task.id} className="rounded-lg border border-gray-200 p-3">
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>
                          {(task.date || draft.auspiciousPlan?.ceremonyDate || "--")} {task.time || "--:--"}
                        </span>
                        <span>{task.owner || "未指定負責人"}</span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-gray-800">{task.title}</p>
                      <div className="mt-2 h-3 rounded bg-gray-100 relative overflow-hidden">
                        <div
                          className={`absolute top-0 h-full rounded ${task.done ? "bg-green-500" : "bg-brand-500"}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {workflowView === "calendar" && (
              <div className="space-y-3">
                {workflowByDate.map(([date, tasks]) => (
                  <div key={date} className="rounded-lg border border-gray-200 p-3">
                    <h4 className="font-semibold text-sm text-gray-900">{date}</h4>
                    <div className="mt-2 space-y-2">
                      {tasks.map((task) => (
                        <div key={task.id} className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-gray-800">
                              {task.time || "--:--"} {task.title}
                            </span>
                            <span className="text-xs text-gray-500">{task.owner || "未指定"}</span>
                          </div>
                          <p className="text-xs text-gray-600 mt-1">{task.detail || "無細節描述"}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">AI 工期節點建議</h3>
              <Button size="sm" variant="outline" className="gap-1" onClick={generateAuspiciousPlan}>
                <Wand2 className="w-4 h-4" />
                AI 產生建議
              </Button>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <label className="mb-1 block text-xs text-gray-600">預計施工起日</label>
                <input
                  type="date"
                  value={draft.auspiciousPlan?.ceremonyDate || ""}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      auspiciousPlan: {
                        ...(prev.auspiciousPlan || {}),
                        ceremonyDate: event.target.value,
                      },
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">偏好時段</label>
                <select
                  value={draft.auspiciousPlan?.preferredWindow || "afternoon"}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      auspiciousPlan: {
                        ...(prev.auspiciousPlan || {}),
                        preferredWindow: event.target.value as "morning" | "afternoon" | "evening",
                      },
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white"
                >
                  <option value="morning">上午</option>
                  <option value="afternoon">下午</option>
                  <option value="evening">晚間</option>
                </select>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs text-gray-500">建議開工時間</p>
                <p className="mt-1 text-base font-semibold text-gray-800">
                  {draft.auspiciousPlan?.recommendedStartTime || "--:--"}
                </p>
                <ul className="mt-2 list-disc pl-5 text-xs text-gray-600 space-y-1">
                  {(draft.auspiciousPlan?.recommendations || []).map((item, idx) => (
                    <li key={`${idx}_${item}`}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">流程提醒與罐頭訊息</h3>
              <Button size="sm" variant="outline" onClick={addNotificationTemplate}>
                <Plus className="w-4 h-4" />
                新增模板
              </Button>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <label className="mb-1 block text-xs text-gray-600">提醒 Email（未填則使用 CRM 客戶 Email）</label>
                <input
                  type="email"
                  value={draft.notificationEmail || ""}
                  onChange={(event) => setDraft((prev) => ({ ...prev, notificationEmail: event.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="example@domain.com"
                />
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-2">
                  可用變數：{"{projectName}"} {"{clientName}"} {"{taskTitle}"} {"{taskDateTime}"} {"{taskOwner}"} {"{taskDetail}"}
                </p>
                <div className="space-y-2">
                  {(draft.notificationTemplates || []).map((template) => (
                    <div key={template.id} className="rounded border border-gray-200 bg-white p-2 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          value={template.name}
                          onChange={(event) =>
                            updateNotificationTemplate(template.id, "name", event.target.value)
                          }
                          className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                          placeholder="模板名稱"
                        />
                        <button
                          onClick={() => removeNotificationTemplate(template.id)}
                          className="text-red-600 hover:text-red-800"
                          title="刪除模板"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <textarea
                        value={template.content}
                        onChange={(event) =>
                          updateNotificationTemplate(template.id, "content", event.target.value)
                        }
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs h-20 resize-y"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-gray-500" /> 專案註記（可串接 CRM）
            </h3>
            <textarea
              value={draft.note || ""}
              onChange={(event) => setDraft((prev) => ({ ...prev, note: event.target.value }))}
              className="w-full text-sm border-gray-200 rounded-lg bg-gray-50 p-3 h-36 focus:ring-brand-500 focus:border-brand-500 resize-none"
              placeholder="輸入案件筆記，例如：希望主臥收納加強、公共區改用耐磨材質、並安排 3D 渲染提案..."
            />
            <div className="mt-3 flex flex-col gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => void handleSyncNoteToCrm()}
                disabled={syncing}
              >
                {syncing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                {syncing ? "同步中..." : "同步註記到 LINE CRM"}
              </Button>
              <p className="text-[11px] text-gray-500">
                最後同步：{draft.lastSyncedToCrmAt ? new Date(draft.lastSyncedToCrmAt).toLocaleString("zh-TW") : "尚未同步"}
              </p>
              <p className="text-[11px] text-gray-500">
                同步後會寫入 CRM 系統註記並加上案件標籤，不會發送給 LINE 客戶。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
