import path from "path";
import { promises as fs } from "fs";
import { createId } from "@/lib/crm/store";
import { AttachmentType, CrmAttachment } from "@/lib/crm/types";

const UPLOAD_DIR = path.join(process.cwd(), "public", "crm-uploads");
const INLINE_SIZE_LIMIT = 6 * 1024 * 1024;

const extensionMap: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "application/zip": ".zip",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "video/mp4": ".mp4",
};

const guessAttachmentType = (mimeType?: string, fileName?: string): AttachmentType => {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) {
    return "image";
  }
  if (mime.startsWith("audio/")) {
    return "audio";
  }
  if (mime.startsWith("video/")) {
    return "video";
  }

  const lowerName = (fileName ?? "").toLowerCase();
  if (/\.(png|jpg|jpeg|gif|webp)$/.test(lowerName)) {
    return "image";
  }
  if (/\.(mp3|wav|m4a|aac)$/.test(lowerName)) {
    return "audio";
  }
  if (/\.(mp4|mov|avi)$/.test(lowerName)) {
    return "video";
  }
  return "file";
};

const guessExtension = (mimeType?: string, fileName?: string): string => {
  if (fileName) {
    const ext = path.extname(fileName);
    if (ext) {
      return ext;
    }
  }
  if (!mimeType) {
    return ".bin";
  }
  return extensionMap[mimeType.toLowerCase()] ?? ".bin";
};

const sanitizeFileName = (fileName: string): string =>
  fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);

export interface SaveAttachmentInput {
  buffer: Buffer;
  fileName?: string;
  mimeType?: string;
  lineMessageId?: string;
}

export async function saveAttachment(input: SaveAttachmentInput): Promise<CrmAttachment> {
  const attachmentType = guessAttachmentType(input.mimeType, input.fileName);
  const attachmentId = createId("att");
  const guessedExt = guessExtension(input.mimeType, input.fileName);
  const baseName = input.fileName
    ? sanitizeFileName(input.fileName.replace(path.extname(input.fileName), ""))
    : `upload_${Date.now()}`;
  const outputFileName = `${baseName}_${attachmentId}${guessedExt}`;

  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const fullPath = path.join(UPLOAD_DIR, outputFileName);
    await fs.writeFile(fullPath, input.buffer);

    return {
      id: attachmentId,
      type: attachmentType,
      storage: "public_url",
      name: input.fileName ?? outputFileName,
      mimeType: input.mimeType ?? "application/octet-stream",
      size: input.buffer.length,
      url: `/crm-uploads/${outputFileName}`,
      lineMessageId: input.lineMessageId,
    };
  } catch {
    if (input.buffer.length <= INLINE_SIZE_LIMIT) {
      return {
        id: attachmentId,
        type: attachmentType,
        storage: "inline_base64",
        name: input.fileName ?? outputFileName,
        mimeType: input.mimeType ?? "application/octet-stream",
        size: input.buffer.length,
        base64Data: input.buffer.toString("base64"),
        lineMessageId: input.lineMessageId,
      };
    }

    return {
      id: attachmentId,
      type: attachmentType,
      storage: "metadata_only",
      name: input.fileName ?? outputFileName,
      mimeType: input.mimeType ?? "application/octet-stream",
      size: input.buffer.length,
      lineMessageId: input.lineMessageId,
    };
  }
}
