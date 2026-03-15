import sharp from "sharp";

const MAX_OUTPUT_EDGE = 4096;

interface ParsedDataUrl {
  mimeType: string;
  buffer: Buffer;
}

export interface UpscaleInput {
  imageDataUrl: string;
  scale?: number;
}

export interface UpscaleResult {
  imageDataUrl: string;
  width: number;
  height: number;
  scaleApplied: number;
  format: "jpeg" | "png" | "webp";
}

const parseDataUrl = (imageDataUrl: string): ParsedDataUrl => {
  const match = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("無效的圖片資料格式，請重新上傳圖片。");
  }
  const [, mimeType, base64Data] = match;
  return {
    mimeType,
    buffer: Buffer.from(base64Data, "base64"),
  };
};

const normalizeScale = (scale?: number): number => {
  if (typeof scale !== "number" || Number.isNaN(scale)) {
    return 2;
  }
  return Math.min(4, Math.max(1, scale));
};

const resolveOutputFormat = (mimeType: string): "jpeg" | "png" | "webp" => {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    return "jpeg";
  }
  if (mimeType.includes("webp")) {
    return "webp";
  }
  return "png";
};

const mimeFromFormat = (format: "jpeg" | "png" | "webp"): string => {
  if (format === "jpeg") {
    return "image/jpeg";
  }
  if (format === "webp") {
    return "image/webp";
  }
  return "image/png";
};

export async function upscaleImage(input: UpscaleInput): Promise<UpscaleResult> {
  const { mimeType, buffer } = parseDataUrl(input.imageDataUrl);
  const scale = normalizeScale(input.scale);

  const base = sharp(buffer, { failOn: "none" });
  const metadata = await base.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("無法解析圖片尺寸，請更換圖片後再試。");
  }

  const targetWidth = Math.min(MAX_OUTPUT_EDGE, Math.round(metadata.width * scale));
  const targetHeight = Math.min(MAX_OUTPUT_EDGE, Math.round(metadata.height * scale));

  let pipeline = sharp(buffer, { failOn: "none" })
    .resize(targetWidth, targetHeight, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
    })
    .sharpen({
      sigma: 1.25,
      m1: 1.2,
      m2: 2.2,
    });

  const format = resolveOutputFormat(mimeType);
  if (format === "jpeg") {
    pipeline = pipeline.jpeg({
      quality: 95,
      chromaSubsampling: "4:4:4",
      mozjpeg: true,
    });
  } else if (format === "webp") {
    pipeline = pipeline.webp({
      quality: 95,
    });
  } else {
    pipeline = pipeline.png({
      compressionLevel: 9,
      adaptiveFiltering: true,
    });
  }

  const outputBuffer = await pipeline.toBuffer();
  const outputMime = mimeFromFormat(format);
  const resultDataUrl = `data:${outputMime};base64,${outputBuffer.toString("base64")}`;

  return {
    imageDataUrl: resultDataUrl,
    width: targetWidth,
    height: targetHeight,
    scaleApplied: scale,
    format,
  };
}
