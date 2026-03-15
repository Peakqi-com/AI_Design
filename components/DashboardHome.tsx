import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  ArrowUpRight,
  Clock,
  DollarSign,
  Image as ImageIcon,
  Calendar,
  CheckSquare,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "./Button";
import { resolveClientUserScopeId } from "@/lib/client/user-scope";

type ProjectStatus = "draft" | "active" | "quoted" | "completed";

interface WorkflowTaskLite {
  id: string;
  date?: string;
  time?: string;
  title: string;
  done?: boolean;
}

interface DashboardProject {
  id: string;
  name: string;
  clientName: string;
  status: ProjectStatus;
  phase?: string;
  budget?: string;
  coverImageUrl?: string;
  updatedAt: string;
  archivedAt?: string;
  filedAt?: string;
  deletedAt?: string;
  workflowTasks?: WorkflowTaskLite[];
}

interface DashboardContact {
  id: string;
  displayName: string;
  unread: number;
}

interface DashboardAsset {
  id: string;
  kind: "image" | "video";
  createdAt: string;
}

interface DashboardVaultItem {
  id: string;
  createdAt: string;
}

interface ChartPoint {
  name: string;
  contentCount: number;
  projectUpdates: number;
}

const DEFAULT_PROJECT_IMAGE =
  "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&q=80&w=400";

const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "草稿",
  active: "進行中",
  quoted: "提案中",
  completed: "已完成",
};

const weekdayFormatter = new Intl.DateTimeFormat("zh-TW", { weekday: "short" });
const dateFormatter = new Intl.DateTimeFormat("zh-TW", {
  month: "2-digit",
  day: "2-digit",
});
const currencyFormatter = new Intl.NumberFormat("zh-TW", {
  style: "currency",
  currency: "TWD",
  maximumFractionDigits: 0,
});

const toLocalDateKey = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const parseBudgetAmount = (budget?: string): number => {
  if (!budget) {
    return 0;
  }
  const normalized = budget.replace(/,/g, "").trim();
  const valueMatch = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!valueMatch) {
    return 0;
  }
  const value = Number(valueMatch[1]);
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (/萬/.test(normalized)) {
    return Math.round(value * 10000);
  }
  if (/千/.test(normalized)) {
    return Math.round(value * 1000);
  }
  return Math.round(value);
};

const parseTaskTimestamp = (date?: string, time?: string): number => {
  if (!date) {
    return Number.MAX_SAFE_INTEGER;
  }
  const merged = `${date}T${time && /^\d{2}:\d{2}/.test(time) ? time : "23:59"}:00`;
  const timestamp = new Date(merged).getTime();
  return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
};

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { method: "GET" });
  const raw = await response.text();
  const payload = raw ? (JSON.parse(raw) as T & { error?: string }) : null;
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  if (!payload) {
    throw new Error("Server returned empty payload.");
  }
  return payload;
}

const getErrorMessage = (reason: unknown, fallback: string): string =>
  reason instanceof Error ? reason.message : fallback;

