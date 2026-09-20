import type { Adapter, BookMeta, ChapterContent, ChapterRef } from "../types";
import { fetchText } from "../http";
import {
  NON_CHAPTER_LABEL,
  absolute,
  blocksToPlainText,
  chapterOrdinal,
  countImages,
  extractContent,
  findCover,
  findDescription,
  load,
  metaContent,
  normalizeText,
  sanitizeTitle,
  stripSiteSuffix,
} from "../dom";

function chapterUrlFromDetails(detailsUrl: string, href: string): string {
  return absolute(href, detailsUrl);
}

/**
 * Adapter for the "views/novel" family of Arabic novel portals that publish
 * a details page plus read.php?post_id=N chapter pages.
 */
export const portalAdapter: Adapter = {
  name: "portal",
  label: "portal",

  matches(url) {
    return /novlar|khalidblog/i.test(url.hostname);
  },

  async fetchMeta(input) {
    let target = input;
    let html = "";
    let finalUrl = input;

    const first = await fetchText(input, { referer: input });
    if (!first.ok || !first.text) {
      throw new Error(`تعذّر فتح الرابط (HTTP ${first.status})`);
    }
    html = first.text;
    finalUrl = first.finalUrl;

    // A chapter link was pasted: hop to its novel page so we can list everything.
    if (/read\.php|chapter/i.test(finalUrl)) {
      const $chapter = load(html);
      const back = $chapter('a[href*="details.php?id="]').first().attr("href");
      if (back) {
        target = absolute(back, finalUrl);
        const res = await fetchText(target, { referer: finalUrl });
        if (res.ok && res.text) {
          html = res.text;
          finalUrl = res.finalUrl;
        }
      }
    }

    const $ = load(html);
    const host = new URL(finalUrl).origin;

    const title =
      sanitizeTitle($("h1").first().text()) ||
      stripSiteSuffix(metaContent($, ["og:title", "twitter:title"]), ["منصة الروايات", "روايات"]) ||
      sanitizeTitle($("title").first().text());

    const cover =
      absolute($("img.cover-img").first().attr("src") ?? "", finalUrl) || findCover($, finalUrl);

    const description =
      normalizeText($("#synopsisText").text()) || normalizeText($(".synopsis-text").text()) || findDescription($);

    const author =
      normalizeText($(".author-card h4").first().text()) ||
      normalizeText($("a[href*='author-profile'] h4").first().text()) ||
      normalizeText($("a[href*='author-profile']").first().text()) ||
      metaContent($, ["author"]);

    type Candidate = { url: string; title: string; order: number | null; position: number };
    const byUrl = new Map<string, Candidate>();
    let position = 0;

    $("a.chapter-item, a[href*='read.php?post_id='], a[href*='/read.php']").each((_, el) => {
      const $el = $(el);
      const href = $el.attr("href") ?? "";
      if (!/post_id=\d+|read\.php/.test(href)) return;
      const url = chapterUrlFromDetails(finalUrl, href);
      if (!url) return;
      position += 1;

      const label = normalizeText($el.find("small").text());
      const strong = normalizeText($el.find("strong").text());
      const anchorText = normalizeText($el.text());
      const combined = sanitizeTitle([label, strong].filter(Boolean).join(" — ") || anchorText);
      const isNoise = NON_CHAPTER_LABEL.test(combined) || NON_CHAPTER_LABEL.test(anchorText);
      const order = chapterOrdinal(combined || anchorText, url);

      const existing = byUrl.get(url);
      // A duplicate link ("start reading") must not win over the real chapter title.
      if (existing) {
        if ((!existing.title || NON_CHAPTER_LABEL.test(existing.title)) && !isNoise && combined) {
          existing.title = combined;
          existing.order = order;
        }
        return;
      }
      byUrl.set(url, {
        url,
        title: isNoise ? "" : combined,
        order,
        position,
      });
    });

    const candidates = [...byUrl.values()]
      .filter((candidate) => candidate.title || byUrl.size === 1)
      .sort((a, b) => {
        if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
        if (a.order !== null && b.order === null) return -1;
        if (a.order === null && b.order !== null) return 1;
        return a.position - b.position;
      });

    const chapters: ChapterRef[] = candidates.map((candidate, index) => ({
      idx: index + 1,
      title: candidate.title || `الفصل ${index + 1}`,
      url: candidate.url,
    }));

    if (chapters.length === 0) {
      // Single page mode: the pasted link is the only readable part.
      chapters.push({ idx: 1, title: title || "الفصل 1", url: finalUrl });
    }

    return {
      adapter: portalAdapter.name,
      sourceUrl: finalUrl,
      host,
      title,
      author,
      description,
      languageCode: "ar",
      coverUrl: cover,
      chapters,
    };
  },

  async fetchChapter(ref, meta): Promise<ChapterContent> {
    const res = await fetchText(ref.url, { referer: meta.sourceUrl });
    if (!res.ok || !res.text) throw new Error(`HTTP ${res.status}`);
    const $ = load(res.text);
    const title =
      sanitizeTitle($(".chapter-header h1").first().text()) ||
      sanitizeTitle($("h1").first().text()) ||
      sanitizeTitle($("h2").first().text()) ||
      ref.title;

    const content = extractContent(
      $,
      ref.url,
      [
      "#chapterContent .paragraph-content",
      "#chapterContent",
      ".chapter-content",
      ".chapter-container",
      ".paragraph-content",
      "article",
      ],
      title,
    );

    return {
      title: title || ref.title,
      blocks: content.blocks,
      text: content.text || blocksToPlainText(content.blocks),
      imageCount: countImages(content.blocks),
    };
  },
};
