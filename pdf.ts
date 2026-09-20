import "server-only";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { visualOrder, hasArabic } from "./arabic";
import { loadArabicFont } from "./fonts";
import type { LoadedImage } from "./assets";
import type { ExportBook } from "./types";

const PAGE = { width: 419.53, height: 595.28 }; // A5
const MARGIN = 42;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const BODY_SIZE = 11.5;
const LINE_HEIGHT = 18;
const TITLE_COLOR = rgb(0.478, 0.145, 0.329);
const BODY_COLOR = rgb(0.13, 0.1, 0.14);
const MUTED = rgb(0.6, 0.44, 0.53);

type Fonts = { regular: PDFFont; bold: PDFFont };

function wrapLogicalLine(text: string, font: PDFFont, size: number, maxWidth: number, rtl: boolean): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const visual = visualOrder(candidate, rtl);
    const width = font.widthOfTextAtSize(visual, size);
    if (width > maxWidth && current) {
      lines.push(current);
      current = word;
      continue;
    }
    if (width > maxWidth && !current) {
      // Single very long token: hard-split it.
      let chunk = "";
      for (const ch of word) {
        const next = chunk + ch;
        if (font.widthOfTextAtSize(visualOrder(next, rtl), size) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk = next;
        }
      }
      current = chunk;
      continue;
    }
    current = candidate;
  }
  if (current) lines.push(current);
  return lines;
}

export async function buildPdf(book: ExportBook, images: Map<string, LoadedImage>): Promise<Buffer> {
  const regularBytes = await loadArabicFont("regular");
  if (!regularBytes) throw new Error("font-missing");
  const boldBytes = (await loadArabicFont("bold")) ?? regularBytes;

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  const fonts: Fonts = { regular, bold };

  const rtl = book.languageCode.slice(0, 2) !== "fr" && book.languageCode.slice(0, 2) !== "en";

  pdf.setTitle(book.title);
  if (book.author) pdf.setAuthor(book.author);
  pdf.setSubject(book.description.slice(0, 400));
  pdf.setProducer("Luna Chan");
  pdf.setCreationDate(new Date());

  let page: PDFPage = pdf.addPage([PAGE.width, PAGE.height]);
  let cursor = PAGE.height - MARGIN;

  const newPage = () => {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    cursor = PAGE.height - MARGIN;
  };
  const ensure = (needed: number) => {
    if (cursor - needed < MARGIN + 12) newPage();
  };

  const supported = new Set<number>(regular.getCharacterSet());
  const onlySupported = (value: string) =>
    Array.from(value)
      .filter((ch) => supported.has(ch.codePointAt(0) ?? -1) || ch === " ")
      .join("");

  const drawLine = (text: string, options: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; center?: boolean } = {}) => {
    const font = options.font ?? fonts.regular;
    const size = options.size ?? BODY_SIZE;
    const visual = onlySupported(visualOrder(text, rtl && hasArabic(text)));
    if (!visual.trim()) return;
    let width = 0;
    try {
      width = font.widthOfTextAtSize(visual, size);
    } catch {
      return;
    }
    ensure(size + 4);
    const x = options.center ? Math.max(MARGIN, (PAGE.width - width) / 2) : Math.max(MARGIN, PAGE.width - MARGIN - width);
    try {
      page.drawText(visual, { x, y: cursor - size, size, font, color: options.color ?? BODY_COLOR });
    } catch {
      /* glyphs outside the font are skipped rather than invented */
    }
    cursor -= size + 4;
  };

  const drawParagraph = (text: string) => {
    const lines = wrapLogicalLine(text, fonts.regular, BODY_SIZE, CONTENT_WIDTH, rtl);
    for (const line of lines) {
      ensure(LINE_HEIGHT);
      drawLine(line, { size: BODY_SIZE });
      cursor -= LINE_HEIGHT - (BODY_SIZE + 4);
    }
    cursor -= 6;
  };

  const drawImage = async (image: LoadedImage) => {
    let embedded;
    try {
      embedded = image.mime === "image/png" ? await pdf.embedPng(image.bytes) : image.mime === "image/jpeg" ? await pdf.embedJpg(image.bytes) : null;
    } catch {
      embedded = null;
    }
    if (!embedded) return;
    const scale = Math.min(CONTENT_WIDTH / embedded.width, 420 / embedded.height, 1);
    const width = embedded.width * scale;
    const height = embedded.height * scale;
    ensure(height + 12);
    page.drawImage(embedded, {
      x: MARGIN + (CONTENT_WIDTH - width) / 2,
      y: cursor - height,
      width,
      height,
    });
    cursor -= height + 14;
  };

  // ---- Cover page (the original file, never re-encoded) ----
  if (book.cover) {
    let embedded;
    try {
      embedded =
        book.cover.mime === "image/png"
          ? await pdf.embedPng(book.cover.bytes)
          : book.cover.mime === "image/jpeg"
            ? await pdf.embedJpg(book.cover.bytes)
            : null;
    } catch {
      embedded = null;
    }
    if (embedded) {
      const scale = Math.min((CONTENT_WIDTH - 40) / embedded.width, (PAGE.height - 220) / embedded.height, 1);
      const width = embedded.width * scale;
      const height = embedded.height * scale;
      page.drawImage(embedded, {
        x: MARGIN + (CONTENT_WIDTH - width) / 2,
        y: PAGE.height - MARGIN - height,
        width,
        height,
      });
      cursor = PAGE.height - MARGIN - height - 26;
    }
  }
  drawLine(book.title, { font: fonts.bold, size: 19, color: TITLE_COLOR, center: true });
  cursor -= 4;
  if (book.author) drawLine(book.author, { size: 11, color: MUTED, center: true });
  drawLine(book.sourceUrl, { size: 8, color: MUTED, center: true });
  cursor -= 8;
  if (book.description) {
    drawLine("الوصف", { font: fonts.bold, size: 12, color: TITLE_COLOR });
    drawParagraph(book.description);
  }
  if (book.unavailable.length) {
    drawLine("فصول لم تُقرأ تلقائيًا", { font: fonts.bold, size: 11, color: MUTED });
    for (const chapter of book.unavailable) {
      drawLine(`${chapter.idx}. ${chapter.title}`, { size: 9, color: MUTED });
    }
  }

  // ---- Chapters ----
  for (const chapter of book.chapters) {
    newPage();
    drawLine(`${chapter.idx}. ${chapter.title}`, { font: fonts.bold, size: 15, color: TITLE_COLOR, center: true });
    cursor -= 10;
    for (const block of chapter.blocks) {
      if (block.type === "p") {
        if (block.text.trim()) drawParagraph(block.text);
        continue;
      }
      if (block.type === "h") {
        cursor -= 4;
        drawLine(block.text, { font: fonts.bold, size: 12.5, color: TITLE_COLOR });
        cursor -= 4;
        continue;
      }
      const image = images.get(block.src);
      if (image) await drawImage(image);
    }
  }

  // ---- Page numbers ----
  const pages = pdf.getPages();
  pages.forEach((current, index) => {
    if (index === 0) return;
    const label = String(index + 1);
    const width = fonts.regular.widthOfTextAtSize(label, 9);
    current.drawText(label, {
      x: (PAGE.width - width) / 2,
      y: MARGIN / 2,
      size: 9,
      font: fonts.regular,
      color: MUTED,
    });
  });

  const bytes = await pdf.save({ useObjectStreams: true });
  return Buffer.from(bytes);
}
