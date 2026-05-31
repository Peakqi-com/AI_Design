/**
 * Presentation export — rasterize HTML slides (rendered by SlideCanvas) into
 * a high-resolution PPTX or PDF. Each slide becomes a full-bleed 16:9 image,
 * preserving the exact Gamma-grade design from the browser.
 *
 * Performance notes (why the naive version hung):
 *  - html-to-image re-embeds ALL web fonts on every toPng() call. With many
 *    slides that means downloading the whole font set N times. We compute the
 *    font-embed CSS ONCE and pass it to every call via `fontEmbedCSS`.
 *  - `cacheBust` forces re-download of every image each call — removed.
 *  - Cross-origin images (e.g. unsplash covers) can stall the internal fetch
 *    forever. We pre-convert every <img> in the stage to a same-origin data URL
 *    first, with a per-image timeout, so rasterization never blocks on network.
 */

import { toPng, getFontEmbedCSS } from "html-to-image";

const SLIDE_W = 1280;
const SLIDE_H = 720;
const SCALE = 2; // 2x → 2560×1440 per slide (crisp)

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);

/** Fetch an image URL and return a data URL; resolves to "" on failure/timeout. */
async function urlToDataUrl(url: string): Promise<string> {
  if (!url || url.startsWith("data:")) return url;
  try {
    const res = await withTimeout(
      fetch(url, { mode: "cors" }),
      8000,
      null as unknown as Response,
    );
    if (!res || !res.ok) return "";
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string) || "");
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  } catch {
    return "";
  }
}

/**
 * Replace every <img> src in the export stage with an inlined data URL so
 * html-to-image never has to fetch over the network during rasterization.
 * Returns a restore function (no-op here; the stage is offscreen & disposable).
 */
export async function inlineStageImages(stage: HTMLElement): Promise<void> {
  const imgs = Array.from(stage.querySelectorAll("img"));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("src") || "";
      if (!src || src.startsWith("data:")) return;
      const dataUrl = await urlToDataUrl(src);
      if (dataUrl) {
        img.setAttribute("src", dataUrl);
      }
      // remove crossOrigin so the now-same-origin data URL paints cleanly
      img.removeAttribute("crossorigin");
    }),
  );
}

/** Rasterize one mounted slide node to a PNG data URL (fonts pre-embedded). */
export async function rasterizeSlide(
  node: HTMLElement,
  fontEmbedCSS: string,
): Promise<string> {
  return toPng(node, {
    width: SLIDE_W,
    height: SLIDE_H,
    pixelRatio: SCALE,
    fontEmbedCSS,
    skipFonts: !fontEmbedCSS, // if we have CSS, use it; never re-fetch per slide
    style: { transform: "none", margin: "0" },
  });
}

/** Compute the font-embed CSS once for the whole deck. */
export async function computeFontEmbedCSS(node: HTMLElement): Promise<string> {
  try {
    return await withTimeout(getFontEmbedCSS(node), 12000, "");
  } catch {
    return "";
  }
}

/** Build a PPTX where every slide is a full-bleed exported image. */
export async function exportToPptx(pngs: string[], fileName: string): Promise<void> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE16x9", width: 13.333, height: 7.5 });
  pptx.layout = "WIDE16x9";
  for (const png of pngs) {
    const slide = pptx.addSlide();
    slide.addImage({ data: png, x: 0, y: 0, w: 13.333, h: 7.5 });
  }
  await pptx.writeFile({ fileName });
}

/** Build a PDF where every slide is a full-page landscape image. */
export async function exportToPdf(pngs: string[], fileName: string): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "px",
    format: [SLIDE_W, SLIDE_H],
    compress: true,
  });
  pngs.forEach((png, i) => {
    if (i > 0) pdf.addPage([SLIDE_W, SLIDE_H], "landscape");
    pdf.addImage(png, "PNG", 0, 0, SLIDE_W, SLIDE_H, undefined, "FAST");
  });
  pdf.save(fileName);
}
