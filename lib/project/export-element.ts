/**
 * Export an arbitrary DOM element (e.g. the Gantt chart) to PNG or PDF.
 * Inlines images and embeds fonts once so the raster is crisp and self-contained.
 */

import { toPng, getFontEmbedCSS } from "html-to-image";

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);

async function rasterize(node: HTMLElement): Promise<{ dataUrl: string; w: number; h: number }> {
  const w = node.scrollWidth || node.offsetWidth;
  const h = node.scrollHeight || node.offsetHeight;
  let fontEmbedCSS = "";
  try {
    fontEmbedCSS = await withTimeout(getFontEmbedCSS(node), 10000, "");
  } catch {
    /* ignore */
  }
  const dataUrl = await toPng(node, {
    width: w,
    height: h,
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    fontEmbedCSS,
    skipFonts: !fontEmbedCSS,
  });
  return { dataUrl, w, h };
}

export async function exportElementToPng(node: HTMLElement, fileName: string): Promise<void> {
  const { dataUrl } = await rasterize(node);
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName.endsWith(".png") ? fileName : `${fileName}.png`;
  a.click();
}

export async function exportElementToPdf(node: HTMLElement, fileName: string): Promise<void> {
  const { dataUrl, w, h } = await rasterize(node);
  const { jsPDF } = await import("jspdf");
  const landscape = w >= h;
  const pdf = new jsPDF({
    orientation: landscape ? "landscape" : "portrait",
    unit: "px",
    format: [w, h],
    compress: true,
  });
  pdf.addImage(dataUrl, "PNG", 0, 0, w, h, undefined, "FAST");
  pdf.save(fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`);
}
