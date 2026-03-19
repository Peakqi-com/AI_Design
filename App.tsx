import React, { useEffect, useMemo, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { ViewState, DashboardView, User, Project } from "./types";
import { LandingPage } from "./components/LandingPage";
import { LoginPage } from "./components/LoginPage";
import { DashboardLayout } from "./components/DashboardLayout";
import { DashboardHome } from "./components/DashboardHome";
import { SubscriptionPage } from "./components/SubscriptionPage";
import { AIStudio } from "./components/AIStudio";
import { ProjectList } from "./components/ProjectList";
import { ProjectDetail } from "./components/ProjectDetail";
import { MarketingCenter } from "./components/MarketingCenter";
import { QuotationGenerator } from "./components/QuotationGenerator";
import { VideoStudio } from "./components/VideoStudio";
import { CRMSystem } from "./components/CRMSystem";
import { resolveClientUserScopeId } from "@/lib/client/user-scope";

const DEMO_USER: User = {
  id: "u_demo",
  name: "Interior Team Demo",
  email: "team@interiorpro.tw",
  avatar: "https://picsum.photos/200",
  plan: "free",
  credits: 50,
};

const toAppUser = (sessionUser: unknown): User | null => {
  if (!sessionUser || typeof sessionUser !== "object") {
    return null;
  }
  const user = sessionUser as {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    plan?: "free" | "pro" | "enterprise";
    credits?: number;
    authProvider?: string;
  };
  const authProvider = String(user.authProvider || "");
  return {
    id: user.id || "u_oauth",
    name: user.name || "Interior User",
    email: user.email || "oauth-user@example.com",
    avatar: user.image || "https://picsum.photos/200",
    plan: user.plan || "free",
    credits: typeof user.credits === "number" ? user.credits : authProvider === "google" ? 30 : 50,
    authProvider,
  };
};

const App: React.FC = () => {
  const { data: session, status } = useSession();
  const [viewState, setViewState] = useState<ViewState>("landing");
  const [dashboardView, setDashboardView] = useState<DashboardView>("overview");
  const [manualUser, setManualUser] = useState<User | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [resolvedCredits, setResolvedCredits] = useState<number | null>(null);

  const oauthUser = useMemo(() => toAppUser(session?.user), [session?.user]);
  const user = oauthUser ?? manualUser;
  const effectiveUser = useMemo(
    () => (user ? { ...user, credits: resolvedCredits ?? user.credits } : null),
    [resolvedCredits, user],
  );

  useEffect(() => {
    if (!user) {
      setResolvedCredits(null);
      return;
    }
    const userScopeId = resolveClientUserScopeId(user.id, user.email);
    let aborted = false;
    const loadCredits = async () => {
      try {
        const response = await fetch(`/api/account/credits?userId=${encodeURIComponent(userScopeId)}`);
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { remainingCredits?: number | null };
        if (!aborted) {
          setResolvedCredits(typeof payload.remainingCredits === "number" ? payload.remainingCredits : null);
        }
      } catch {
        // ignore credit fetch failures and fallback to session value
      }
    };
    void loadCredits();
    const timer = window.setInterval(() => {
      void loadCredits();
    }, 10000);
    return () => {
      aborted = true;
      window.clearInterval(timer);
    };
  }, [user]);

  useEffect(() => {
    if (oauthUser && viewState !== "dashboard") {
      setViewState("dashboard");
    }
  }, [oauthUser, viewState]);

  useEffect(() => {
    if (!oauthUser && !manualUser && status === "unauthenticated" && viewState === "dashboard") {
      setViewState("landing");
      setDashboardView("overview");
      setSelectedProject(null);
    }
  }, [oauthUser, manualUser, status, viewState]);

  const handleLogin = () => {
    setManualUser(DEMO_USER);
    setViewState("dashboard");
  };

  const handleLogout = async () => {
    if (oauthUser) {
      await signOut({ redirect: false });
    }
    setManualUser(null);
    setResolvedCredits(null);
    setViewState("landing");
    setDashboardView("overview");
    setSelectedProject(null);
  };

  const handleProjectSelect = (project: Project) => {
    setSelectedProject(project);
    // Don't change dashboardView, stay in 'projects' but render Detail component
  };

  const handleProjectUpdated = (project: Project) => {
    setSelectedProject(project);
  };

  const handleBackToProjects = () => {
    setSelectedProject(null);
  };

  const handleGoToAI = () => {
      setDashboardView('ai-studio');
  };

  const handleGoToQuotation = () => {
      setDashboardView("quotation");
  };

  const handleViewChange = (view: DashboardView) => {
      setDashboardView(view);
      if (view !== 'projects' && view !== "quotation") {
          setSelectedProject(null);
      }
  };

  const renderDashboardContent = () => {
    switch (dashboardView) {
      case "overview":
        return <DashboardHome />;
      case "subscription":
        return <SubscriptionPage />;
      case "ai-studio":
        return <AIStudio />;
      case "projects":
        if (selectedProject) {
          return (
            <ProjectDetail
              project={selectedProject}
              onBack={handleBackToProjects}
              onGoToAI={handleGoToAI}
              onGoToQuotation={handleGoToQuotation}
              onProjectUpdated={handleProjectUpdated}
            />
          );
        }
        return <ProjectList onSelectProject={handleProjectSelect} />;
      case "marketing":
        return <MarketingCenter />;
      case "quotation":
        return <QuotationGenerator initialProjectId={selectedProject?.id} />;
      case "video-studio":
        return <VideoStudio />;
      case "crm":
        return <CRMSystem />;
      default:
        return <DashboardHome />;
    }
  };

  return (
    <div className="antialiased text-slate-900 font-sans">
      {viewState === "landing" && (
        <LandingPage onGetStarted={() => setViewState('login')} />
      )}

      {viewState === "login" && (
        <LoginPage
          onLogin={handleLogin}
          onBack={() => setViewState("landing")}
        />
      )}

      {viewState === "dashboard" && effectiveUser && (
        <DashboardLayout
          user={effectiveUser}
          currentView={dashboardView}
          onChangeView={handleViewChange}
          onLogout={handleLogout}
        >
          {renderDashboardContent()}
        </DashboardLayout>
      )}
    </div>
  );
};

export default App;