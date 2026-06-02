import { LucideIcon } from 'lucide-react';

export type ViewState = 'landing' | 'login' | 'dashboard';
export type DashboardView = 'overview' | 'ai-studio' | 'ai-chat' | 'video-studio' | 'projects' | 'quotation' | 'crm' | 'marketing' | 'subscription' | 'media-library' | 'presentation' | 'video-script' | 'admin';

/** 從媒體庫「帶回生成介面」時，重新填入生成器的設定。 */
export interface GenerationRestore {
  prompt?: string;
  generationPrompt?: string;
  style?: string;
  roomType?: string;
  aspectRatio?: string;
  mode?: string;
  model?: string;
  sourceType?: string;
  durationSec?: number;
  imageUrl?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  plan: 'free' | 'pro' | 'enterprise';
  credits: number;
}

export interface PricingPlan {
  id: string;
  title: string;
  price: string;
  period?: string;
  description: string;
  features: string[];
  recommended?: boolean;
  type: 'subscription' | 'credits' | 'course' | 'addon';
  buttonText: string;
  paymentUrl?: string;
}

export interface NavItem {
  id: DashboardView;
  label: string;
  icon: LucideIcon;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  status: "draft" | "active" | "quoted" | "completed";
  phase: string;
  budget: string;
  date: string;
  img: string;
  linkedContactId?: string;
  note?: string;
  lastSyncedToCrmAt?: string;
  archivedAt?: string;
  filedAt?: string;
  deletedAt?: string;
  deletePurgeAt?: string;
  quotationItems?: ProjectQuotationItem[];
  workflowTasks?: ProjectWorkflowTask[];
  auspiciousPlan?: ProjectAuspiciousPlan;
  dressSelectionRecords?: ProjectDressSelectionRecord[];
  quotationMeta?: ProjectQuotationMeta;
  notificationEmail?: string;
  notificationTemplates?: ProjectNotificationTemplate[];
}

export interface ProjectDressSelectionRecord {
  id: string;
  dressName: string;
  dressSpec?: string;
  sourceLabel?: string;
  referenceAssetId?: string;
  referenceImageUrl?: string;
  generatedImageUrl?: string;
  summary?: string;
  model?: string;
  note?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ProjectQuotationItem {
  id: string;
  name: string;
  description?: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
}

export interface ProjectWorkflowTask {
  id: string;
  date?: string;
  durationDays?: number;
  stage?: string;
  time: string;
  title: string;
  detail?: string;
  owner?: string;
  done?: boolean;
  isCustom?: boolean;
  reminderMinutesBefore?: number;
  templateId?: string;
  lastReminderSentAt?: string;
  lastReminderFor?: string;
}

export interface ProjectAuspiciousPlan {
  ceremonyDate?: string;
  preferredWindow?: "morning" | "afternoon" | "evening";
  recommendedStartTime?: string;
  recommendations?: string[];
  generatedAt?: string;
}

export interface ProjectQuotationMeta {
  quoteNo?: string;
  validUntil?: string;
  status?: "draft" | "sent" | "accepted";
  note?: string;
  updatedAt?: string;
}

export interface ProjectNotificationTemplate {
  id: string;
  name: string;
  content: string;
}