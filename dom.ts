import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { ChapterBlock } from "@/db/schema";
import { mimeFromUrl } from "./http";

export type $Doc = cheerio.CheerioAPI;

export function load(html: string): $Doc {
  return cheerio.load(html);
}

/** Removes everything that is definitely not part of the story. */
const JUNK_SELECTORS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "form",
  "button",
  "nav",
  "aside",
  "header",
  "footer",
  "svg",
  "video",
  "audio",
  "ins",
  "canvas",
  ".ads",
  ".ad",
  ".advert",
  ".advertisement",
  ".adsbygoogle",
  "[class*='advert']",
  "[class*='google-ad']",
  "[id*='google_ads']",
  "[class*='sponsor']",
  "[class*='promo']",
  "[class*='banner-ad']",
  "[class*='share']",
  "[class*='social']",
  "[class*='comment']",
  "[id*='disqus']",
  "[class*='disqus']",
  "[class*='rating']",
  "[class*='breadcrumb']",
  "[class*='pagination']",
  "[class*='newsletter']",
  "[class*='notification']",
  "[class*='cookie']",
  "[class*='popup']",
  "[class*='modal']",
  "[class*='toolbar']",
  "[class*='menu']",
  "[class*='sidebar']",
  "[class*='chapter-header']",
  "[class*='chapter-nav']",
  "[class*='chapter-footer']",
  "[class*='chapter-meta']",
  "[class*='navigation']",
  "[class*='pager']",
  "[class*='controls']",
  "a[rel='prev']",
  "a[rel='next']",
  "a[href*='prev']",
  "a[href*='next']",
  "[class*='related']",
  "[class*='recommend']",
  "[class*='login']",
  "[class*='register']",
  "[class*='favicon']",
  "[class*='avatar']",
  "[class*='logo']",
];

export function stripJunk($: $Doc, scope: cheerio.Cheerio<AnyNode>): void {
  for (const selector of JUNK_SELECTORS) {
    scope.find(selector).remove();
  }
  // Non-novel inline junk: style/event attributes, tracking images.
  scope.find("[style*='display:none'], [style*='display: none']").remove();
  scope.find("img").each((_, el) => {
    const $el = $(el);
    const src = ($el.attr("src") ?? $el.attr("data-src") ?? "").toLowerCase();
    if (!src) {
      $el.remove();
      return;
    }
    if (/sprite|icon|avatar|emoji|logo|badge|pixel|1x1|spacer|placeholder/.test(src)) {
      $el.remove();
    }
  });
}

export function absolute(url: string, base: string): string {
  const value = (url ?? "").trim();
  if (!value || value.startsWith("data:") || value.startsWith("javascript:")) return "";
  try {
    return new URL(value, base).toString();
  } catch {
    return "";
  }
}

export function normalizeText(input: string): string {
  return input
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Some sites inject invisible repeating characters to break copy/paste. */
export function scrubCopyGuards(text: string): string {
  let out = text;
  out = out.replace(/([a-zA-Z\u0600-\u06FF])\1{4,}/g, "$1");
  out = out.replace(/\b(?:u200b|nbsp|amp)\b/gi, " ");
  out = out.replace(/[^\S\n]{2,}/g, " ");
  return out;
}

export function countWords(text: string): number {
  const words = text.split(/\s+/).filter((w) => w.replace(/[^\p{L}\p{N}]/gu, "").length > 0);
  return words.length;
}

export function textOf($: $Doc, el: AnyNode): string {
  return normalizeText($(el).text());
}

export function metaContent($: $Doc, names: string[]): string {
  for (const name of names) {
    const value =
      $(`meta[property="${name}"]`).attr("content") ??
      $(`meta[name="${name}"]`).attr("content") ??
      $(`meta[property="${name.toLowerCase()}"]`).attr("content");
    if (value && value.trim()) return normalizeText(value);
  }
  return "";
}

export type JsonLd = Record<string, unknown>;

export function jsonLdBlocks($: $Doc): JsonLd[] {
  const out: JsonLd[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const push = (value: unknown) => {
        if (Array.isArray(value)) value.forEach(push);
        else if (value && typeof value === "object") out.push(value as JsonLd);
      };
      push(parsed);
    } catch {
      /* ignore malformed ld+json */
    }
  });
  return out;
}

function pickString(value: unknown): string {
  if (typeof value === "string") return normalizeText(value);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.name === "string") return normalizeText(obj.name);
    if (typeof obj.url === "string") return obj.url;
  }
  return "";
}

