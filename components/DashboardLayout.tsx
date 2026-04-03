import React from 'react';
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
  Library
} from 'lucide-react';
import { NavItem, User, DashboardView } from '../types';

interface DashboardLayoutProps {
  user: User;
  currentView: DashboardView;
  onChangeView: (view: DashboardView) => void;
  onLogout: () => void;
  children: React.ReactNode;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ 
  user, 
  currentView, 
  onChangeView, 
  onLogout,
  children 
}) => {
  const navItems: NavItem[] = [
    { id: 'overview', label: '室內設計總覽', icon: LayoutDashboard },
    { id: 'ai-studio', label: 'AI 空間渲染', icon: Palette },
    { id: 'video-studio', label: '空間動態影片', icon: Video },
    { id: 'media-library', label: '媒體庫', icon: Library },
    { id: 'marketing', label: '社群發文中心', icon: Share2 },
    { id: 'crm', label: '客戶關係 CRM', icon: MessageCircle },
    { id: 'projects', label: '室內專案管理', icon: FileText },
    { id: 'quotation', label: 'AI 裝修報價', icon: Calculator },
    { id: 'subscription', label: '訂閱與點數', icon: CreditCard },
  ];

  const planMap: Record<string, string> = {
    free: '免費版',
    pro: '專業版',
    enterprise: '企業版'
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200 fixed h-full hidden md:flex flex-col z-20">
        <div className="p-6 flex items-center gap-2 border-b border-gray-100">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center text-white font-bold">Ai</div>
          <span className="font-bold text-xl text-gray-900">Interior Pro</span>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onChangeView(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                currentView === item.id
                  ? 'bg-brand-50 text-brand-600'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <item.icon className={`w-5 h-5 ${currentView === item.id ? 'text-brand-600' : 'text-gray-400'}`} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-100 bg-gray-50/50">
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 shadow-sm">
            <p className="text-xs font-semibold text-brand-800 uppercase mb-1">AI 算力點數</p>
            <div className="flex justify-between items-end">
              <span className="text-2xl font-bold text-brand-600">{user.credits}</span>
              <button 
                onClick={() => onChangeView('subscription')}
                className="text-xs text-brand-600 hover:text-brand-700 underline"
              >
                立即加值
              </button>
            </div>
          </div>
          
          <button 
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut className="w-5 h-5" />
            登出
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 md:ml-64 flex flex-col min-h-screen">
        {/* Top Header */}
        <header className="bg-white border-b border-gray-200 h-16 px-8 flex items-center justify-between sticky top-0 z-30 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            {navItems.find(i => i.id === currentView)?.icon && React.createElement(navItems.find(i => i.id === currentView)!.icon, { className: "w-5 h-5 text-brand-600" })}
            {navItems.find(i => i.id === currentView)?.label}
          </h2>
          
          <div className="flex items-center gap-4">
            <button className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-white"></span>
            </button>
            <div className="h-8 w-px bg-gray-200 mx-2"></div>
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-gray-900">{user.name}</p>
                <p className="text-xs text-gray-500 capitalize">{planMap[user.plan] || user.plan} 方案</p>
              </div>
              <img src={user.avatar} alt="用戶頭像" className="w-9 h-9 rounded-full bg-gray-200 border border-gray-200" />
            </div>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
};