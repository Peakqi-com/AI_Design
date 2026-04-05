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
  quantity: number;
  unitPrice: number;
}

export interface ProjectWorkflowTask {
  id: string;
  date?: string;
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

export interface CrmStore {
  version: number;
  lineSettings: LineIntegrationSettings | null;
  lineSettingsByUser?: Record<string, LineIntegrationSettings>;
  contacts: CrmContact[];
  messages: CrmMessage[];
  projects: CrmProject[];
}