export const DashboardHome: React.FC = () => {
  const { data: session } = useSession();
  const [projects, setProjects] = useState<DashboardProject[]>([]);
  const [contacts, setContacts] = useState<DashboardContact[]>([]);
  const [assets, setAssets] = useState<DashboardAsset[]>([]);
  const [socialPosts, setSocialPosts] = useState<DashboardVaultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const userScopeId = useMemo(() => {
    const sessionUser = session?.user as { id?: string; email?: string | null } | undefined;
    return resolveClientUserScopeId(sessionUser?.id || null, sessionUser?.email || null);
  }, [session?.user]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectResult, contactResult, assetResult, postResult] = await Promise.allSettled([
        requestJson<{ projects: DashboardProject[] }>("/api/projects?includeFiled=1"),
        requestJson<{ contacts: DashboardContact[] }>("/api/crm/contacts"),
        requestJson<{ items: DashboardAsset[] }>(
          `/api/social/assets?userId=${encodeURIComponent(userScopeId)}&limit=120`,
        ),
        requestJson<{ items: DashboardVaultItem[] }>(
          `/api/content/vault?userId=${encodeURIComponent(userScopeId)}&kind=social-post&limit=120`,
        ),
      ]);
      const partialErrors: string[] = [];

      if (projectResult.status === "fulfilled") {
        setProjects(Array.isArray(projectResult.value.projects) ? projectResult.value.projects : []);
      } else {
        setProjects([]);
        partialErrors.push(`專案：${getErrorMessage(projectResult.reason, "讀取失敗")}`);
      }

      if (contactResult.status === "fulfilled") {
        setContacts(Array.isArray(contactResult.value.contacts) ? contactResult.value.contacts : []);
      } else {
        setContacts([]);
        partialErrors.push(`客戶：${getErrorMessage(contactResult.reason, "讀取失敗")}`);
      }

      if (assetResult.status === "fulfilled") {
        setAssets(Array.isArray(assetResult.value.items) ? assetResult.value.items : []);
      } else {
        setAssets([]);
        partialErrors.push(`素材：${getErrorMessage(assetResult.reason, "讀取失敗")}`);
      }

      if (postResult.status === "fulfilled") {
        setSocialPosts(Array.isArray(postResult.value.items) ? postResult.value.items : []);
      } else {
        setSocialPosts([]);
        partialErrors.push(`貼文：${getErrorMessage(postResult.reason, "讀取失敗")}`);
      }

      if (partialErrors.length > 0) {
        setError(`部分資料同步失敗：${partialErrors.join("；")}`);
      }
      setLastSyncedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "讀取總覽資料失敗");
    } finally {
      setLoading(false);
    }
  }, [userScopeId]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const derived = useMemo(() => {
    const validProjects = projects.filter((project) => !project.deletedAt);
    const activeProjects = validProjects.filter(
      (project) => !project.archivedAt && !project.filedAt && project.status !== "completed",
    );

    const allTasks = validProjects.flatMap((project) =>
      (project.workflowTasks || []).map((task) => ({
        ...task,
        projectId: project.id,
        projectName: project.name,
      })),
    );
    const pendingTasks = allTasks.filter((task) => !task.done);
    const completedTasks = allTasks.filter((task) => Boolean(task.done));

    const todayKey = toLocalDateKey(new Date());
    const todaySchedule = pendingTasks
      .filter((task) => task.date === todayKey)
      .sort((a, b) => parseTaskTimestamp(a.date, a.time) - parseTaskTimestamp(b.date, b.time))
      .slice(0, 5);

    const pendingTodo = pendingTasks
      .slice()
      .sort((a, b) => parseTaskTimestamp(a.date, a.time) - parseTaskTimestamp(b.date, b.time))
      .slice(0, 3)
      .map((task) => ({ text: `${task.projectName}：${task.title}`, checked: false }));
    const doneTodo = completedTasks
      .slice()
      .sort((a, b) => parseTaskTimestamp(a.date, a.time) - parseTaskTimestamp(b.date, b.time))
      .slice(0, 2)
      .map((task) => ({ text: `${task.projectName}：${task.title}`, checked: true }));
    const todoItems = [...pendingTodo, ...doneTodo];

    const unreadContacts = contacts.filter((contact) => contact.unread > 0);
    if (todoItems.length < 5 && unreadContacts.length > 0) {
      todoItems.push({
        text: `待回覆客戶訊息 ${unreadContacts.reduce((sum, item) => sum + item.unread, 0)} 則`,
        checked: false,
      });
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthAssetCount = assets.filter(
      (item) => new Date(item.createdAt).getTime() >= monthStart,
    ).length;
    const monthPostCount = socialPosts.filter(
      (item) => new Date(item.createdAt).getTime() >= monthStart,
    ).length;

    const totalBudget = validProjects.reduce((sum, project) => sum + parseBudgetAmount(project.budget), 0);
    const projectsWithBudget = validProjects.filter((project) => parseBudgetAmount(project.budget) > 0).length;

    const next7days: ChartPoint[] = [];
    const dayKeys: string[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = toLocalDateKey(date);
      dayKeys.push(key);
      next7days.push({
        name: weekdayFormatter.format(date),
        contentCount: 0,
        projectUpdates: 0,
      });
    }
    const chartMap = new Map<string, number>();
    dayKeys.forEach((key, idx) => chartMap.set(key, idx));

    for (const asset of assets) {
      const key = toLocalDateKey(new Date(asset.createdAt));
      const idx = chartMap.get(key);
      if (idx !== undefined) {
        next7days[idx].contentCount += 1;
      }
    }
    for (const post of socialPosts) {
      const key = toLocalDateKey(new Date(post.createdAt));
      const idx = chartMap.get(key);
      if (idx !== undefined) {
        next7days[idx].contentCount += 1;
      }
    }
    for (const project of validProjects) {
      const key = toLocalDateKey(new Date(project.updatedAt));
      const idx = chartMap.get(key);
      if (idx !== undefined) {
        next7days[idx].projectUpdates += 1;
      }
    }

    const thisWeekTasks = allTasks.filter((task) => {
      const timestamp = parseTaskTimestamp(task.date, task.time);
      if (timestamp === Number.MAX_SAFE_INTEGER) {
        return false;
      }
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - 6);
      return timestamp >= start.getTime();
    });
    const thisWeekDone = thisWeekTasks.filter((task) => task.done).length;
    const completionRate =
      thisWeekTasks.length === 0 ? 0 : Math.round((thisWeekDone / thisWeekTasks.length) * 100);

    return {
      activeProjects,
      pendingTasksCount: pendingTasks.length,
      unreadContactsCount: unreadContacts.reduce((sum, contact) => sum + contact.unread, 0),
      monthContentCount: monthAssetCount + monthPostCount,
      totalBudget,
      projectsWithBudget,
      chartData: next7days,
      todaySchedule,
      todoItems,
      completionRate,
      weekTaskSummary: `${thisWeekDone}/${thisWeekTasks.length || 0} 已完成`,
    };
  }, [assets, contacts, projects, socialPosts]);

  const userName =
    ((session?.user as { name?: string | null } | undefined)?.name || "").trim() || "Interior Team";
  const todayLabel = dateFormatter.format(new Date());

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">歡迎回來，{userName}</h1>
          <p className="text-gray-500">
            今天是 {todayLabel}，目前有 {derived.pendingTasksCount} 項流程待處理、{derived.unreadContactsCount} 則客戶未讀訊息。
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="gap-2" onClick={() => void loadDashboard()} disabled={loading}>
            <Calendar className="w-4 h-4" /> {loading ? "同步中..." : "重新同步總覽"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "進行中專案",
            value: `${derived.activeProjects.length} 件`,
            sub: `尚有 ${derived.pendingTasksCount} 項流程待完成`,
            icon: Clock,
            color: "bg-blue-100 text-blue-600",
          },
          {
            label: "本週流程完成率",
            value: `${derived.completionRate}%`,
            sub: derived.weekTaskSummary,
            icon: ArrowUpRight,
            color: "bg-green-100 text-green-600",
          },
          {
            label: "本月生成內容",
            value: `${derived.monthContentCount} 筆`,
            sub: "整合圖片、影片、社群貼文",
            icon: ImageIcon,
            color: "bg-purple-100 text-purple-600",
          },
          {
            label: "專案總預算估算",
            value: currencyFormatter.format(derived.totalBudget),
            sub: `統計 ${derived.projectsWithBudget} 個已填預算專案`,
            icon: DollarSign,
            color: "bg-orange-100 text-orange-600",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-start justify-between hover:shadow-md transition-shadow"
          >
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{stat.label}</p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</h3>
              <p className="text-xs text-gray-500 mt-1">{stat.sub}</p>
            </div>
            <div className={`p-2.5 rounded-lg ${stat.color}`}>
              <stat.icon className="w-5 h-5" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-lg font-bold text-gray-900">近 7 日營運趨勢</h3>
                <p className="text-xs text-gray-500">
                  圖表整合社群素材、貼文產出與專案更新資料
                  {lastSyncedAt ? `（同步於 ${new Date(lastSyncedAt).toLocaleTimeString("zh-TW")}）` : ""}
                </p>
              </div>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={derived.chartData} barSize={22}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#9ca3af", fontSize: 12 }}
                    dy={10}
                  />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#9ca3af", fontSize: 12 }} />
                  <Tooltip
                    cursor={{ fill: "#f9fafb" }}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "none",
                      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                    }}
                  />
                  <Bar dataKey="contentCount" fill="#ea580c" radius={[4, 4, 0, 0]} name="內容產出" />
                  <Bar dataKey="projectUpdates" fill="#3b82f6" radius={[4, 4, 0, 0]} name="專案更新" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-900">進行中室內設計專案</h3>
            </div>
            {derived.activeProjects.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 text-sm text-gray-500">
                目前沒有進行中的專案，可先到「室內專案管理」新增案件。
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {derived.activeProjects.slice(0, 4).map((project) => {
                  const tasks = project.workflowTasks || [];
                  const done = tasks.filter((task) => task.done).length;
                  const progress =
                    tasks.length > 0
                      ? Math.round((done / tasks.length) * 100)
                      : project.status === "quoted"
                        ? 45
                        : project.status === "active"
                          ? 60
                          : 20;
                  return (
                    <div
                      key={project.id}
                      className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex gap-4 hover:border-brand-200 transition-colors"
                    >
                      <div className="w-24 h-24 rounded-lg overflow-hidden flex-shrink-0">
                        <img
                          src={project.coverImageUrl || DEFAULT_PROJECT_IMAGE}
                          alt={project.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex-1 py-1">
                        <div className="flex justify-between items-start">
                          <h4 className="font-bold text-gray-900 line-clamp-1">{project.name}</h4>
                          <MoreHorizontal className="w-4 h-4 text-gray-400" />
                        </div>
                        <p className="text-xs text-gray-500 mb-3">客戶：{project.clientName}</p>
                        <div className="flex items-center gap-2 mb-1">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-brand-500 rounded-full"
                              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium text-gray-600">{progress}%</span>
                        </div>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700">
                          {project.phase?.trim() || PROJECT_STATUS_LABELS[project.status]}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-brand-600" /> 今日行程
            </h3>
            {derived.todaySchedule.length === 0 ? (
              <p className="text-sm text-gray-500">今日沒有待執行流程。</p>
            ) : (
              <div className="space-y-4">
                {derived.todaySchedule.map((event, idx) => (
                  <div key={event.id} className="flex gap-3 relative pb-4 last:pb-0">
                    {idx !== derived.todaySchedule.length - 1 && (
                      <div className="absolute left-[19px] top-8 bottom-0 w-px bg-gray-100" />
                    )}
                    <div className="w-12 text-xs font-medium text-gray-500 pt-1 text-right">
                      {event.time?.trim() || "--:--"}
                    </div>
                    <div className="w-2.5 h-2.5 rounded-full bg-brand-200 mt-1.5 ring-4 ring-white relative z-10" />
                    <div className="flex-1 bg-gray-50 p-2 rounded-lg -mt-1">
                      <p className="text-sm font-medium text-gray-900">{event.projectName}</p>
                      <p className="text-xs text-gray-600">{event.title}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <CheckSquare className="w-5 h-5 text-blue-600" /> 待辦事項
            </h3>
            {derived.todoItems.length === 0 ? (
              <p className="text-sm text-gray-500">目前沒有待辦事項。</p>
            ) : (
              <ul className="space-y-3">
                {derived.todoItems.map((task, idx) => (
                  <li key={`${task.text}_${idx}`} className="flex items-center gap-3">
                    <div
                      className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                        task.checked ? "bg-blue-500 border-blue-500" : "border-gray-300"
                      }`}
                    >
                      {task.checked && <CheckSquare className="w-3.5 h-3.5 text-white" />}
                    </div>
                    <span
                      className={`text-sm ${
                        task.checked ? "text-gray-400 line-through" : "text-gray-700"
                      }`}
                    >
                      {task.text}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};