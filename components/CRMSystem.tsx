import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "./Button";
import {
  CheckCircle,
  Copy,
  Link as LinkIcon,
  MessageCircle,
  Paperclip,
  Search,
  Send,
  Settings,
  Smartphone,
  Tag,
  UserCircle,
  X,
} from "lucide-react";
import { resolveClientUserScopeId } from "@/lib/client/user-scope";
import { CrmInteriorIntakePanel } from "./CrmInteriorIntakePanel";

type ContactStatus = "new" | "contacted" | "proposal" | "signed";
type ContactSource = "line" | "manual";

interface CrmContact {
  id: string;
  source: ContactSource;
  lineUserId?: string;
  displayName: string;
  avatarUrl?: string | null;
  tags: string[];
  status: ContactStatus;
  email?: string;
  phone?: string;
  unread: number;
  lastMessageText?: string;
  lastMessageAt?: string;
  updatedAt?: string;
}

interface CrmAttachment {
  id: string;
  type: "image" | "file" | "video" | "audio";
  storage: "public_url" | "inline_base64" | "metadata_only";
  name?: string;
  mimeType?: string;
  size?: number;
  url?: string;
  dataUrl?: string;
}

interface CrmMessage {
  id: string;
  contactId: string;
  source: "line" | "crm";
  direction: "inbound" | "outbound";
  senderType: "customer" | "agent" | "system";
  messageType: "text" | "image" | "file" | "video" | "audio" | "sticker" | "location" | "system";
  text?: string;
  timestamp: string;
  attachment?: CrmAttachment;
}

interface LineSettings {
  connected: boolean;
  channelId: string;
  hasChannelAccessToken: boolean;
  hasChannelSecret: boolean;
  updatedAt: string | null;
  lastWebhookAt: string | null;
  lastWebhookEventCount: number;
  lastWebhookProcessedCount: number;
  lastWebhookFailedCount: number;
  lastWebhookError: string | null;
  webhookUrl: string;
  storageBackend?: "redis" | "file";
}

interface CrmUiCache {
  contacts: CrmContact[];
  selectedContactId: string | null;
  messagesByContact: Record<string, CrmMessage[]>;
  cachedAt: string;
}

const CRM_UI_CACHE_KEY = "aidesign:crm-ui-cache:v1";
const CRM_PROFILE_DRAFT_KEY = "aidesign:crm-profile-draft:v1";
const CRM_LINE_FORM_CACHE_KEY_PREFIX = "aidesign:line-form-cache:v1:";
const CRM_LINE_SETTINGS_CACHE_KEY_PREFIX = "aidesign:line-settings-cache:v1:";
const MAX_CACHE_CONTACTS = 120;
const MAX_CACHE_MESSAGES_PER_CONTACT = 120;
const INBOX_POLL_MS = 10000;
const NOTICE_DEDUP_TTL_MS = 12000;

interface ContactProfileForm {
  displayName: string;
  phone: string;
  email: string;
}

interface LineFormState {
  channelId: string;
  channelAccessToken: string;
  channelSecret: string;
}

const STATUS_LABELS: Record<ContactStatus, string> = {
  new: "新客戶",
  contacted: "已聯繫",
  proposal: "提案中",
  signed: "已簽約",
};

const formatTime = (iso?: string): string => {
  if (!iso) {
    return "--";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const getMessagePreview = (message: CrmMessage): string => {
  if (message.text?.trim()) {
    return message.text;
  }
  if (message.messageType === "sticker") {
    return "[LINE 貼圖]";
  }
  if (message.messageType === "location") {
    return "[位置訊息]";
  }
  if (!message.attachment) {
    return "[訊息]";
  }
  if (message.attachment.type === "image") {
    return "[圖片]";
  }
  if (message.attachment.type === "video") {
    return "[影片]";
  }
  if (message.attachment.type === "audio") {
    return "[語音]";
  }
  return "[檔案]";
};

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const method = (
    init?.method ??
    (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  const allowRetry = method === "GET";

  let response: Response;
  const endpointLabel =
    typeof input === "string"
      ? input
      : typeof Request !== "undefined" && input instanceof Request
        ? input.url
        : "request";
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await fetch(input, init);
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch";
      const transient = /failed to fetch|fetch failed|networkerror|network request failed/i.test(
        message.toLowerCase(),
      );
      if (!allowRetry || !transient || attempt >= 1) {
        throw new Error(message);
      }
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }

  const raw = await response.text();
  let payload: (T & { error?: string }) | null = null;
  if (raw) {
    try {
      payload = JSON.parse(raw) as T & { error?: string };
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    if (payload?.error) {
      const suffix = response.status >= 500 ? ` [${method} ${endpointLabel}]` : "";
      throw new Error(`${payload.error}${suffix}`);
    }
    const nonJsonText = raw.trim().slice(0, 160);
    throw new Error(nonJsonText || `Request failed (${response.status}) [${method} ${endpointLabel}].`);
  }
  if (!payload) {
    if (!raw) {
      return {} as T;
    }
    throw new Error("Server returned non-JSON response.");
  }
  return payload;
}

const getAvatarInitial = (name: string): string => {
  const first = name.trim().charAt(0);
  return first || "客";
};

const toContactProfileForm = (contact: CrmContact): ContactProfileForm => ({
  displayName: contact.displayName || "",
  phone: contact.phone || "",
  email: contact.email || "",
});

const isSameProfileForm = (a: ContactProfileForm, b: ContactProfileForm): boolean =>
  a.displayName === b.displayName && a.phone === b.phone && a.email === b.email;

const loadProfileDraftMap = (): Record<string, ContactProfileForm> => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(CRM_PROFILE_DRAFT_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, ContactProfileForm>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const saveProfileDraftMap = (drafts: Record<string, ContactProfileForm>): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(CRM_PROFILE_DRAFT_KEY, JSON.stringify(drafts));
  } catch {
    // local cache only, ignore storage errors.
  }
};

const loadLineFormCache = (scope: string): Partial<LineFormState> => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(`${CRM_LINE_FORM_CACHE_KEY_PREFIX}${scope}`);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Partial<LineFormState>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const saveLineFormCache = (form: LineFormState, scope: string): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(`${CRM_LINE_FORM_CACHE_KEY_PREFIX}${scope}`, JSON.stringify(form));
  } catch {
    // ignore storage errors for optional cache.
  }
};

const clearLineFormCache = (scope: string): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(`${CRM_LINE_FORM_CACHE_KEY_PREFIX}${scope}`);
  } catch {
    // ignore storage errors.
  }
};

const loadLineSettingsCache = (scope: string): Partial<LineSettings> => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(`${CRM_LINE_SETTINGS_CACHE_KEY_PREFIX}${scope}`);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Partial<LineSettings>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const saveLineSettingsCache = (settings: LineSettings, scope: string): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(`${CRM_LINE_SETTINGS_CACHE_KEY_PREFIX}${scope}`, JSON.stringify(settings));
  } catch {
    // ignore storage errors.
  }
};

const clearLineSettingsCache = (scope: string): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(`${CRM_LINE_SETTINGS_CACHE_KEY_PREFIX}${scope}`);
  } catch {
    // ignore storage errors.
  }
};

const isContactNotFoundError = (message: string): boolean => /contact not found/i.test(message);
const isTransientFetchError = (message: string): boolean =>
  /failed to fetch|fetch failed|networkerror|network request failed|request failed \(5\d\d\)|internal server error|service unavailable|bad gateway|gateway timeout|upstream|temporarily unavailable|crm 暫時忙碌/i.test(
    message.toLowerCase(),
  );

const areContactListsEqual = (a: CrmContact[], b: CrmContact[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.updatedAt !== right.updatedAt ||
      left.unread !== right.unread ||
      left.lastMessageAt !== right.lastMessageAt
    ) {
      return false;
    }
  }
  return true;
};

const areMessageListsEqual = (a: CrmMessage[], b: CrmMessage[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.timestamp !== right.timestamp ||
      left.text !== right.text ||
      left.direction !== right.direction ||
      left.messageType !== right.messageType
    ) {
      return false;
    }
  }
  return true;
};

