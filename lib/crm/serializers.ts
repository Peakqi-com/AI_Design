import { CrmAttachment, CrmMessage } from "@/lib/crm/types";

export interface ClientAttachment extends Omit<CrmAttachment, "base64Data"> {
  dataUrl?: string;
}

export interface ClientMessage extends Omit<CrmMessage, "attachment"> {
  attachment?: ClientAttachment;
}

export const toClientAttachment = (attachment?: CrmAttachment): ClientAttachment | undefined => {
  if (!attachment) {
    return undefined;
  }

  if (attachment.storage === "inline_base64" && attachment.base64Data) {
    const mime = attachment.mimeType ?? "application/octet-stream";
    return {
      ...attachment,
      dataUrl: `data:${mime};base64,${attachment.base64Data}`,
    };
  }

  const { base64Data: _unused, ...rest } = attachment;
  return rest;
};

export const toClientMessage = (message: CrmMessage): ClientMessage => ({
  ...message,
  attachment: toClientAttachment(message.attachment),
});
