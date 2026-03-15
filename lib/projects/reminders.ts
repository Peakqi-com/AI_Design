import { pushLineTextMessage } from "@/lib/crm/line";
import { getContactById, getLineSettings } from "@/lib/crm/store";
import {
  CrmContact,
  CrmProject,
  LineIntegrationSettings,
  ProjectNotificationTemplate,
  ProjectWorkflowTask,
} from "@/lib/crm/types";

const DEFAULT_TEMPLATES: ProjectNotificationTemplate[] = [
  {
    id: "default_timeline",
    name: "流程提醒",
    content:
      "提醒您：{projectName} 的「{taskTitle}」將在 {taskDateTime} 開始，負責人：{taskOwner}。如需調整請盡快回覆。",
  },
  {
    id: "default_preparation",
    name: "行前準備提醒",
    content:
      "您好，{projectName} 即將進行「{taskTitle}」（{taskDateTime}）。請提前確認圖面、材質樣板與聯絡窗口，謝謝！",
  },
  {
    id: "default_followup",
    name: "追蹤確認提醒",
    content:
      "溫馨提醒：{projectName} 的「{taskTitle}」預計於 {taskDateTime} 執行，若有變更請回覆此訊息，我們會即時協助。",
  },
];

const OVERDUE_WINDOW_MINUTES = Number(process.env.PROJECT_REMINDER_OVERDUE_WINDOW_MINUTES || 12 * 60);

type ChannelStatus = "sent" | "skipped" | "failed";

export interface ReminderDispatchTaskResult {
  taskId: string;
  taskTitle: string;
  taskDateTime: string;
  status: "sent" | "skipped" | "failed";
  message: string;
  email: { status: ChannelStatus; detail: string };
  line: { status: ChannelStatus; detail: string };
}

export interface ReminderDispatchResult {
  projectId: string;
  projectName: string;
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
  taskResults: ReminderDispatchTaskResult[];
  nextWorkflowTasks: ProjectWorkflowTask[];
}

interface DispatchInput {
  project: CrmProject;
  force?: boolean;
  taskIds?: string[];
  now?: Date;
}

