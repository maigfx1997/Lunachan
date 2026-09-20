import "server-only";
import type { ChapterBlock } from "@/db/schema";
import { escapeHtml, escapeXml, type ExportBook, type ExportChapter } from "./types";
import type { LoadedImage } from "./assets";

const HEADERS = {
  ar: { chapters: "الفصول", notes: "ملاحظات الاستيراد", description: "الوصف", author: "المؤلف", source: "المصدر", unavailable: "فصول لم تُقرأ تلقائيًا", toc: "المحتويات" },
  fr: { chapters: "Chapitres", notes: "Notes d'importation", description: "Résumé", author: "Auteur", source: "Source", unavailable: "Chapitres non récupérés", toc: "Sommaire" },
  en: { chapters: "Chapters", notes: "Import notes", description: "Summary", author: "Author", source: "Source", unavailable: "Chapters not retrieved", toc: "Contents" },
} as const;

type Lang = keyof typeof HEADERS;

function lang(book: ExportBook): Lang {
  const code = book.languageCode.slice(0, 2).toLowerCase();
  return (["ar", "fr", "en"] as const).includes(code as Lang) ? (code as Lang) : "ar";
}

function chapterText(chapter: ExportChapter): string {
  return chapter.blocks
    .map((block) => (block.type === "p" || block.type === "h" ? block.text : null))
    .filter((value): value is string => value !== null)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function notesBlock(book: ExportBook, lang: Lang): string[] {
  if (book.unavailable.length === 0) return [];
  return [
    `${HEADERS[lang].notes} — ${HEADERS[lang].unavailable}: ${book.unavailable.map((c) => `${c.idx}. ${c.title}`).join(" • ")}`,
  ];
}

export function toTxt(book: ExportBook): string {
  const l = lang(book);
  const lines: string[] = [];
  lines.push(book.title);
  if (book.author) lines.push(`${HEADERS[l].author}: ${book.author}`);
  lines.push(`${HEADERS[l].source}: ${book.sourceUrl}`);
  lines.push("=".repeat(48));
  if (book.description) {
    lines.push(HEADERS[l].description.toUpperCase());
    lines.push(book.description);
    lines.push("");
  }
  lines.push(`${HEADERS[l].chapters}: ${book.chapters.length}`);
  lines.push("");
  for (const chapter of book.chapters) {
    lines.push("");
    lines.push(`— ${chapter.idx}. ${chapter.title} —`);
    lines.push("");
    lines.push(chapterText(chapter) || "(فارغ)");
  }
  const notes = notesBlock(book, l);
  if (notes.length) {
    lines.push("");
    lines.push("=".repeat(48));
    notes.forEach((note) => lines.push(note));
  }
  return lines.join("\n");
}

export function toMarkdown(book: ExportBook): string {
  const l = lang(book);
  const lines: string[] = [`# ${book.title}`, ""];
  if (book.author) lines.push(`**${HEADERS[l].author}:** ${book.author}`, "");
  lines.push(`**${HEADERS[l].source}:** ${book.sourceUrl}`, "");
  if (book.cover?.bytes) lines.push("", "![الغلاف](./cover.jpg)", "");
  if (book.description) lines.push(`## ${HEADERS[l].description}`, "", book.description, "");
  lines.push(`## ${HEADERS[l].toc}`, "");
  book.chapters.forEach((chapter) => lines.push(`${chapter.idx}. ${chapter.title}`));
  lines.push("");
  for (const chapter of book.chapters) {
    lines.push("", `## ${chapter.idx}. ${chapter.title}`, "");
    for (const block of chapter.blocks) {
      if (block.type === "p") lines.push(block.text, "");
      else if (block.type === "h") lines.push(`### ${block.text}`, "");
      else lines.push(`![${block.alt ?? "صورة الفصل"}](${block.src})`, "");
    }
  }
  const notes = notesBlock(book, l);
  if (notes.length) lines.push("", "---", "", ...notes.map((note) => `_${note}_`));
  return lines.join("\n");
}

function htmlBlocks(chapter: ExportChapter): string {
  return chapter.blocks
    .map((block: ChapterBlock) => {
      if (block.type === "p") return block.text ? `<p>${escapeHtml(block.text)}</p>` : "";
      if (block.type === "h") return `<h3 class="bh">${escapeHtml(block.text)}</h3>`;
      return `<figure><img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt ?? "")}" referrerpolicy="no-referrer" loading="lazy" /></figure>`;
    })
    .join("\n");
}

export function toHtml(book: ExportBook): string {
  const l = lang(book);
  const dir = lang(book) === "ar" ? "rtl" : "ltr";
  const cover = book.cover ? `data:${book.cover.mime};base64,${book.cover.bytes.toString("base64")}` : "";
  const notes = notesBlock(book, l);

  return `<!doctype html>
<html lang="${lang(book)}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(book.title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; background:#fff7fb; color:#2c2030; font-family: "Amiri","Noto Naskh Arabic","Segoe UI",system-ui,sans-serif; line-height:2; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 32px 20px 80px; }
  header { text-align:center; }
  .cover { max-width: 300px; width: 70%; border-radius: 14px; box-shadow: 0 18px 40px rgba(122,37,84,.18); }
  h1 { font-size: 2rem; margin: 18px 0 6px; color:#7a2554; }
  .meta { color:#9b6f86; font-size:.95rem; }
  .desc { background:#fff; border:1px solid #f6d6e6; border-radius:16px; padding:16px 18px; margin:24px 0; white-space:pre-wrap; }
  nav.toc ol { padding-inline-start: 1.2rem; }
  nav.toc a { color:#a03b6e; text-decoration:none; }
  section.chapter { margin-top: 42px; }
  section.chapter h2 { color:#7a2554; border-bottom:2px dashed #f2c6dd; padding-bottom:8px; }
  p { margin: 0 0 14px; }
  figure { margin: 18px 0; text-align:center; }
  figure img { max-width: 100%; border-radius: 12px; box-shadow: 0 10px 24px rgba(122,37,84,.12); }
  .notes { margin-top: 48px; font-size: .9rem; color:#9b6f86; border-top:1px solid #f6d6e6; padding-top:14px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    ${cover ? `<img class="cover" src="${cover}" alt="${escapeHtml(book.title)}" />` : ""}
    <h1>${escapeHtml(book.title)}</h1>
    <div class="meta">${book.author ? `${escapeHtml(HEADERS[lang(book)].author)}: ${escapeHtml(book.author)} • ` : ""}${escapeHtml(book.sourceUrl)}</div>
  </header>
  ${book.description ? `<div class="desc">${escapeHtml(book.description)}</div>` : ""}
  <nav class="toc"><h2>${escapeHtml(HEADERS[lang(book)].toc)}</h2><ol>
    ${book.chapters.map((c) => `<li><a href="#ch-${c.idx}">${escapeHtml(c.title)}</a></li>`).join("\n    ")}
  </ol></nav>
  ${book.chapters
    .map(
      (chapter) => `<section class="chapter" id="ch-${chapter.idx}">
    <h2>${chapter.idx}. ${escapeHtml(chapter.title)}</h2>
    ${htmlBlocks(chapter)}
  </section>`,
    )
    .join("\n  ")}
  ${notes.length ? `<div class="notes">${notes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}</div>` : ""}
</div>
</body>
</html>`;
}

export function toJson(book: ExportBook): string {
  return JSON.stringify(
    {
      title: book.title,
      author: book.author,
      description: book.description,
      language: book.languageCode,
      source: book.sourceUrl,
      chapterCount: book.chapters.length,
      unavailableChapters: book.unavailable,
      chapters: book.chapters.map((chapter) => ({
        index: chapter.idx,
        title: chapter.title,
        url: chapter.sourceUrl,
        blocks: chapter.blocks,
        text: chapterText(chapter),
      })),
    },
    null,
    2,
  );
}

export function toFb2(book: ExportBook, images: Map<string, LoadedImage> = new Map()): string {
  const binaries: string[] = [];
  const imageId = new Map<string, string>();
  let counter = 0;

  const register = (url: string, bytes: Buffer, mime: string) => {
    if (imageId.has(url)) return imageId.get(url)!;
    counter += 1;
    const id = `img${counter}.${(mime.split("/")[1] ?? "jpg").replace(/[^a-z0-9]/gi, "") || "jpg"}`;
    imageId.set(url, id);
    binaries.push(`<binary id="${id}" content-type="${mime}">${bytes.toString("base64")}</binary>`);
    return id;
  };

  const body = book.chapters
    .map((chapter) => {
      const content = chapter.blocks
        .map((block) => {
          if (block.type === "p") return block.text ? `<p>${escapeXml(block.text)}</p>` : "";
          if (block.type === "h") return `<subtitle>${escapeXml(block.text)}</subtitle>`;
          const image = images.get(block.src);
          if (!image) return "";
          const id = register(block.src, image.bytes, image.mime);
          return id ? `<image l:href="#${id}"/>` : "";
        })
        .join("\n      ");
      return `  <section>\n    <title><p>${escapeXml(`${chapter.idx}. ${chapter.title}`)}</p></title>\n      ${content}\n  </section>`;
    })
    .join("\n");

  const coverBinary = book.cover ? register("__cover__", book.cover.bytes, book.cover.mime) : "";

  return `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <genre>novel</genre>
      <author><nickname>${escapeXml(book.author || "—")}</nickname></author>
      <book-title>${escapeXml(book.title)}</book-title>
      <annotation><p>${escapeXml(book.description || "")}</p></annotation>
      ${coverBinary ? `<coverpage><image l:href="#${coverBinary}"/></coverpage>` : ""}
      <lang>${escapeXml(book.languageCode || "ar")}</lang>
    </title-info>
    <document-info><program-used>Luna Chan</program-used></document-info>
  </description>
  <body>
${body}
  </body>
${binaries.join("\n")}
</FictionBook>`;
}

export { chapterText, lang as bookLanguage };
