import React, { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Crown,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Users,
} from "lucide-react";

interface UserRecord {
  userId: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  plan: string;
  credits: number;
  totalUsed: number;
  createdAt: string;
  updatedAt: string;
  isAdmin?: boolean;
}

interface PlanInfoItem {
  label: string;
  price: string;
  creditsPerMonth: number;
}

const PLAN_OPTIONS = ["free", "pro", "business", "enterprise"] as const;
const PLAN_BADGES: Record<string, { label: string; color: string }> = {
  free: { label: "免費", color: "bg-gray-100 text-gray-600" },
  pro: { label: "專業", color: "bg-blue-100 text-blue-700" },
  business: { label: "商務", color: "bg-purple-100 text-purple-700" },
  enterprise: { label: "企業", color: "bg-amber-100 text-amber-700" },
};

export const AdminPanel: React.FC = () => {
  const { data: session } = useSession();
  const email = (session?.user as { email?: string })?.email || "";
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [planInfo, setPlanInfo] = useState<Record<string, PlanInfoItem>>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editPlan, setEditPlan] = useState("free");
  const [editCredits, setEditCredits] = useState("");
  const [addCreditsAmount, setAddCreditsAmount] = useState("");
  const [showGuests, setShowGuests] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/credits?admin=1&email=${encodeURIComponent(email)}`);
      if (!res.ok) return;
      const data = await res.json();
      setUsers(data.users || []);
      setPlanInfo(data.planInfo || {});
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleSetPlan = async (targetUserId: string) => {
    setActionLoading(true);
    try {
      await fetch("/api/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-plan",
          email,
          targetUserId,
          plan: editPlan,
          credits: editCredits ? Number(editCredits) : undefined,
        }),
      });
      setEditingUser(null);
      setEditCredits("");
      void loadUsers();
    } catch {
      /* ignore */
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddCredits = async (targetUserId: string) => {
    if (!addCreditsAmount) return;
    setActionLoading(true);
    try {
      await fetch("/api/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add-credits",
          email,
          targetUserId,
          amount: Number(addCreditsAmount),
        }),
      });
      setAddCreditsAmount("");
      void loadUsers();
    } catch {
      /* ignore */
    } finally {
      setActionLoading(false);
    }
  };

  const realUsers = users.filter((u) => u.email || u.name || !u.userId.startsWith("guest_"));
  const guestUsers = users.filter((u) => !u.email && !u.name && u.userId.startsWith("guest_"));

  const baseList = showGuests ? users : realUsers;
  const filteredUsers = baseList
    .filter((u) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return u.userId.toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q) || (u.name || "").toLowerCase().includes(q);
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const stats = {
    total: realUsers.length,
    free: realUsers.filter((u) => u.plan === "free").length,
    paid: realUsers.filter((u) => u.plan !== "free").length,
    totalCreditsUsed: realUsers.reduce((sum, u) => sum + u.totalUsed, 0),
    guests: guestUsers.length,
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col gap-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
              <Shield className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">管理員後台</h2>
              <p className="text-xs text-gray-500">會員管理・點數控管・層級設定</p>
            </div>
          </div>
          <button
            onClick={() => void loadUsers()}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> 重新載入
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-5 gap-4 mt-4">
          {[
            { label: "註冊會員", value: stats.total, icon: Users, color: "text-brand-600" },
            { label: "免費會員", value: stats.free, icon: Users, color: "text-gray-600" },
            { label: "付費會員", value: stats.paid, icon: Crown, color: "text-purple-600" },
            { label: "總使用點數", value: stats.totalCreditsUsed, icon: Settings, color: "text-amber-600" },
            { label: "匿名訪客", value: stats.guests, icon: Users, color: "text-gray-400" },
          ].map((s) => (
            <div key={s.label} className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <s.icon className={`w-4 h-4 ${s.color}`} />
                <span className="text-xs text-gray-500">{s.label}</span>
              </div>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋 Email、姓名或 ID..."
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-white"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-500 whitespace-nowrap cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showGuests}
            onChange={(e) => setShowGuests(e.target.checked)}
            className="rounded border-gray-300 text-brand-600"
          />
          顯示匿名訪客（{guestUsers.length}）
        </label>
      </div>

      {/* User table */}
      <div className="flex-1 min-h-0 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
        <div className="grid grid-cols-[2.5fr_1.5fr_0.8fr_0.8fr_0.8fr_1fr_1fr] gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 shrink-0">
          <span>會員</span>
          <span>Email</span>
          <span>層級</span>
          <span>點數</span>
          <span>已用</span>
          <span>更新</span>
          <span>操作</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <RefreshCw className="w-6 h-6 animate-spin text-brand-600" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
              {searchQuery ? "無符合搜尋條件的會員" : showGuests ? "尚無會員" : "尚無已登入的會員（勾選「顯示匿名訪客」查看所有記錄）"}
            </div>
          ) : (
            filteredUsers.map((user) => {
              const badge = PLAN_BADGES[user.plan] || PLAN_BADGES.free;
              const isEditing = editingUser === user.userId;
              return (
                <div key={user.userId} className="border-b border-gray-100 last:border-0">
                  <div className="grid grid-cols-[2.5fr_1.5fr_0.8fr_0.8fr_0.8fr_1fr_1fr] gap-2 px-4 py-3 items-center text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt="" className="w-7 h-7 rounded-full shrink-0 border border-gray-200" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-gray-200 shrink-0 flex items-center justify-center text-[10px] text-gray-500 font-bold">
                          {(user.name || user.userId).charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">
                          {user.name || user.userId}
                          {user.isAdmin && <span className="ml-1 text-[10px] text-red-500 font-bold">ADMIN</span>}
                        </p>
                        <p className="text-[10px] text-gray-400 truncate">{user.userId}</p>
                      </div>
                    </div>
                    <span className="text-[11px] text-gray-600 truncate" title={user.email}>{user.email || "-"}</span>
                    <span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${badge.color}`}>
                        {badge.label}
                      </span>
                    </span>
                    <span className="text-gray-700 font-semibold">{user.credits}</span>
                    <span className="text-gray-500">{user.totalUsed}</span>
                    <span className="text-[11px] text-gray-400">
                      {new Date(user.updatedAt).toLocaleDateString("zh-TW")}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          setEditingUser(isEditing ? null : user.userId);
                          setEditPlan(user.plan);
                          setEditCredits("");
                        }}
                        className="px-2 py-1 text-[11px] border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                      >
                        {isEditing ? "取消" : "編輯"}
                      </button>
                    </div>
                  </div>

                  {/* Expand edit row */}
                  {isEditing && (
                    <div className="px-4 pb-3 flex flex-wrap items-end gap-3 bg-gray-50/50">
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-0.5">變更層級</label>
                        <select
                          value={editPlan}
                          onChange={(e) => setEditPlan(e.target.value)}
                          className="text-xs border-gray-300 rounded-md p-1.5 bg-white border"
                        >
                          {PLAN_OPTIONS.map((p) => (
                            <option key={p} value={p}>
                              {PLAN_BADGES[p]?.label || p}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-0.5">設定點數（留空=方案預設）</label>
                        <input
                          value={editCredits}
                          onChange={(e) => setEditCredits(e.target.value)}
                          placeholder="預設"
                          className="text-xs border-gray-300 rounded-md p-1.5 bg-white border w-20"
                          type="number"
                        />
                      </div>
                      <button
                        onClick={() => void handleSetPlan(user.userId)}
                        disabled={actionLoading}
                        className="px-3 py-1.5 text-[11px] bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-50"
                      >
                        套用層級
                      </button>
                      <div className="w-px h-6 bg-gray-200 mx-1" />
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-0.5">追加點數</label>
                        <input
                          value={addCreditsAmount}
                          onChange={(e) => setAddCreditsAmount(e.target.value)}
                          placeholder="100"
                          className="text-xs border-gray-300 rounded-md p-1.5 bg-white border w-20"
                          type="number"
                        />
                      </div>
                      <button
                        onClick={() => void handleAddCredits(user.userId)}
                        disabled={actionLoading || !addCreditsAmount}
                        className="px-3 py-1.5 text-[11px] bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                      >
                        追加
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