/** Cover candidates found in ld+json / og / twitter. */
export function findCover($: $Doc, base: string): string {
  const ld = jsonLdBlocks($).find((b) => b.image || b.thumbnailUrl);
  if (ld) {
    const raw = ld.image ?? ld.thumbnailUrl;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const url = absolute(pickString(item) || pickString((item as Record<string, unknown>)?.url), base);
        if (url) return url;
      }
    } else {
      const url = absolute(pickString(raw) || pickString((raw as Record<string, unknown>)?.url), base);
      if (url) return url;
    }
  }
  const og = metaContent($, ["og:image", "og:image:url", "twitter:image", "twitter:image:src"]);
  if (og) return absolute(og, base);

  let best = { url: "", size: 0 };
  $("img").each((_, el) => {
    const $el = $(el);
    const src = absolute($el.attr("src") ?? $el.attr("data-src") ?? "", base);
    if (!src || !/^https?:/.test(src)) return;
    const cls = `${$el.attr("class") ?? ""} ${$el.attr("id") ?? ""} ${$el.attr("alt") ?? ""}`.toLowerCase();
    const bonus = /cover|book|novel|poster|thumb|story/.test(cls) ? 500 : 0;
    const width = Number($el.attr("width") ?? 0);
    const height = Number($el.attr("height") ?? 0);
    const size = bonus + width * height;
    if (size > best.size) best = { url: src, size };
  });
  return best.url;
}

export function findDescription($: $Doc): string {
  const ld = jsonLdBlocks($).find((b) => typeof b.description === "string");
  if (ld && typeof ld.description === "string" && ld.description.trim().length > 40) {
    return normalizeText(ld.description);
  }
  const candidateSelectors = [
    "#synopsisText",
    ".synopsis-text",
    ".synopsisText",
    "#summary",
    ".summary-text",
    "[itemprop='description']",
    ".novel-summary",
    ".description",
    ".desc",
    ".story-description",
    ".book-description",
    "article",
  ];
  let best = "";
  for (const selector of candidateSelectors) {
    $(selector).each((_, el) => {
      const clone = $(el).clone();
      stripJunk($, clone);
      const text = normalizeText(clone.text());
      if (text.length > best.length && text.length > 40) best = text;
    });
  }
  if (best) return best;
  const meta = metaContent($, ["og:description", "twitter:description", "description"]);
  return meta.length > 40 ? meta : best;
}