const toTaskDateTime = (task: ProjectWorkflowTask, fallbackDate = ""): Date | null => {
  const datePart = task.date?.trim() || fallbackDate.trim();
  if (!datePart) {
    return null;
  }
  const normalizedTime = task.time?.trim() || "00:00";
  const parsed = new Date(`${datePart}T${normalizedTime}:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};

const formatTaskDateTime = (value: Date): string =>
  value.toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const resolveTemplates = (project: CrmProject): ProjectNotificationTemplate[] =>
  Array.isArray(project.notificationTemplates) && project.notificationTemplates.length > 0
    ? project.notificationTemplates
    : DEFAULT_TEMPLATES;

const getTemplateForTask = (
  project: CrmProject,
  task: ProjectWorkflowTask,
): ProjectNotificationTemplate => {
  const templates = resolveTemplates(project);
  return (
    templates.find((item) => item.id === task.templateId) ??
    templates[0] ?? {
      id: "fallback",
      name: "流程提醒",
      content: "{projectName}：{taskTitle}（{taskDateTime}）提醒。",
    }
  );
};

const applyTemplate = (content: string, vars: Record<string, string>): string =>
  content.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");

const scheduleKeyForTask = (task: ProjectWorkflowTask): string =>
  [
    task.date?.trim() || "",
    task.time?.trim() || "",
    String(task.reminderMinutesBefore ?? 0),
    task.templateId?.trim() || "",
  ].join("|");

const shouldSendNow = (task: ProjectWorkflowTask, now: Date, fallbackDate: string, force = false): boolean => {
  if (task.done) {
    return false;
  }
  if (force) {
    return true;
  }
  const scheduledAt = toTaskDateTime(task, fallbackDate);
  if (!scheduledAt) {
    return false;
  }
  const reminderMinutes = Math.max(0, Number(task.reminderMinutesBefore || 0));
  const triggerAt = new Date(scheduledAt.getTime() - reminderMinutes * 60 * 1000);
  if (now.getTime() < triggerAt.getTime()) {
    return false;
  }
  if (now.getTime() - triggerAt.getTime() > OVERDUE_WINDOW_MINUTES * 60 * 1000) {
    return false;
  }
  return true;
};

const renderTaskReminderMessage = (project: CrmProject, task: ProjectWorkflowTask, taskDateTime: Date): string => {
  const template = getTemplateForTask(project, task);
  return applyTemplate(template.content, {
    projectName: project.name,
    clientName: project.clientName,
    taskTitle: task.title,
    taskDetail: task.detail || "",
    taskOwner: task.owner || "未指定",
    taskDateTime: formatTaskDateTime(taskDateTime),
  });
};

const sendReminderEmail = async (
  to: string,
  subject: string,
  text: string,
): Promise<{ status: ChannelStatus; detail: string }> => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_FROM_EMAIL || process.env.RESEND_FROM_EMAIL;
  if (!to) {
    return { status: "skipped", detail: "No recipient email." };
  }
  if (!apiKey || !from) {
    return { status: "skipped", detail: "RESEND_API_KEY or from email not configured." };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      return { status: "failed", detail: `Resend error ${response.status}: ${body}` };
    }
    return { status: "sent", detail: "Email sent." };
  } catch (error) {
    return {
      status: "failed",
      detail: error instanceof Error ? error.message : "Email send failed.",
    };
  }
};

const sendReminderLine = async (
  lineSettings: LineIntegrationSettings | null,
  contact: CrmContact | null,
  text: string,
): Promise<{ status: ChannelStatus; detail: string }> => {
  if (!contact?.lineUserId) {
    return { status: "skipped", detail: "Contact has no LINE user id." };
  }
  if (!lineSettings?.enabled || !lineSettings.channelAccessToken) {
    return { status: "skipped", detail: "LINE channel not configured." };
  }
  try {
    const result = await pushLineTextMessage(
      contact.lineUserId,
      text,
      lineSettings.channelAccessToken,
    );
    if (!result.ok) {
      return {
        status: "failed",
        detail: `LINE push failed (${result.status}).`,
      };
    }
    return { status: "sent", detail: "LINE message sent." };
  } catch (error) {
    return {
      status: "failed",
      detail: error instanceof Error ? error.message : "LINE send failed.",
    };
  }
};

export async function dispatchProjectReminders(input: DispatchInput): Promise<ReminderDispatchResult> {
  const project = input.project;
  const now = input.now ?? new Date();
  const fallbackDate = project.auspiciousPlan?.ceremonyDate?.trim() || "";
  const selectedTaskIds = new Set((input.taskIds || []).map((item) => item.trim()).filter(Boolean));
  const useTaskFilter = selectedTaskIds.size > 0;
  const nextWorkflowTasks = [...(project.workflowTasks || [])];
  const contact = project.linkedContactId ? await getContactById(project.linkedContactId) : null;
  const lineSettings = await getLineSettings();

  const taskResults: ReminderDispatchTaskResult[] = [];

  for (let i = 0; i < nextWorkflowTasks.length; i += 1) {
    const task = nextWorkflowTasks[i];
    if (useTaskFilter && !selectedTaskIds.has(task.id)) {
      continue;
    }

    if (!shouldSendNow(task, now, fallbackDate, Boolean(input.force))) {
      continue;
    }

    const taskDateTime = toTaskDateTime(task, fallbackDate);
    if (!taskDateTime) {
      taskResults.push({
        taskId: task.id,
        taskTitle: task.title,
        taskDateTime: "",
        status: "failed",
        message: "",
        email: { status: "skipped", detail: "Missing date/time." },
        line: { status: "skipped", detail: "Missing date/time." },
      });
      continue;
    }

    const scheduleKey = scheduleKeyForTask(task);
    if (!input.force && task.lastReminderFor === scheduleKey && task.lastReminderSentAt) {
      taskResults.push({
        taskId: task.id,
        taskTitle: task.title,
        taskDateTime: formatTaskDateTime(taskDateTime),
        status: "skipped",
        message: "",
        email: { status: "skipped", detail: "Already sent for current schedule." },
        line: { status: "skipped", detail: "Already sent for current schedule." },
      });
      continue;
    }

    const message = renderTaskReminderMessage(project, task, taskDateTime);
    const recipientEmail = project.notificationEmail?.trim() || contact?.email?.trim() || "";
    const emailResult = await sendReminderEmail(
      recipientEmail,
      `[流程提醒] ${project.name} - ${task.title}`,
      message,
    );
    const lineResult = await sendReminderLine(lineSettings, contact, message);
    const isSent = emailResult.status === "sent" || lineResult.status === "sent";
    const status: ReminderDispatchTaskResult["status"] = isSent
      ? "sent"
      : emailResult.status === "failed" || lineResult.status === "failed"
        ? "failed"
        : "skipped";

    if (isSent) {
      nextWorkflowTasks[i] = {
        ...task,
        lastReminderSentAt: now.toISOString(),
        lastReminderFor: scheduleKey,
      };
    }

    taskResults.push({
      taskId: task.id,
      taskTitle: task.title,
      taskDateTime: formatTaskDateTime(taskDateTime),
      status,
      message,
      email: emailResult,
      line: lineResult,
    });
  }

  const sent = taskResults.filter((item) => item.status === "sent").length;
  const failed = taskResults.filter((item) => item.status === "failed").length;
  const skipped = taskResults.filter((item) => item.status === "skipped").length;

  return {
    projectId: project.id,
    projectName: project.name,
    processed: taskResults.length,
    sent,
    skipped,
    failed,
    taskResults,
    nextWorkflowTasks,
  };
}