const mergeMessagesById = (primary: CrmMessage[], fallback: CrmMessage[]): CrmMessage[] => {
  if (primary.length === 0) {
    return fallback;
  }
  if (fallback.length === 0) {
    return primary;
  }

  const merged = new Map<string, CrmMessage>();
  for (const message of fallback) {
    merged.set(message.id, message);
  }
  for (const message of primary) {
    merged.set(message.id, message);
  }

  return Array.from(merged.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
};

const filterContactsLocal = (
  items: CrmContact[],
  searchText: string,
  tagText: string,
): CrmContact[] => {
  const searchKey = searchText.trim().toLowerCase();
  const tagKey = tagText.trim();
  return items
    .filter((contact) => {
      const hitSearch = !searchKey
        ? true
        : [
            contact.displayName,
            contact.email ?? "",
            contact.phone ?? "",
            contact.lineUserId ?? "",
            ...contact.tags,
          ]
            .join(" ")
            .toLowerCase()
            .includes(searchKey);
      const hitTag = !tagKey ? true : contact.tags.includes(tagKey);
      return hitSearch && hitTag;
    })
    .sort((a, b) => {
      const timeA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const timeB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return timeB - timeA;
    });
};

const loadCrmUiCache = (): CrmUiCache | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(CRM_UI_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<CrmUiCache>;
    if (!Array.isArray(parsed.contacts) || !parsed.messagesByContact) {
      return null;
    }
    return {
      contacts: parsed.contacts as CrmContact[],
      selectedContactId:
        typeof parsed.selectedContactId === "string" || parsed.selectedContactId === null
          ? parsed.selectedContactId
          : null,
      messagesByContact: parsed.messagesByContact as Record<string, CrmMessage[]>,
      cachedAt: typeof parsed.cachedAt === "string" ? parsed.cachedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
};

const saveCrmUiCache = (cache: CrmUiCache): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(CRM_UI_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore quota/permission errors; cache is best-effort only.
  }
};

export const CRMSystem: React.FC = () => {
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState<"inbox" | "settings">("inbox");
  const [showProfile, setShowProfile] = useState(true);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [messages, setMessages] = useState<CrmMessage[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [newTagInput, setNewTagInput] = useState("");
  const [composer, setComposer] = useState("");
  const [profileForm, setProfileForm] = useState<ContactProfileForm>({
    displayName: "",
    phone: "",
    email: "",
  });
  const [profileDirty, setProfileDirty] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [tagBusy, setTagBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [lineSettings, setLineSettings] = useState<LineSettings>({
    connected: false,
    channelId: "",
    hasChannelAccessToken: false,
    hasChannelSecret: false,
    updatedAt: null,
    lastWebhookAt: null,
    lastWebhookEventCount: 0,
    lastWebhookProcessedCount: 0,
    lastWebhookFailedCount: 0,
    lastWebhookError: null,
    webhookUrl: "",
    storageBackend: "file",
  });
  const [lineForm, setLineForm] = useState<LineFormState>({
    channelId: "",
    channelAccessToken: "",
    channelSecret: "",
  });
  const [lineCacheScope, setLineCacheScope] = useState("guest_server");
  const [isInteriorIntakeComplete, setIsInteriorIntakeComplete] = useState(false);
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [addClientForm, setAddClientForm] = useState({ displayName: "", phone: "", email: "", company: "", title: "", address: "", notes: "" });
  const [addClientBusy, setAddClientBusy] = useState(false);
  const [showScanCardModal, setShowScanCardModal] = useState(false);
  const [scanCardImage, setScanCardImage] = useState<string | null>(null);
  const [scanCardBusy, setScanCardBusy] = useState(false);
  const [scanCardResult, setScanCardResult] = useState<typeof addClientForm | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cardFileInputRef = useRef<HTMLInputElement>(null);
  const contactsRef = useRef<CrmContact[]>([]);
  const messagesByContactRef = useRef<Record<string, CrmMessage[]>>({});
  const selectedContactIdRef = useRef<string | null>(null);
  const cacheHydratedRef = useRef(false);
  const profileDraftsRef = useRef<Record<string, ContactProfileForm>>({});
  const profileBoundContactIdRef = useRef<string | null>(null);
  const noticeHistoryRef = useRef<Record<string, number>>({});
  const composerFocusedRef = useRef(false);
  const contactsFetchInFlightRef = useRef(false);
  const messagesFetchInFlightRef = useRef<Record<string, boolean>>({});
  const lastInboxSyncAtRef = useRef(0);
  const lineAutoReconnectAttemptedRef = useRef(false);

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.id === selectedContactId) ?? null,
    [contacts, selectedContactId],
  );

  useEffect(() => {
    setIsInteriorIntakeComplete(false);
  }, [selectedContactId]);

  const pushNotice = useCallback((key: string, message: string) => {
    const now = Date.now();
    const lastAt = noticeHistoryRef.current[key] || 0;
    if (now - lastAt < NOTICE_DEDUP_TTL_MS) {
      return;
    }
    noticeHistoryRef.current[key] = now;
    setNotice(message);
  }, []);

  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  useEffect(() => {
    selectedContactIdRef.current = selectedContactId;
  }, [selectedContactId]);

  useEffect(() => {
    profileDraftsRef.current = loadProfileDraftMap();
  }, []);

  useEffect(() => {
    const sessionUser = session?.user as { id?: string; email?: string | null } | undefined;
    setLineCacheScope(resolveClientUserScopeId(sessionUser?.id || null, sessionUser?.email || null));
  }, [session?.user]);

  useEffect(() => {
    setLineSettings((prev) => ({
      ...prev,
      connected: false,
      channelId: "",
      hasChannelAccessToken: false,
      hasChannelSecret: false,
      updatedAt: null,
      lastWebhookAt: null,
      lastWebhookEventCount: 0,
      lastWebhookProcessedCount: 0,
      lastWebhookFailedCount: 0,
      lastWebhookError: null,
    }));
    setLineForm({
      channelId: "",
      channelAccessToken: "",
      channelSecret: "",
    });

    const cachedSettings = loadLineSettingsCache(lineCacheScope);
    if (cachedSettings && (cachedSettings.channelId || cachedSettings.webhookUrl)) {
      setLineSettings((prev) => ({
        ...prev,
        ...cachedSettings,
      }));
    }

    const cached = loadLineFormCache(lineCacheScope);
    if (!cached.channelId && !cached.channelAccessToken && !cached.channelSecret) {
      return;
    }
    setLineForm((prev) => ({
      channelId: cached.channelId || prev.channelId,
      channelAccessToken: cached.channelAccessToken || prev.channelAccessToken,
      channelSecret: cached.channelSecret || prev.channelSecret,
    }));
    lineAutoReconnectAttemptedRef.current = false;
  }, [lineCacheScope]);

  useEffect(() => {
    saveLineFormCache(lineForm, lineCacheScope);
  }, [lineCacheScope, lineForm]);

  useEffect(() => {
    saveLineSettingsCache(lineSettings, lineCacheScope);
  }, [lineCacheScope, lineSettings]);

  const updateContactInList = useCallback((updated: CrmContact) => {
    setContacts((prev) => prev.map((contact) => (contact.id === updated.id ? updated : contact)));
  }, []);

  useEffect(() => {
    if (cacheHydratedRef.current) {
      return;
    }
    cacheHydratedRef.current = true;
    const cached = loadCrmUiCache();
    if (!cached || cached.contacts.length === 0) {
      return;
    }

    messagesByContactRef.current = cached.messagesByContact;
    setContacts(cached.contacts);

    const nextSelected =
      cached.selectedContactId && cached.contacts.some((item) => item.id === cached.selectedContactId)
        ? cached.selectedContactId
        : cached.contacts[0]?.id ?? null;

    setSelectedContactId(nextSelected);
    if (nextSelected) {
      const cachedMessages = cached.messagesByContact[nextSelected] ?? [];
      if (cachedMessages.length > 0) {
        setMessages(cachedMessages);
      }
    }
  }, []);

  useEffect(() => {
    if (!selectedContact) {
      profileBoundContactIdRef.current = null;
      setProfileForm({ displayName: "", phone: "", email: "" });
      setProfileDirty(false);
      return;
    }

    const sameContactAsBefore = profileBoundContactIdRef.current === selectedContact.id;
    if (sameContactAsBefore && profileDirty) {
      return;
    }

    const baseForm = toContactProfileForm(selectedContact);
    const draftForm = profileDraftsRef.current[selectedContact.id];
    const nextForm = draftForm ?? baseForm;

    profileBoundContactIdRef.current = selectedContact.id;
    setProfileForm(nextForm);
    setProfileDirty(!isSameProfileForm(nextForm, baseForm));
  }, [
    profileDirty,
    selectedContact,
    selectedContact?.displayName,
    selectedContact?.email,
    selectedContact?.id,
    selectedContact?.phone,
  ]);

  const fetchContacts = useCallback(async (options?: { background?: boolean }) => {
    const background = Boolean(options?.background);
    if (background && contactsFetchInFlightRef.current) {
      return;
    }
    contactsFetchInFlightRef.current = true;
    if (!background) {
      setLoadingContacts(true);
      setError(null);
    }
    try {
      const params = new URLSearchParams();
      if (search.trim()) {
        params.set("search", search.trim());
      }
      if (filterTag.trim()) {
        params.set("tag", filterTag.trim());
      }

      const query = params.toString();
      const data = await requestJson<{ contacts: CrmContact[] }>(
        `/api/crm/contacts${query ? `?${query}` : ""}`,
      );
      const previousContacts = contactsRef.current;
      const stickyBackgroundFallback =
        background &&
        previousContacts.length > 0 &&
        data.contacts.length === 0 &&
        !search.trim() &&
        !filterTag.trim();
      const canFallback = previousContacts.length > 0;
      const shouldUseLocalFilteredFallback =
        stickyBackgroundFallback || (data.contacts.length === 0 && canFallback);

      const nextContacts = shouldUseLocalFilteredFallback
        ? stickyBackgroundFallback
          ? previousContacts
          : filterContactsLocal(previousContacts, search, filterTag)
        : data.contacts;

      if (shouldUseLocalFilteredFallback && !background) {
        pushNotice(
          "contacts-cache-fallback",
          search.trim() || filterTag.trim()
            ? "後端暫時回傳空資料，已改用本機快取進行搜尋/篩選。"
            : "偵測到後端暫時回傳空列表，已保留本機快取避免訊息清單跳動。",
        );
      }

      // Remap cached messages when backend contact IDs change
      if (!shouldUseLocalFilteredFallback && previousContacts.length > 0 && nextContacts.length > 0) {
        for (const oldContact of previousContacts) {
          const oldMessages = messagesByContactRef.current[oldContact.id];
          if (!oldMessages?.length) {
            continue;
          }
          if (nextContacts.some((item) => item.id === oldContact.id)) {
            continue;
          }
          const matched =
            (oldContact.lineUserId
              ? nextContacts.find((item) => item.lineUserId === oldContact.lineUserId)
              : undefined) ??
            nextContacts.find((item) => item.displayName === oldContact.displayName);
          if (matched && !messagesByContactRef.current[matched.id]) {
            messagesByContactRef.current[matched.id] = oldMessages;
          }
        }
      }

      setContacts((prev) => (areContactListsEqual(prev, nextContacts) ? prev : nextContacts));
      setSelectedContactId((current) => {
        if (current && nextContacts.some((contact) => contact.id === current)) {
          return current;
        }
        if (current) {
          const oldSelected = previousContacts.find((contact) => contact.id === current);
          if (oldSelected) {
            const matched =
              (oldSelected.lineUserId
                ? nextContacts.find((contact) => contact.lineUserId === oldSelected.lineUserId)
                : undefined) ??
              nextContacts.find((contact) => contact.displayName === oldSelected.displayName);
            if (matched) {
              return matched.id;
            }
          }
        }
        return nextContacts[0]?.id ?? null;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "讀取聯絡人失敗";
      const previousContacts = contactsRef.current;
      if (previousContacts.length > 0 && isTransientFetchError(message)) {
        const fallbackContacts = filterContactsLocal(previousContacts, search, filterTag);
        setContacts((prev) => (areContactListsEqual(prev, fallbackContacts) ? prev : fallbackContacts));
        setSelectedContactId((current) => {
          if (current && fallbackContacts.some((contact) => contact.id === current)) {
            return current;
          }
          return fallbackContacts[0]?.id ?? null;
        });
        if (!background) {
          setError(null);
        }
      } else if (!background) {
        setError(message);
      }
    } finally {
      contactsFetchInFlightRef.current = false;
      if (!background) {
        setLoadingContacts(false);
      }
    }
  }, [filterTag, pushNotice, search]);

  const fetchMessages = useCallback(
    async (contactId: string, markRead: boolean, options?: { background?: boolean }) => {
      const background = Boolean(options?.background);
      if (background && messagesFetchInFlightRef.current[contactId]) {
        return;
      }
      messagesFetchInFlightRef.current[contactId] = true;
      if (!background) {
        setLoadingMessages(true);
      }
      try {
        const params = new URLSearchParams({ contactId });
        if (markRead) {
          params.set("markRead", "1");
        }
        const data = await requestJson<{ messages: CrmMessage[] }>(`/api/crm/messages?${params}`);
        const cachedMessages = messagesByContactRef.current[contactId] ?? [];
        const shouldKeepCachedMessages = data.messages.length === 0 && cachedMessages.length > 0;
        const nextMessages =
          data.messages.length > 0
            ? mergeMessagesById(data.messages, cachedMessages)
            : cachedMessages;

        if (shouldKeepCachedMessages && !background) {
          pushNotice("messages-cache-fallback", "偵測到後端暫時回傳空訊息，已保留本機快取對話內容。");
        }

        messagesByContactRef.current[contactId] = nextMessages.slice(-MAX_CACHE_MESSAGES_PER_CONTACT);
        if (selectedContactIdRef.current === contactId) {
          setMessages((prev) => (areMessageListsEqual(prev, nextMessages) ? prev : nextMessages));
        }
        if (markRead) {
          setContacts((prev) => {
            let changed = false;
            const next = prev.map((contact) => {
              if (contact.id !== contactId || contact.unread === 0) {
                return contact;
              }
              changed = true;
              return { ...contact, unread: 0 };
            });
            return changed ? next : prev;
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "讀取訊息失敗";
        if (isContactNotFoundError(message)) {
          pushNotice("contact-rebind-start", "聯絡人資料已變更，正在重新整理清單。");
          setError(null);
          void (async () => {
            const reboundId = await tryRecoverContact(contactId);
            if (!reboundId) {
              setSelectedContactId((current) => (current === contactId ? null : current));
              if (selectedContactIdRef.current === contactId) {
                setMessages([]);
              }
              void fetchContacts({ background: true });
              return;
            }
            const reboundParams = new URLSearchParams({ contactId: reboundId });
            if (markRead) {
              reboundParams.set("markRead", "1");
            }
            try {
              const reboundData = await requestJson<{ messages: CrmMessage[] }>(
                `/api/crm/messages?${reboundParams}`,
              );
              const nextMessages = reboundData.messages.length
                ? mergeMessagesById(reboundData.messages, messagesByContactRef.current[reboundId] ?? [])
                : messagesByContactRef.current[reboundId] ?? [];
              messagesByContactRef.current[reboundId] = nextMessages.slice(-MAX_CACHE_MESSAGES_PER_CONTACT);
              if (selectedContactIdRef.current === reboundId) {
                setMessages((prev) => (areMessageListsEqual(prev, nextMessages) ? prev : nextMessages));
              }
              pushNotice("contact-rebind-success", "已自動重新綁定相同 LINE 客戶，對話已恢復。");
            } catch (reboundErr) {
              setError(reboundErr instanceof Error ? reboundErr.message : "重新讀取訊息失敗");
            }
          })();
        } else if (isTransientFetchError(message)) {
          const cached = messagesByContactRef.current[contactId] ?? [];
          if (cached.length > 0) {
            if (selectedContactIdRef.current === contactId) {
              setMessages((prev) => (areMessageListsEqual(prev, cached) ? prev : cached));
            }
            // Keep UI stable silently when cache exists.
            if (!background) {
              setError(null);
            }
          } else if (!background) {
            setError(message);
          }
        } else if (!background) {
          setError(message);
        }
      } finally {
        delete messagesFetchInFlightRef.current[contactId];
        if (!background) {
          setLoadingMessages(false);
        }
      }
    },
    [fetchContacts, pushNotice],
  );

  const appendMessageToLocalCache = useCallback((contactId: string, message: CrmMessage) => {
    const previous = messagesByContactRef.current[contactId] ?? [];
    const merged = mergeMessagesById([...previous, message], previous).slice(
      -MAX_CACHE_MESSAGES_PER_CONTACT,
    );
    messagesByContactRef.current[contactId] = merged;
    if (selectedContactIdRef.current === contactId) {
      setMessages((prev) => (areMessageListsEqual(prev, merged) ? prev : merged));
    }
  }, []);

  const fetchLineSettings = useCallback(async () => {
    setSettingsBusy(true);
    try {
      const data = await requestJson<LineSettings>(
        `/api/crm/settings/line?userId=${encodeURIComponent(lineCacheScope)}`,
      );
      setLineSettings(data);
      const cached = loadLineFormCache(lineCacheScope);
      setLineForm((prev) => ({
        ...prev,
        channelId: data.channelId || prev.channelId,
        channelAccessToken: prev.channelAccessToken || cached.channelAccessToken || "",
        channelSecret: prev.channelSecret || cached.channelSecret || "",
      }));

      if (!data.connected && !lineAutoReconnectAttemptedRef.current) {
        const cachedForm = loadLineFormCache(lineCacheScope);
        const autoChannelId = (cachedForm.channelId || data.channelId || "").trim();
        const autoToken = (cachedForm.channelAccessToken || "").trim();
        const autoSecret = (cachedForm.channelSecret || "").trim();
        if (autoChannelId && autoToken && autoSecret) {
          lineAutoReconnectAttemptedRef.current = true;
          try {
            const autoConnected = await requestJson<LineSettings>(
              `/api/crm/settings/line?userId=${encodeURIComponent(lineCacheScope)}`,
              {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                channelId: autoChannelId,
                channelAccessToken: autoToken,
                channelSecret: autoSecret,
              }),
              },
            );
            setLineSettings(autoConnected);
            setLineForm((prev) => ({
              ...prev,
              channelId: autoConnected.channelId || autoChannelId,
              channelAccessToken: prev.channelAccessToken || autoToken,
              channelSecret: prev.channelSecret || autoSecret,
            }));
            pushNotice("line-settings-auto-reconnect", "已自動用既有憑證重連 LINE OA。");
          } catch (autoErr) {
            const autoMessage = autoErr instanceof Error ? autoErr.message : "LINE 自動重連失敗";
            if (!isTransientFetchError(autoMessage)) {
              setError(autoMessage);
            }
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "讀取 LINE 設定失敗";
      const cachedSettings = loadLineSettingsCache(lineCacheScope);
      if (cachedSettings && (cachedSettings.channelId || cachedSettings.webhookUrl)) {
        setLineSettings((prev) => ({
          ...prev,
          ...cachedSettings,
        }));
        pushNotice("line-settings-cache-fallback", "已使用本機快取 LINE 設定。");
        setError(null);
      } else if (isTransientFetchError(message)) {
        pushNotice("line-settings-network", "LINE 設定同步時網路波動，請稍後自動重試。");
        setError(null);
      } else {
        setError(message);
      }
    } finally {
      setSettingsBusy(false);
    }
  }, [lineCacheScope, pushNotice]);

  async function tryRecoverContact(missingContactId: string): Promise<string | null> {
    const previousContacts = contactsRef.current;
    const missing = previousContacts.find((item) => item.id === missingContactId);
    if (!missing) {
      return null;
    }

    try {
      const data = await requestJson<{ contacts: CrmContact[] }>("/api/crm/contacts");
      const nextContacts =
        data.contacts.length === 0 && previousContacts.length > 0
          ? previousContacts
          : data.contacts;
      setContacts(nextContacts);

      const rebound =
        (missing.lineUserId
          ? nextContacts.find((item) => item.lineUserId === missing.lineUserId)
          : undefined) ??
        nextContacts.find((item) => item.displayName === missing.displayName);

      let recovered = rebound;
      if (!recovered) {
        const ensured = await requestJson<{ contact: CrmContact }>("/api/crm/contacts/ensure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: missing.source,
            lineUserId: missing.lineUserId,
            displayName: missing.displayName,
            avatarUrl: missing.avatarUrl,
            email: missing.email,
            phone: missing.phone,
            status: missing.status,
            tags: missing.tags,
          }),
        });
        recovered = ensured.contact;
        setContacts((prev) => {
          const exists = prev.some((item) => item.id === recovered!.id);
          return exists ? prev.map((item) => (item.id === recovered!.id ? recovered! : item)) : [recovered!, ...prev];
        });
      }

      const oldMessages = messagesByContactRef.current[missingContactId];
      if (oldMessages?.length && !messagesByContactRef.current[recovered.id]) {
        messagesByContactRef.current[recovered.id] = oldMessages;
      }
      setSelectedContactId(recovered.id);
      return recovered.id;
    } catch {
      return null;
    }
  }

  const syncInboxNow = useCallback(
    (options?: { force?: boolean }) => {
      const force = Boolean(options?.force);
      const now = Date.now();
      if (!force && now - lastInboxSyncAtRef.current < INBOX_POLL_MS - 300) {
        return;
      }
      lastInboxSyncAtRef.current = now;
      void fetchContacts({ background: true });
      if (selectedContactId && !composerFocusedRef.current) {
        void fetchMessages(selectedContactId, false, { background: true });
      }
    },
    [fetchContacts, fetchMessages, selectedContactId],
  );

  useEffect(() => {
    void fetchContacts();
  }, [fetchContacts]);

  useEffect(() => {
    if (selectedContactId) {
      let cachedMessages = messagesByContactRef.current[selectedContactId];
      const currentContact = contactsRef.current.find((contact) => contact.id === selectedContactId);
      if ((!cachedMessages || cachedMessages.length === 0) && currentContact?.lineUserId) {
        const matchedContactId = contactsRef.current.find(
          (contact) =>
            contact.id !== selectedContactId && contact.lineUserId === currentContact.lineUserId,
        )?.id;
        if (matchedContactId) {
          const reboundMessages = messagesByContactRef.current[matchedContactId];
          if (reboundMessages?.length) {
            messagesByContactRef.current[selectedContactId] = reboundMessages;
            cachedMessages = reboundMessages;
          }
        }
      }

      if (cachedMessages && cachedMessages.length > 0) {
        setMessages((prev) => (areMessageListsEqual(prev, cachedMessages!) ? prev : cachedMessages!));
      }
      void fetchMessages(selectedContactId, true);
    } else {
      setMessages([]);
    }
  }, [selectedContactId]);

  useEffect(() => {
    const trimmedContacts = contacts.slice(0, MAX_CACHE_CONTACTS);
    const allowedIds = new Set(trimmedContacts.map((contact) => contact.id));
    const nextMessagesByContact: Record<string, CrmMessage[]> = {
      ...messagesByContactRef.current,
    };

    if (selectedContactId) {
      nextMessagesByContact[selectedContactId] = messages.slice(-MAX_CACHE_MESSAGES_PER_CONTACT);
    }

    for (const contactId of Object.keys(nextMessagesByContact)) {
      if (!allowedIds.has(contactId)) {
        delete nextMessagesByContact[contactId];
      }
    }
    messagesByContactRef.current = nextMessagesByContact;

    if (trimmedContacts.length === 0 && !selectedContactId) {
      return;
    }

    saveCrmUiCache({
      contacts: trimmedContacts,
      selectedContactId,
      messagesByContact: nextMessagesByContact,
      cachedAt: new Date().toISOString(),
    });
  }, [contacts, messages, selectedContactId]);

  useEffect(() => {
    if (activeTab === "settings") {
      void fetchLineSettings();
    }
  }, [activeTab, fetchLineSettings]);

  useEffect(() => {
    void fetchLineSettings();
  }, [fetchLineSettings]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setLineSettings((prev) =>
      prev.webhookUrl
        ? prev
        : {
            ...prev,
            webhookUrl: `${window.location.origin}/api/line/webhook`,
          },
    );
  }, []);

  useEffect(() => {
    if (activeTab !== "inbox") {
      return;
    }
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      syncInboxNow();
    }, INBOX_POLL_MS);

    return () => clearInterval(timer);
  }, [activeTab, syncInboxNow]);

  useEffect(() => {
    if (activeTab !== "inbox" || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const onForeground = () => {
      if (!document.hidden) {
        syncInboxNow();
      }
    };

    window.addEventListener("focus", onForeground);
    document.addEventListener("visibilitychange", onForeground);
    return () => {
      window.removeEventListener("focus", onForeground);
      document.removeEventListener("visibilitychange", onForeground);
    };
  }, [activeTab, syncInboxNow]);

  const handleSend = async () => {
    if (!selectedContactId || sending) {
      return;
    }
    if (!isInteriorIntakeComplete) {
      setShowProfile(true);
      setError("請先完成「室內設計初訪問卷」，再進行對話回覆。");
      return;
    }
    const text = composer.trim();
    if (!text) {
      return;
    }

    setSending(true);
    setError(null);
    try {
      let effectiveContactId = selectedContactId;
      const send = (contactId: string) =>
        requestJson<{ message: CrmMessage }>("/api/crm/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId, text }),
        });

      let data: { message: CrmMessage };
      try {
        data = await send(effectiveContactId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "發送訊息失敗";
        if (!isContactNotFoundError(message)) {
          throw err;
        }
        const reboundId = await tryRecoverContact(effectiveContactId);
        if (!reboundId) {
          throw err;
        }
        effectiveContactId = reboundId;
        setNotice("已自動重新綁定客戶後重試發送。");
        data = await send(effectiveContactId);
      }

      setComposer("");
      appendMessageToLocalCache(effectiveContactId, data.message);
      await fetchContacts();
      await fetchMessages(effectiveContactId, false);
      const syncedContact = contactsRef.current.find((item) => item.id === effectiveContactId);
      if (syncedContact?.source === "line" && syncedContact.lineUserId) {
        setNotice("已回覆並成功推送至 LINE 客戶。");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "發送訊息失敗");
    } finally {
      setSending(false);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedContactId) {
      return;
    }
    if (!isInteriorIntakeComplete) {
      setShowProfile(true);
      setError("請先完成「室內設計初訪問卷」，再傳送附件。");
      event.target.value = "";
      return;
    }

    setSending(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadResult = await requestJson<{ attachment: CrmAttachment }>("/api/crm/upload", {
        method: "POST",
        body: formData,
      });

      let effectiveContactId = selectedContactId;
      const send = (contactId: string) =>
        requestJson<{ message: CrmMessage }>("/api/crm/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactId,
            text: composer.trim() || undefined,
            attachment: uploadResult.attachment,
          }),
        });

      let sendResult: { message: CrmMessage };
      try {
        sendResult = await send(effectiveContactId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "上傳檔案失敗";
        if (!isContactNotFoundError(message)) {
          throw err;
        }
        const reboundId = await tryRecoverContact(effectiveContactId);
        if (!reboundId) {
          throw err;
        }
        effectiveContactId = reboundId;
        setNotice("已自動重新綁定客戶後重試送出附件。");
        sendResult = await send(effectiveContactId);
      }

      setComposer("");
      appendMessageToLocalCache(effectiveContactId, sendResult.message);
      await fetchContacts();
      await fetchMessages(effectiveContactId, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上傳檔案失敗");
    } finally {
      setSending(false);
      event.target.value = "";
    }
  };

  const handleAddTag = async () => {
    if (!selectedContact || tagBusy) {
      return;
    }
    const trimmedTag = newTagInput.trim();
    if (!trimmedTag) {
      return;
    }
    if (selectedContact.tags.includes(trimmedTag)) {
      setNewTagInput("");
      setNotice("此標籤已存在");
      return;
    }
    let effectiveContactId = selectedContact.id;
    setTagBusy(true);
    setError(null);
    try {
      const addTag = (contactId: string) =>
        requestJson<{ contact: CrmContact }>(
          `/api/crm/contacts/${contactId}/tags?tag=${encodeURIComponent(trimmedTag)}`,
          {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag: trimmedTag }),
          },
        );
      let data: { contact: CrmContact } | null = null;
      try {
        let lastTagError: unknown = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            data = await addTag(effectiveContactId);
            lastTagError = null;
            break;
          } catch (error) {
            lastTagError = error;
            const message = error instanceof Error ? error.message : "新增標籤失敗";
            if (!isTransientFetchError(message) || attempt >= 2) {
              throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
          }
        }
        if (lastTagError) {
          throw lastTagError;
        }
        if (!data) {
          throw new Error("新增標籤失敗");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "新增標籤失敗";
        if (!isContactNotFoundError(message)) {
          throw err;
        }
        const reboundId = await tryRecoverContact(effectiveContactId);
        if (!reboundId) {
          throw err;
        }
        effectiveContactId = reboundId;
        setNotice("已自動重新綁定客戶後重試新增標籤。");
        data = await addTag(effectiveContactId);
      }
      if (!data) {
        throw new Error("新增標籤失敗");
      }
      setNewTagInput("");
      updateContactInList(data.contact);
      setNotice(`已新增標籤：${trimmedTag}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增標籤失敗");
    } finally {
      setTagBusy(false);
    }
  };

  const handleRemoveTag = async (tag: string) => {
    if (!selectedContact) {
      return;
    }
    let effectiveContactId = selectedContact.id;
    try {
      const trimmedTag = tag.trim();
      if (!trimmedTag) {
        return;
      }
      const removeTag = (contactId: string) =>
        requestJson<{ contact: CrmContact }>(
          `/api/crm/contacts/${contactId}/tags?tag=${encodeURIComponent(trimmedTag)}`,
          {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag: trimmedTag }),
          },
        );
      let data: { contact: CrmContact } | null = null;
      try {
        let lastRemoveError: unknown = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            data = await removeTag(effectiveContactId);
            lastRemoveError = null;
            break;
          } catch (error) {
            lastRemoveError = error;
            const message = error instanceof Error ? error.message : "移除標籤失敗";
            if (!isTransientFetchError(message) || attempt >= 2) {
              throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
          }
        }
        if (lastRemoveError) {
          throw lastRemoveError;
        }
        if (!data) {
          throw new Error("移除標籤失敗");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "移除標籤失敗";
        if (!isContactNotFoundError(message)) {
          throw err;
        }
        const reboundId = await tryRecoverContact(effectiveContactId);
        if (!reboundId) {
          throw err;
        }
        effectiveContactId = reboundId;
        setNotice("已自動重新綁定客戶後重試移除標籤。");
        data = await removeTag(effectiveContactId);
      }
      if (!data) {
        throw new Error("移除標籤失敗");
      }
      updateContactInList(data.contact);
    } catch (err) {
      setError(err instanceof Error ? err.message : "移除標籤失敗");
    }
  };

  const handleStatusChange = async (status: ContactStatus) => {
    if (!selectedContact) {
      return;
    }
    let effectiveContactId = selectedContact.id;
    try {
      const changeStatus = (contactId: string) =>
        requestJson<{ contact: CrmContact }>(`/api/crm/contacts/${contactId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
      let data: { contact: CrmContact };
      try {
        data = await changeStatus(effectiveContactId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "更新狀態失敗";
        if (!isContactNotFoundError(message)) {
          throw err;
        }
        const reboundId = await tryRecoverContact(effectiveContactId);
        if (!reboundId) {
          throw err;
        }
        effectiveContactId = reboundId;
        setNotice("已自動重新綁定客戶後重試更新狀態。");
        data = await changeStatus(effectiveContactId);
      }
      updateContactInList(data.contact);
      setNotice("客戶狀態已更新");
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新狀態失敗");
    }
  };

  const handleProfileFieldChange = (field: keyof ContactProfileForm, value: string) => {
    if (!selectedContact) {
      return;
    }
    setProfileForm((prev) => {
      const next: ContactProfileForm = {
        ...prev,
        [field]: value,
      };
      const base = toContactProfileForm(selectedContact);
      const dirty = !isSameProfileForm(next, base);
      setProfileDirty(dirty);
      if (dirty) {
        profileDraftsRef.current[selectedContact.id] = next;
      } else {
        delete profileDraftsRef.current[selectedContact.id];
      }
      saveProfileDraftMap(profileDraftsRef.current);
      return next;
    });
  };

  const handleSaveProfile = async () => {
    if (!selectedContact || profileSaving) {
      return;
    }
    let effectiveContactId = selectedContact.id;
    setProfileSaving(true);
    setError(null);
    try {
      const payload = () => ({
        displayName: profileForm.displayName.trim() || selectedContact.displayName,
        phone: profileForm.phone.trim(),
        email: profileForm.email.trim(),
      });
      const saveProfile = (contactId: string) =>
        requestJson<{ contact: CrmContact }>(`/api/crm/contacts/${contactId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload()),
        });
      let data: { contact: CrmContact };
      try {
        data = await saveProfile(effectiveContactId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "儲存聯絡資訊失敗";
        if (!isContactNotFoundError(message)) {
          throw err;
        }
        const reboundId = await tryRecoverContact(effectiveContactId);
        if (!reboundId) {
          throw err;
        }
        effectiveContactId = reboundId;
        setNotice("已自動重新綁定客戶後重試儲存聯絡資訊。");
        data = await saveProfile(effectiveContactId);
      }
      updateContactInList(data.contact);
      const nextForm = toContactProfileForm(data.contact);
      setProfileForm(nextForm);
      setProfileDirty(false);
      delete profileDraftsRef.current[effectiveContactId];
      saveProfileDraftMap(profileDraftsRef.current);
      setNotice("聯絡資訊已儲存");
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存聯絡資訊失敗");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSaveLineSettings = async () => {
    setSettingsBusy(true);
    setError(null);
    try {
      const data = await requestJson<LineSettings>(
        `/api/crm/settings/line?userId=${encodeURIComponent(lineCacheScope)}`,
        {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lineForm),
        },
      );
      setLineSettings(data);
      setLineForm((prev) => ({
        ...prev,
        channelId: data.channelId,
      }));
      setNotice("LINE OA 設定已儲存（此瀏覽器已暫存憑證，避免重填）");
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存 LINE 設定失敗");
    } finally {
      setSettingsBusy(false);
    }
  };

  const handleDisconnectLine = async () => {
    setSettingsBusy(true);
    setError(null);
    try {
      const data = await requestJson<LineSettings>(
        `/api/crm/settings/line?userId=${encodeURIComponent(lineCacheScope)}`,
        {
        method: "DELETE",
        },
      );
      setLineSettings(data);
      setLineForm({
        channelId: "",
        channelAccessToken: "",
        channelSecret: "",
      });
      clearLineFormCache(lineCacheScope);
      clearLineSettingsCache(lineCacheScope);
      setNotice("已解除 LINE OA 串接");
    } catch (err) {
      setError(err instanceof Error ? err.message : "解除 LINE 串接失敗");
    } finally {
      setSettingsBusy(false);
    }
  };

  const copyWebhookUrl = async () => {
    if (!lineSettings.webhookUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(lineSettings.webhookUrl);
      setNotice("Webhook URL 已複製");
    } catch {
      setError("無法複製 Webhook URL");
    }
  };

  const renderAttachment = (message: CrmMessage) => {
    const attachment = message.attachment;
    if (!attachment) {
      return null;
    }

    const sourceUrl = attachment.url || attachment.dataUrl;
    if (attachment.type === "image" && sourceUrl) {
      return (
        <a href={sourceUrl} target="_blank" rel="noreferrer" className="block mt-2">
          <img
            src={sourceUrl}
            alt={attachment.name ?? "image"}
            className="max-h-56 rounded-lg border border-gray-200 object-contain"
          />
        </a>
      );
    }

    if (sourceUrl) {
      return (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
        >
          <LinkIcon className="h-3.5 w-3.5" />
          {attachment.name || "下載附件"}
        </a>
      );
    }

    return (
      <p className="mt-2 text-xs text-gray-500">
        已收到附件：{attachment.name || "未命名檔案"}（目前僅保存 metadata）
      </p>
    );
  };

  // 新增客戶
  const handleCreateClient = async () => {
    if (!addClientForm.displayName.trim()) return;
    setAddClientBusy(true);
    try {
      await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addClientForm),
      });
      setShowAddClientModal(false);
      setAddClientForm({ displayName: "", phone: "", email: "", company: "", title: "", address: "", notes: "" });
      void fetchContacts();
      pushNotice("client-created", "客戶已建立");
    } catch {
      setError("建立客戶失敗");
    } finally {
      setAddClientBusy(false);
    }
  };

  // 名片掃描：上傳圖片
  const handleCardFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setScanCardImage(reader.result as string);
      setScanCardResult(null);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // 名片掃描：AI 辨識
  const handleScanCard = async () => {
    if (!scanCardImage) return;
    setScanCardBusy(true);
    try {
      const res = await fetch("/api/ai/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: scanCardImage,
          roomType: "全室整合",
          style: "名片辨識",
          customPrompt:
            "這是一張名片照片。請辨識名片上的所有資訊，以 JSON 格式輸出：" +
            'CARD_JSON:{"displayName":"姓名","company":"公司名稱","title":"職稱","phone":"電話","email":"電子信箱","address":"地址"}' +
            "\n所有欄位使用繁體中文，找不到的欄位留空字串。",
          creativity: 5,
        }),
      });
      const raw = await res.text();
      const payload = raw ? (JSON.parse(raw) as { summary?: string }) : {};
      const match = payload.summary?.match(/CARD_JSON:\s*(\{[^}]*\})/);
      if (match) {
        const parsed = JSON.parse(match[1]) as Record<string, string>;
        setScanCardResult({
          displayName: parsed.displayName || "",
          phone: parsed.phone || "",
          email: parsed.email || "",
          company: parsed.company || "",
          title: parsed.title || "",
          address: parsed.address || "",
          notes: "",
        });
      } else {
        setError("無法辨識名片內容，請手動輸入");
      }
    } catch {
      setError("名片辨識失敗");
    } finally {
      setScanCardBusy(false);
    }
  };

  // 名片辨識結果 → 建立客戶
  const handleCreateFromCard = async () => {
    if (!scanCardResult?.displayName?.trim()) return;
    setAddClientBusy(true);
    try {
      await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scanCardResult),
      });
      setShowScanCardModal(false);
      setScanCardImage(null);
      setScanCardResult(null);
      void fetchContacts();
      pushNotice("card-client-created", `已從名片建立客戶：${scanCardResult.displayName}`);
    } catch {
      setError("建立客戶失敗");
    } finally {
      setAddClientBusy(false);
    }
  };

  const renderInbox = () => (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex w-80 flex-col border-r border-gray-200 bg-white">
        <div className="border-b border-gray-100 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜尋客戶、電話、標籤"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:bg-white focus:outline-none"
            />
          </div>
          <input
            value={filterTag}
            onChange={(event) => setFilterTag(event.target.value)}
            placeholder="標籤篩選 (例如：高預算)"
            className="mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs focus:border-brand-500 focus:bg-white focus:outline-none"
          />
        </div>

        <div className="custom-scrollbar flex-1 overflow-y-auto">
          {loadingContacts && (
            <p className="px-4 py-3 text-xs text-gray-500">載入聯絡人中...</p>
          )}
          {!loadingContacts && (
            <div className="flex gap-1.5 px-4 py-2 border-b border-gray-100">
              <button onClick={() => setShowAddClientModal(true)} className="flex-1 py-1.5 text-[11px] font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors">
                + 新增客戶
              </button>
              <button onClick={() => { setShowScanCardModal(true); setScanCardImage(null); setScanCardResult(null); }} className="flex-1 py-1.5 text-[11px] font-medium border border-brand-300 text-brand-700 rounded-lg hover:bg-brand-50 transition-colors">
                掃描名片
              </button>
              <input ref={cardFileInputRef} type="file" accept="image/*" onChange={handleCardFileChange} className="hidden" />
            </div>
          )}
          {!loadingContacts && contacts.length === 0 && (
            <p className="px-4 py-6 text-sm text-gray-500">目前沒有客戶資料，可點擊「新增客戶」或「掃描名片」建立。</p>
          )}
          {contacts.map((contact) => (
            <button
              key={contact.id}
              onClick={() => setSelectedContactId(contact.id)}
              className={`w-full border-l-4 p-4 text-left transition-colors ${
                selectedContactId === contact.id
                  ? "border-l-brand-600 bg-brand-50"
                  : "border-l-transparent hover:bg-gray-50"
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className={`text-sm ${contact.unread ? "font-bold" : "font-medium"}`}>
                  {contact.displayName}
                </span>
                <span className="text-[11px] text-gray-500">{formatTime(contact.lastMessageAt)}</span>
              </div>
              <p className="line-clamp-1 text-xs text-gray-600">
                {contact.lastMessageText || "尚無訊息"}
              </p>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex gap-1">
                  {contact.tags.slice(0, 2).map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  {contact.source === "line" && <Smartphone className="h-3.5 w-3.5 text-green-600" />}
                  {contact.unread > 0 && (
                    <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {contact.unread}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col bg-gray-50/40">
        {!selectedContact ? (
          <div className="flex flex-1 items-center justify-center text-gray-400">
            <div className="text-center">
              <MessageCircle className="mx-auto mb-2 h-12 w-12 opacity-40" />
              <p>請先選擇一位客戶</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
              <div className="flex items-center gap-3">
                {selectedContact.avatarUrl ? (
                  <img
                    src={selectedContact.avatarUrl}
                    alt={selectedContact.displayName}
                    className="h-10 w-10 rounded-full border border-gray-200 object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500 text-sm font-bold text-white">
                    {getAvatarInitial(selectedContact.displayName)}
                  </div>
                )}
                <div>
                  <h3 className="font-semibold text-gray-900">{selectedContact.displayName}</h3>
                  <p className="text-xs text-gray-500">
                    {selectedContact.source === "line" ? "LINE Official Account" : "手動建立聯絡人"}
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowProfile((value) => !value)}>
                {showProfile ? <X className="h-5 w-5" /> : <Settings className="h-5 w-5" />}
              </Button>
            </div>

            <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto p-5">
              {loadingMessages && <p className="text-xs text-gray-500">載入訊息中...</p>}
              {!loadingMessages && messages.length === 0 && (
                <p className="text-sm text-gray-500">目前沒有訊息，等待 webhook 或手動發送。</p>
              )}
              {messages.map((message) => {
                const mine = message.direction === "outbound";
                return (
                  <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[78%] rounded-2xl border px-3 py-2 text-sm shadow-sm ${
                        mine
                          ? "rounded-tr-none border-brand-600 bg-brand-600 text-white"
                          : "rounded-tl-none border-gray-200 bg-white text-gray-800"
                      }`}
                    >
                      {message.text && <p className="whitespace-pre-wrap">{message.text}</p>}
                      {renderAttachment(message)}
                      {!message.text && !message.attachment && <p>{getMessagePreview(message)}</p>}
                      <p className={`mt-1 text-[10px] ${mine ? "text-brand-100" : "text-gray-400"}`}>
                        {formatTime(message.timestamp)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-gray-200 bg-white p-4">
              {!isInteriorIntakeComplete && (
                <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  此客戶尚未完成「室內設計初訪問卷」，請先於右側填答後再回覆訊息。
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleUpload}
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt,.mp4,.mp3,.wav"
              />
              <div className="flex items-end gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!isInteriorIntakeComplete}
                  className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                  title="上傳圖片或檔案"
                >
                  <Paperclip className="h-5 w-5" />
                </button>
                <textarea
                  rows={2}
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  disabled={!isInteriorIntakeComplete}
                  onFocus={() => {
                    composerFocusedRef.current = true;
                  }}
                  onBlur={() => {
                    composerFocusedRef.current = false;
                  }}
                  placeholder="輸入訊息（可直接推送到 LINE）"
                  className="max-h-36 min-h-[42px] flex-1 resize-y rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-brand-500 focus:bg-white focus:outline-none"
                />
                <Button
                  className="h-[42px] rounded-xl px-4"
                  onClick={handleSend}
                  disabled={!composer.trim() || sending || !isInteriorIntakeComplete}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {showProfile && selectedContact && (
        <aside className="custom-scrollbar hidden w-80 shrink-0 overflow-y-auto border-l border-gray-200 bg-white xl:block">
          <div className="border-b border-gray-100 p-6 text-center">
            {selectedContact.avatarUrl ? (
              <img
                src={selectedContact.avatarUrl}
                alt={selectedContact.displayName}
                className="mx-auto h-20 w-20 rounded-full border border-gray-200 object-cover"
              />
            ) : (
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-500 text-2xl font-bold text-white">
                {getAvatarInitial(selectedContact.displayName)}
              </div>
            )}
            <h3 className="mt-3 text-lg font-bold text-gray-900">{selectedContact.displayName}</h3>
            <p className="mt-1 text-xs text-gray-500">
              LINE User ID: {selectedContact.lineUserId || "未提供"}
            </p>
          </div>

          <div className="space-y-6 p-6">
            <div>
              <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500">
                <Tag className="h-3 w-3" />
                客戶標籤
              </h4>
              <div className="mb-2 flex flex-wrap gap-2">
                {selectedContact.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-md border border-brand-100 bg-brand-50 px-2 py-1 text-xs text-brand-700"
                  >
                    {tag}
                    <button onClick={() => void handleRemoveTag(tag)} className="hover:text-brand-900">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={newTagInput}
                  onChange={(event) => setNewTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void handleAddTag();
                    }
                  }}
                  placeholder="新增標籤"
                  className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:border-brand-500 focus:outline-none"
                />
                <Button size="sm" onClick={handleAddTag} disabled={tagBusy || !newTagInput.trim()}>
                  {tagBusy ? "新增中..." : "新增"}
                </Button>
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">聯絡資訊</h4>
              <div className="space-y-3 text-sm">
                <div>
                  <label className="mb-1 block text-[11px] text-gray-500">名稱</label>
                  <input
                    value={profileForm.displayName}
                    onChange={(event) => handleProfileFieldChange("displayName", event.target.value)}
                    className="w-full rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs focus:border-brand-500 focus:bg-white focus:outline-none"
                    placeholder="客戶名稱"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-gray-500">電話</label>
                  <input
                    value={profileForm.phone}
                    onChange={(event) => handleProfileFieldChange("phone", event.target.value)}
                    className="w-full rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs focus:border-brand-500 focus:bg-white focus:outline-none"
                    placeholder="09xx-xxx-xxx"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-gray-500">信箱</label>
                  <input
                    value={profileForm.email}
                    onChange={(event) => handleProfileFieldChange("email", event.target.value)}
                    className="w-full rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs focus:border-brand-500 focus:bg-white focus:outline-none"
                    placeholder="name@example.com"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">狀態</span>
                  <select
                    value={selectedContact.status}
                    onChange={(event) => void handleStatusChange(event.target.value as ContactStatus)}
                    className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs focus:border-brand-500 focus:outline-none"
                  >
                    <option value="new">{STATUS_LABELS.new}</option>
                    <option value="contacted">{STATUS_LABELS.contacted}</option>
                    <option value="proposal">{STATUS_LABELS.proposal}</option>
                    <option value="signed">{STATUS_LABELS.signed}</option>
                  </select>
                </div>
                <Button
                  size="sm"
                  onClick={() => void handleSaveProfile()}
                  disabled={!profileDirty || profileSaving}
                >
                  {profileSaving ? "儲存中..." : profileDirty ? "儲存聯絡資訊" : "已儲存"}
                </Button>
                {profileDirty && (
                  <p className="text-[11px] text-amber-700">
                    已暫存草稿（若切換頁面回來，可繼續編輯後再按儲存）。
                  </p>
                )}
              </div>
            </div>

            <CrmInteriorIntakePanel
              selectedContact={{
                id: selectedContact.id,
                displayName: selectedContact.displayName,
                tags: selectedContact.tags,
                status: selectedContact.status,
              }}
              userScopeId={lineCacheScope}
              conversationMessages={messages.map((item) => ({
                direction: item.direction,
                text: item.text,
                timestamp: item.timestamp,
              }))}
              onCompletionChange={setIsInteriorIntakeComplete}
            />
          </div>
        </aside>
      )}
    </div>
  );

  const renderSettings = () => (
    <div className="custom-scrollbar flex-1 overflow-y-auto bg-gray-50 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">LINE OA 串接設定</h2>
            <p className="text-sm text-gray-500">
              設定後可接收頭貼、訊息、圖片與檔案並保存於 CRM。
            </p>
          </div>
          <Button variant="outline" onClick={() => setActiveTab("inbox")}>
            返回訊息中心
          </Button>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#00B900] text-white">
                <Smartphone className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">LINE Official Account</h3>
                <p className="text-xs text-gray-500">接收訊息與附件、同步客戶頭貼</p>
              </div>
            </div>
            {lineSettings.connected ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                <CheckCircle className="h-3 w-3" />
                已連線
              </span>
            ) : (
              <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500">未連線</span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Channel ID</label>
              <input
                value={lineForm.channelId}
                onChange={(event) =>
                  setLineForm((prev) => ({ ...prev, channelId: event.target.value }))
                }
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-brand-500 focus:bg-white focus:outline-none"
                placeholder="例如：2001234567"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Webhook URL</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={lineSettings.webhookUrl}
                  className="w-full rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-xs text-gray-600"
                />
                <Button variant="outline" size="sm" onClick={copyWebhookUrl}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Channel Access Token
              </label>
              <input
                type="password"
                value={lineForm.channelAccessToken}
                onChange={(event) =>
                  setLineForm((prev) => ({ ...prev, channelAccessToken: event.target.value }))
                }
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-brand-500 focus:bg-white focus:outline-none"
                placeholder={
                  lineSettings.hasChannelAccessToken ? "已設定，若不修改可留空" : "輸入長效 Token"
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Channel Secret</label>
              <input
                type="password"
                value={lineForm.channelSecret}
                onChange={(event) =>
                  setLineForm((prev) => ({ ...prev, channelSecret: event.target.value }))
                }
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-brand-500 focus:bg-white focus:outline-none"
                placeholder={lineSettings.hasChannelSecret ? "已設定，若不修改可留空" : "輸入 Secret"}
              />
            </div>
          </div>

          <p className="mt-2 text-[11px] text-gray-500">
            為減少重複輸入，憑證會暫存於目前瀏覽器 localStorage；若為公用電腦請避免啟用此功能並於使用後解除串接。
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={handleSaveLineSettings} disabled={settingsBusy}>
              儲存並驗證 LINE 設定
            </Button>
            {lineSettings.connected && (
              <Button variant="outline" onClick={handleDisconnectLine} disabled={settingsBusy}>
                解除 LINE 串接
              </Button>
            )}
            <Button variant="ghost" onClick={() => void fetchLineSettings()} disabled={settingsBusy}>
              重新讀取狀態
            </Button>
          </div>

          <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
            <p className="font-semibold text-gray-700">LINE Developers 設定步驟</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>進入 Messaging API，將上方 Webhook URL 貼上並啟用 Webhook。</li>
              <li>關閉「Use webhook」前請先完成 Channel Secret / Access Token 設定。</li>
              <li>按 Verify 成功只代表 Webhook 可達，還需要用真實 LINE 帳號傳訊息測試。</li>
              <li>成功後，客戶訊息與附件會進入 CRM，資料可用於後續分析模組。</li>
            </ol>
            <p className="mt-2">
              最近更新：{lineSettings.updatedAt ? formatTime(lineSettings.updatedAt) : "尚未設定"}
            </p>
            <p className="mt-1">
              最近 Webhook：{lineSettings.lastWebhookAt ? formatTime(lineSettings.lastWebhookAt) : "尚未收到事件"}
            </p>
            <p className="mt-1">
              最近事件統計：收到 {lineSettings.lastWebhookEventCount} / 成功{" "}
              {lineSettings.lastWebhookProcessedCount} / 失敗 {lineSettings.lastWebhookFailedCount}
            </p>
            {lineSettings.lastWebhookError && (
              <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700">
                最近 Webhook 錯誤：{lineSettings.lastWebhookError}
              </p>
            )}
            <p className="mt-1">
              目前儲存後端：{lineSettings.storageBackend === "redis" ? "Redis (持久化)" : "File (非持久化)"}
            </p>
            {lineSettings.connected && !lineSettings.lastWebhookAt && (
              <p className="mt-2 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700">
                目前已連線但尚未收到任何 Webhook 事件。請用「已加好友的 LINE 個人帳號」直接傳文字給 OA
                測試，並確認 LINE Developers 的 Webhook URL 使用正式網域（避免使用會變動的 preview 網域）。
              </p>
            )}
            {lineSettings.storageBackend !== "redis" && (
              <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                建議在 Vercel 加入 Redis/Upstash Integration，否則資料可能因 Serverless 實例切換而無法穩定顯示。
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative flex h-[calc(100vh-8rem)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex w-16 shrink-0 flex-col items-center gap-4 bg-gray-900 py-4">
        <button
          onClick={() => setActiveTab("inbox")}
          className={`rounded-xl p-3 transition-colors ${
            activeTab === "inbox"
              ? "bg-brand-600 text-white shadow-lg"
              : "text-gray-400 hover:bg-gray-800 hover:text-white"
          }`}
          title="訊息中心"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
        <button
          onClick={() => setActiveTab("settings")}
          className={`rounded-xl p-3 transition-colors ${
            activeTab === "settings"
              ? "bg-brand-600 text-white shadow-lg"
              : "text-gray-400 hover:bg-gray-800 hover:text-white"
          }`}
          title="LINE 設定"
        >
          <Settings className="h-6 w-6" />
        </button>
      </div>

      {activeTab === "inbox" ? renderInbox() : renderSettings()}

      {error && (
        <div className="absolute bottom-4 left-20 right-4 z-10">
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        </div>
      )}
      {/* 新增客戶 Modal */}
      {showAddClientModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowAddClientModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">新增客戶</h3>
              <button onClick={() => setShowAddClientModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {[
              { key: "displayName", label: "姓名 *", placeholder: "王大明" },
              { key: "company", label: "公司", placeholder: "設計有限公司" },
              { key: "title", label: "職稱", placeholder: "總經理" },
              { key: "phone", label: "電話", placeholder: "0912-345-678" },
              { key: "email", label: "Email", placeholder: "client@example.com" },
              { key: "address", label: "地址", placeholder: "台北市信義區..." },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="text-xs font-medium text-gray-600">{label}</label>
                <input
                  value={(addClientForm as Record<string, string>)[key] || ""}
                  onChange={(e) => setAddClientForm((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full mt-0.5 text-sm border-gray-300 rounded-lg p-2 bg-white border"
                />
              </div>
            ))}
            <div>
              <label className="text-xs font-medium text-gray-600">備註</label>
              <textarea
                value={addClientForm.notes}
                onChange={(e) => setAddClientForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="客戶需求、偏好..."
                className="w-full mt-0.5 text-sm border-gray-300 rounded-lg p-2 bg-white border h-16 resize-none"
              />
            </div>
            <button
              onClick={() => void handleCreateClient()}
              disabled={!addClientForm.displayName.trim() || addClientBusy}
              className="w-full py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {addClientBusy ? "建立中..." : "建立客戶"}
            </button>
          </div>
        </div>
      )}

      {/* 掃描名片 Modal */}
      {showScanCardModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowScanCardModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">掃描名片</h3>
              <button onClick={() => setShowScanCardModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            {!scanCardImage ? (
              <div
                onClick={() => cardFileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:bg-brand-50 hover:border-brand-300 cursor-pointer transition-colors"
              >
                <Smartphone className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-600 font-medium">點擊上傳名片照片</p>
                <p className="text-xs text-gray-400 mt-1">支援 JPG / PNG，拍攝清晰的名片正面</p>
              </div>
            ) : (
              <div className="space-y-3">
                <img src={scanCardImage} alt="名片" className="w-full rounded-lg border border-gray-200 max-h-48 object-contain" />
                {!scanCardResult && (
                  <button
                    onClick={() => void handleScanCard()}
                    disabled={scanCardBusy}
                    className="w-full py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {scanCardBusy ? (
                      <><Search className="w-4 h-4 animate-spin" /> AI 辨識中...</>
                    ) : (
                      <><Search className="w-4 h-4" /> AI 辨識名片</>
                    )}
                  </button>
                )}
                {scanCardResult && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-green-600">辨識完成，請確認並修改：</p>
                    {[
                      { key: "displayName", label: "姓名" },
                      { key: "company", label: "公司" },
                      { key: "title", label: "職稱" },
                      { key: "phone", label: "電話" },
                      { key: "email", label: "Email" },
                      { key: "address", label: "地址" },
                    ].map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-2">
                        <label className="text-[11px] text-gray-500 w-10 shrink-0">{label}</label>
                        <input
                          value={(scanCardResult as Record<string, string>)[key] || ""}
                          onChange={(e) => setScanCardResult((prev) => prev ? { ...prev, [key]: e.target.value } : prev)}
                          className="flex-1 text-xs border-gray-200 rounded-md p-1.5 bg-white border"
                        />
                      </div>
                    ))}
                    <button
                      onClick={() => void handleCreateFromCard()}
                      disabled={addClientBusy || !scanCardResult.displayName.trim()}
                      className="w-full py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                    >
                      {addClientBusy ? "建立中..." : "確認建立客戶"}
                    </button>
                  </div>
                )}
                <button
                  onClick={() => { setScanCardImage(null); setScanCardResult(null); }}
                  className="w-full py-1.5 text-xs text-gray-500 hover:text-gray-700"
                >
                  重新上傳
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