export function stripSiteSuffix(title: string, suffixes: string[]): string {
  let out = title;
  for (const suffix of suffixes) {
    const pattern = new RegExp(`\\s*[-–|—:]\\s*${suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
    out = out.replace(pattern, "");
  }
  return normalizeText(out);
}

/** Reads inline images from a content element, keeping document order. */
function blocksFromElement($: $Doc, el: cheerio.Cheerio<AnyNode>, base: string): ChapterBlock[] {
  const blocks: ChapterBlock[] = [];
  const seenImages = new Set<string>();

  const walk = (node: cheerio.Cheerio<AnyNode>) => {
    node.contents().each((_, child) => {
      if (child.type === "text") {
        const text = normalizeText($(child).text());
        if (text) blocks.push({ type: "p", text });
        return;
      }
      if (child.type !== "tag") return;
      const $child = $(child);
      const tag = (child as { name?: string }).name?.toLowerCase() ?? "";

      if (tag === "img" || tag === "source") {
        const raw = $child.attr("src") ?? $child.attr("data-src") ?? $child.attr("data-original") ?? $child.attr("data-lazy-src") ?? "";
        const url = absolute(raw, base);
        if (url && /^https?:/.test(url) && !seenImages.has(url)) {
          seenImages.add(url);
          blocks.push({ type: "img", src: url, alt: normalizeText($child.attr("alt") ?? "") });
        }
        return;
      }

      const nestedImage = $child.find("img[src], img[data-src]").first();
      if (nestedImage.length > 0) {
        walk($child);
        return;
      }

      if (tag === "br") {
        blocks.push({ type: "p", text: "" });
        return;
      }

      const text = normalizeText($child.text());
      if (!text) return;
      if (/^h[1-6]$/.test(tag)) blocks.push({ type: "h", text });
      else blocks.push({ type: "p", text });
    });
  };

  walk(el);

  // Merge adjacent pieces, drop empties at the edges, remove duplicate paragraphs.
  const merged: ChapterBlock[] = [];
  const seenTexts = new Set<string>();
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (block.type === "p") {
      const text = block.text.trim();
      if (!text && (!previous || previous.type !== "p")) continue;
      if (text && seenTexts.has(text)) continue;
      if (text) seenTexts.add(text);
      if (previous && previous.type === "p" && (!previous.text || !text)) {
        merged[merged.length - 1] = { type: "p", text: previous.text || text };
        continue;
      }
      merged.push({ type: "p", text });
      continue;
    }
    if (previous && previous.type === "img" && block.type === "img" && previous.src === block.src) continue;
    merged.push(block);
  }
  const isBlankParagraph = (block: ChapterBlock | undefined) =>
    !!block && block.type === "p" && block.text.length === 0;
  while (isBlankParagraph(merged[0])) merged.shift();
  while (isBlankParagraph(merged[merged.length - 1])) merged.pop();
  return merged;
}

export function blocksToPlainText(blocks: ChapterBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "p" || block.type === "h") return block.text;
      return "";
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function countImages(blocks: ChapterBlock[]): number {
  return blocks.reduce((sum, b) => (b.type === "img" ? sum + 1 : sum), 0);
}

export type ContentResult = { blocks: ChapterBlock[]; text: string; images: number };

/** Picks the densest content container and converts it to clean blocks. */
const NOISE_LINE =
  /^(?:الفصل|الجزء|chapter|chapitre|part|episode)\s*(?:السابق|التالي|previous|next|précédent|suivant)?\s*$/i;

const NOISE_EXACT =
  /^(?:السابق|التالي|الفصل السابق|الفصل التالي|مشاركة|الإبلاغ|إبلاغ|تعليقات|رد|إعجاب|views?|likes?|comments?|share|report|next|previous|prev|next chapter|previous chapter|chapter list|فهرس الفصول|قائمة الفصول|<|>)$/i;

/** Drops pure counters, chapter-navigation links and duplicated headers. */
function isNoiseBlock(block: ChapterBlock, chapterTitle: string): boolean {
  if (block.type !== "p") return false;
  const text = block.text.trim();
  if (!text) return false;
  if (/^\d{1,5}$/.test(text)) return true;
  if (NOISE_EXACT.test(text)) return true;
  if (NOISE_LINE.test(text)) return true;
  if (chapterTitle && text.replace(/\s+/g, " ").trim() === chapterTitle.replace(/\s+/g, " ").trim()) return true;
  if (/^(?:الفصل|chapter)\s+\d+\s*$/i.test(text)) return true;
  return false;
}

function cleanBlocks(blocks: ChapterBlock[], chapterTitle: string): ChapterBlock[] {
  const out: ChapterBlock[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    if (isNoiseBlock(block, chapterTitle)) continue;
    if (block.type === "p" || block.type === "h") {
      const key = block.text.trim();
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(block);
  }
  return out;
}

/**
 * Picks the best content container. Selectors are ordered from the most
 * specific to the most generic; each selector is treated as ONE group (every
 * matching paragraph is kept, in document order) so repeated paragraph blocks
 * are never lost. The first group that carries a real chapter wins.
 */
export function extractContent(
  $: $Doc,
  base: string,
  selectors: string[],
  chapterTitle = "",
): ContentResult {
  const groups: { blocks: ChapterBlock[]; text: string; letters: number }[] = [];

  for (const selector of selectors) {
    const nodes = $(selector);
    if (nodes.length === 0) continue;
    let blocks: ChapterBlock[] = [];
    nodes.each((_, el) => {
      const $el = $(el).clone();
      stripJunk($, $el);
      blocks = blocks.concat(blocksFromElement($, $el, base));
    });
    blocks = cleanBlocks(blocks, chapterTitle);
    const text = blocksToPlainText(blocks);
    const letters = text.replace(/\s+/g, "").length;
    if (letters === 0 && countImages(blocks) === 0) continue;
    groups.push({ blocks, text, letters });
  }

  const rich = groups.find((group) => group.letters >= 120 || countImages(group.blocks) >= 2);
  const winner =
    rich ??
    groups.slice().sort((a, b) => b.letters + countImages(b.blocks) * 200 - (a.letters + countImages(a.blocks) * 200))[0];

  if (winner) return { blocks: winner.blocks, text: winner.text, images: countImages(winner.blocks) };

  // Last resort: whole body.
  const $body = $("body").clone();
  stripJunk($, $body);
  const blocks = cleanBlocks(blocksFromElement($, $body, base), chapterTitle);
  const text = blocksToPlainText(blocks);
  return { blocks, text, images: countImages(blocks) };
}

export function htmlLang($: $Doc): string {
  const raw = ($("html").attr("lang") ?? "").toLowerCase().slice(0, 2);
  if (raw === "ar" || raw === "fr" || raw === "en") return raw;
  return "ar";
}

export function isImageUrl(url: string): boolean {
  const mime = mimeFromUrl(url);
  return mime.startsWith("image/");
}

/** Labels of call-to-action links that are not chapters ("start reading", …). */
export const NON_CHAPTER_LABEL =
  /(ابدأ القراءة|أبدأ القراءة|اقرأ الآن|اقرأي|متابعة القراءة|الصفحة التالية|السابق|التالي|start reading|read now|continue reading|next chapter|previous chapter|login|sign in|register|share|comments?)/i;

export function chapterOrdinal(label: string, url: string): number | null {
  const fromLabel = /(?:الفصل|الجزء|chapter|chapitre|part|episode)\s*[-_#]*\s*(\d{1,4})/i.exec(label);
  if (fromLabel) return Number(fromLabel[1]);
  const fromUrl = /(?:post_id|chapter|chapitre|chapter_id|ep|part|id)=(\d{1,7})/i.exec(url);
  if (fromUrl) return Number(fromUrl[1]);
  return null;
}

export function sanitizeTitle(value: string): string {
  return normalizeText(value).replace(/^[\s\-–—:_.]+|[\s\-–—:_.]+$/g, "");
}
