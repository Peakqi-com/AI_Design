export type ContactStatus = "new" | "contacted" | "proposal" | "signed";
export type ContactSource = "line" | "manual";
export type MessageDirection = "inbound" | "outbound";
export type MessageType =
  | "text"
  | "image"
  | "file"
  | "video"
  | "audio"
  | "sticker"
  | "location"
  | "system";

export type AttachmentType = "image" | "file" | "video" | "audio";
export type AttachmentStorage = "public_url" | "inline_base64" | "metadata_only";

export interface LineIntegrationSettings {
  enabled: boolean;
  channelId: string;
  channelAccessToken: string;
  channelSecret: string;
  updatedAt: string;
  lastWebhookAt?: string;
  lastWebhookEventCount?: number;
  lastWebhookProcessedCount?: number;
  lastWebhookFailedCount?: number;
  lastWebhookError?: string | null;
}

export interface CrmAttachment {
  id: string;
  type: AttachmentType;
  storage: AttachmentStorage;
  name?: string;
  mimeType?: string;
  size?: number;
  url?: string;
  base64Data?: string;
  lineMessageId?: string;
}

export interface CrmMessage {
  id: string;
  contactId: string;
  source: "line" | "crm";
  direction: MessageDirection;
  senderType: "customer" | "agent" | "system";
  messageType: MessageType;
  text?: string;
  attachment?: CrmAttachment;
  lineMessageId?: string;
  timestamp: string;
  rawEvent?: unknown;
}

export interface CrmContact {
  id: string;
  userId?: string;
  source: ContactSource;
  lineUserId?: string;
  displayName: string;
  avatarUrl?: string | null;
  tags: string[];
  status: ContactStatus;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  address?: string;
  notes?: string;
  cardImageUrl?: string;
  unread: number;
  lastMessageText?: string;
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrmProject {
  id: string;
  userId?: string;
  name: string;
  clientName: string;
  status: "draft" | "active" | "quoted" | "completed";
  phase: string;
  budget: string;
  coverImageUrl: string;
  linkedContactId?: string;
  linkedContactIds?: string[];
  linkedAssetIds?: string[];
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
  createdAt: string;
  updatedAt: string;
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
  /** 工期天數（甘特圖用）；未填視為 1 天 */
  durationDays?: number;
  /** 階段分類（如 拆除/水電/泥作/木作/油漆/系統櫃/收尾），甘特圖分組與配色用 */
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

export interface PresentationSlideDraft {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  layout: string;
}

export interface PresentationDraft {
  id: string;
  userId?: string;
  title: string;
  designerName?: string;
  briefDesc?: string;
  linkedProjectId?: string;
  slides: PresentationSlideDraft[];
  styleId?: string;
  step?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PricingStandardItem {
  id: string;
  name: string;
  unit: string;
  unitPrice: number;
  category: string;
  aliases?: string[];
  note?: string;
}

/** 自訂標籤定義（顏色 + 自動套用關鍵字）。 */
export interface TagDefinition {
  id: string;
  name: string;
  color: string; // tailwind 顏色 key，如 "blue" | "green" | "amber" ...
  /** 自動套用：客戶訊息含任一關鍵字就自動加此標籤 */
  autoKeywords?: string[];
}

export interface CrmStore {
  version: number;
  lineSettings: LineIntegrationSettings | null;
  lineSettingsByUser?: Record<string, LineIntegrationSettings>;
  contacts: CrmContact[];
  messages: CrmMessage[];
  projects: CrmProject[];
  presentations?: PresentationDraft[];
  /** Per-user standard pricing tables, keyed by user scope. */
  pricingByUser?: Record<string, PricingStandardItem[]>;
  /** Per-user custom tag definitions, keyed by user scope. */
  tagsByUser?: Record<string, TagDefinition[]>;
}
