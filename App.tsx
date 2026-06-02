import React, { useEffect, useMemo, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { ViewState, DashboardView, User, Project, GenerationRestore } from "./types";
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
import { MediaLibrary } from "./components/MediaLibrary";
import { PresentationMaker } from "./components/PresentationMaker";
import { AdminPanel } from "./components/AdminPanel";
import { AIChatImage } from "./components/AIChatImage";
import { VideoScriptWorkflow } from "./components/VideoScriptWorkflow";
import { useCredits } from "./lib/client/use-credits";
import { CreditsModalProvider } from "./lib/client/credits-modal-context";

const DEMO_USER: User = {
  id: "u_demo",
  name: "Interior Team Demo",
  email: "team@interiorpro.tw",
  avatar: "https://picsum.photos/200",
  plan: "free",
  credits: 30,
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
  };
  return {
    id: user.id || "u_oauth",
    name: user.name || "Interior User",
    email: user.email || "oauth-user@example.com",
    avatar: user.image || "https://picsum.photos/200",
    plan: user.plan || "free",
    credits: typeof user.credits === "number" ? user.credits : 30,
  };
};

const App: React.FC = () => {
  const { data: session, status } = useSession();
  const [viewState, setViewState] = useState<ViewState>("landing");
  const [dashboardView, setDashboardView] = useState<DashboardView>("overview");
  const [manualUser, setManualUser] = useState<User | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [presentationProjectId, setPresentationProjectId] = useState<string | undefined>(undefined);
  const [genRestore, setGenRestore] = useState<GenerationRestore | undefined>(undefined);
  const credits = useCredits();

  /** 從媒體庫帶回生成設定到對應生成器。 */
  const handleRestoreGeneration = (target: DashboardView, payload: GenerationRestore) => {
    setGenRestore(payload);
    setDashboardView(target);
  };
  const oauthUser = useMemo(() => toAppUser(session?.user), [session?.user]);
  const user = oauthUser ?? manualUser;

  // Check admin: super admin email OR isAdmin flag from credits
  const adminEmails = ["ai.allen.task@gmail.com"];
  const isAdmin = credits.isAdmin
    || adminEmails.includes((credits.userEmail || "").toLowerCase())
    || adminEmails.includes((user?.email || "").toLowerCase())
    || adminEmails.includes(((session?.user as { email?: string })?.email || "").toLowerCase());

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

  const handleGoToPresentation = (projectId: string) => {
      setPresentationProjectId(projectId);
      setDashboardView("presentation");
  };

  const handleViewChange = (view: DashboardView) => {
      setDashboardView(view);
      if (view !== 'projects' && view !== "quotation") {
          setSelectedProject(null);
      }
      // Sidebar navigation to presentation = fresh (not from a project)
      if (view === "presentation") {
          setPresentationProjectId(undefined);
      }
      // 從側欄主動切換到生成器 = 全新狀態，清掉媒體庫帶回的設定
      if (view === "ai-studio" || view === "ai-chat" || view === "video-studio") {
          setGenRestore(undefined);
      }
  };

  const renderDashboardContent = () => {
    switch (dashboardView) {
      case "overview":
        return <DashboardHome />;
      case "subscription":
        return <SubscriptionPage />;
      case "ai-studio":
        return <AIStudio restore={genRestore} />;
      case "ai-chat":
        return <AIChatImage restore={genRestore} />;
      case "projects":
        if (selectedProject) {
          return (
            <ProjectDetail
              project={selectedProject}
              onBack={handleBackToProjects}
              onGoToAI={handleGoToAI}
              onGoToQuotation={handleGoToQuotation}
              onGoToPresentation={handleGoToPresentation}
              onProjectUpdated={handleProjectUpdated}
            />
          );
        }
        return <ProjectList onSelectProject={handleProjectSelect} />;
      case "marketing":
        return <MarketingCenter />;
      case "video-studio":
        return <VideoStudio restore={genRestore} />;
      case "crm":
        return <CRMSystem onNavigateToProjects={() => setDashboardView("projects")} />;
      case "media-library":
        return <MediaLibrary onRestoreGeneration={handleRestoreGeneration} />;
      case "presentation":
        return <PresentationMaker initialProjectId={presentationProjectId} />;
      case "video-script":
        return <VideoScriptWorkflow />;
      case "admin":
        return <AdminPanel />;
      default:
        return <DashboardHome />;
    }
  };

  return (
    <CreditsModalProvider
      isLoggedIn={!!user}
      onUpgrade={() => {
        setViewState("dashboard");
        setDashboardView("subscription");
      }}
      onSignUp={() => setViewState("login")}
    >
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

        {/* 報價單系統：從專案進入時為全螢幕子頁（無左側選單） */}
        {viewState === "dashboard" && user && dashboardView === "quotation" && (
          <QuotationGenerator
            initialProjectId={selectedProject?.id}
            onBack={() => setDashboardView("projects")}
          />
        )}

        {viewState === "dashboard" && user && dashboardView !== "quotation" && (
          <DashboardLayout
            user={user}
            currentView={dashboardView}
            onChangeView={handleViewChange}
            onLogout={handleLogout}
            isAdmin={isAdmin}
            liveCredits={credits.credits}
            liveStorageUsed={credits.storageUsedBytes}
            liveStorageQuota={credits.storageQuotaBytes}
            userPlan={credits.plan}
          >
            {renderDashboardContent()}
          </DashboardLayout>
        )}
      </div>
    </CreditsModalProvider>
  );
};

export default App;