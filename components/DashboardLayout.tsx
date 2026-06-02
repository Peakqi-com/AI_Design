import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Palette,
  FileText,
  Share2,
  CreditCard,
  LogOut,
  Bell,
  Video,
  Calculator,
  MessageCircle,
  Library,
  Menu,
  Presentation,
  Shield,
  Sparkles,
  Clapperboard,
  X,
} from 'lucide-react';
import { NavItem, User, DashboardView } from '../types';
import { canAccessFeature, formatCredits, type UserPlan } from '@/lib/credits/store';
import { resolveClientUserScopeId } from '@/lib/client/user-scope';

interface DashboardLayoutProps {
  user: User;
  currentView: DashboardView;
  onChangeView: (view: DashboardView) => void;
  onLogout: () => void;
  children: React.ReactNode;
  isAdmin?: boolean;
  liveCredits?: number;
  liveStorageUsed?: number;
  liveStorageQuota?: number;
  userPlan?: string;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  user,
  currentView,
  onChangeView,
  onLogout,
  children,
  isAdmin,
  liveCredits,
  liveStorageUsed,
  liveStorageQuota,
  userPlan,
}) => {
  const navItems: NavItem[] = [
    { id: 'overview', label: '室內設計總覽', icon: LayoutDashboard },
    { id: 'ai-studio', label: 'AI 空間渲染', icon: Palette },
    { id: 'ai-chat', label: 'AI 對話生圖', icon: Sparkles },
    { id: 'video-studio', label: '空間動態影片', icon: Video },
    { id: 'media-library', label: '媒體庫', icon: Library },
    { id: 'presentation', label: '簡報製作', icon: Presentation },
    { id: 'video-script', label: '行銷影片腳本', icon: Clapperboard },
    { id: 'marketing', label: '社群發文中心', icon: Share2 },
    { id: 'crm', label: '客戶關係 CRM', icon: MessageCircle },
    { id: 'projects', label: '室內專案管理', icon: FileText },
    { id: 'subscription', label: '訂閱與點數', icon: CreditCard },
    ...(isAdmin ? [{ id: 'admin' as DashboardView, label: '管理員後台', icon: Shield }] : []),
  ];

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const crmScope = resolveClientUserScopeId(user.id, user.email);
  useEffect(() => {
    let active = true;
    const fetchUnread = async () => {
      try {
        const params = new URLSearchParams();
        if (crmScope) params.set('userId', crmScope);
        const res = await fetch(`/api/crm/contacts?${params.toString()}`, {
          headers: crmScope ? { 'x-user-scope': crmScope } : {},
        });
        if (!res.ok || !active) return;
        const data = await res.json();
        const list: Array<{ unread?: number }> = data.contacts ?? data ?? [];
        setUnreadCount(list.reduce((sum, c) => sum + (c.unread || 0), 0));
      } catch {
        /* ignore */
      }
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 20000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [crmScope, currentView]);

  const planMap: Record<string, string> = {
    free: '免費版',
    pro: '專業版',
    business: '商務版',
    enterprise: '企業版'
  };

  const displayPlan = userPlan || user.plan;

  const sidebarContent = (
    <>
      <div className="p-6 flex items-center justify-between border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center text-white font-bold">Ai</div>
          <span className="font-bold text-xl text-gray-900">Interior Pro</span>
        </div>
        <button onClick={() => setMobileMenuOpen(false)} className="md:hidden p-1 text-gray-400 hover:text-gray-600">
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto custom-scrollbar">
        {navItems.map((item) => {
          const plan = (userPlan || "free") as UserPlan;
          const hasAccess = canAccessFeature(plan, item.id);
          return (
            <button
              key={item.id}
              onClick={() => {
                if (hasAccess) {
                  onChangeView(item.id);
                  setMobileMenuOpen(false);
                } else {
                  onChangeView('subscription');
                  setMobileMenuOpen(false);
                }
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                !hasAccess
                  ? 'text-gray-400 hover:bg-gray-50'
                  : currentView === item.id
                    ? 'bg-brand-50 text-brand-600'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <item.icon className={`w-5 h-5 ${!hasAccess ? 'text-gray-300' : currentView === item.id ? 'text-brand-600' : 'text-gray-400'}`} />
              <span className="flex-1 text-left">{item.label}</span>
              {!hasAccess && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">PRO</span>}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-gray-100 bg-gray-50/50">
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 shadow-sm">
          <p className="text-xs font-semibold text-brand-800 uppercase mb-1">AI 算力點數</p>
          <div className="flex justify-between items-end">
            <span className="text-2xl font-bold text-brand-600">{formatCredits(typeof liveCredits === "number" ? liveCredits : user.credits)}</span>
            <button
              onClick={() => { onChangeView('subscription'); setMobileMenuOpen(false); }}
              className="text-xs text-brand-600 hover:text-brand-700 underline"
            >
              立即加值
            </button>
          </div>
        </div>
        {typeof liveStorageUsed === "number" && typeof liveStorageQuota === "number" && (
          <div className="bg-white border border-gray-200 rounded-lg p-3 mb-4 shadow-sm">
            <div className="flex justify-between text-[10px] text-gray-500 mb-1">
              <span>儲存空間</span>
              <span>{(liveStorageUsed / (1024 * 1024)).toFixed(1)} / {(liveStorageQuota / (1024 * 1024)).toFixed(0)} MB</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full transition-all ${liveStorageUsed / liveStorageQuota > 0.9 ? "bg-red-500" : "bg-brand-500"}`}
                style={{ width: `${Math.min(100, (liveStorageUsed / liveStorageQuota) * 100)}%` }}
              />
            </div>
          </div>
        )}
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          <LogOut className="w-5 h-5" />
          登出
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Desktop Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200 fixed h-full hidden md:flex flex-col z-20">
        {sidebarContent}
      </div>

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-white flex flex-col shadow-xl">
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 md:ml-64 flex flex-col min-h-screen">
        {/* Top Header */}
        <header className="bg-white border-b border-gray-200 h-14 md:h-16 px-4 md:px-8 flex items-center justify-between sticky top-0 z-30 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-base md:text-lg font-semibold text-gray-800 flex items-center gap-2">
              {navItems.find(i => i.id === currentView)?.icon && React.createElement(navItems.find(i => i.id === currentView)!.icon, { className: "w-5 h-5 text-brand-600" })}
              <span className="hidden sm:inline">{navItems.find(i => i.id === currentView)?.label}</span>
            </h2>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            <button
              onClick={() => onChangeView('crm')}
              className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 relative"
              title={unreadCount > 0 ? `${unreadCount} 則未讀客戶訊息` : '客戶訊息'}
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border border-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <div className="h-8 w-px bg-gray-200 hidden sm:block"></div>
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-gray-900">{user.name}</p>
                <p className="text-xs text-gray-500 capitalize">{planMap[displayPlan] || displayPlan} 方案</p>
              </div>
              <img src={user.avatar} alt="用戶頭像" className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-gray-200 border border-gray-200" />
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-[1600px] mx-auto p-4 md:p-5 lg:p-6 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
};