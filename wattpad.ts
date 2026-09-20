import type { Adapter, ChapterContent, ChapterRef } from "../types";
import { fetchJson, fetchText } from "../http";
import { blocksToPlainText, countImages, extractContent, load, normalizeText, sanitizeTitle } from "../dom";

type WattpadPart = { id: number | string; title?: string; url?: string };

type WattpadStory = {
  id: string | number;
  title?: string;
  description?: string;
  cover?: string | { url?: string };
  user?: { name?: string; fullname?: string };
  author?: string;
  language?: { id?: number; name?: string };
  parts?: WattpadPart[];
};

const API = "https://www.wattpad.com/api/v3";

/**
 * Wattpad's public API sometimes answers with a legacy print_r dump or refuses
 * the request, but the story page always embeds the full story payload.
 * These helpers recover title/description/cover/parts from that HTML.
 */
function findEnclosingObjectStart(html: string, index: number, skip = 0): number {
  let depth = 0;
  let skipped = 0;
  for (let i = index; i >= 0; i -= 1) {
    const ch = html[i];
    if (ch === "}") depth += 1;
    else if (ch === "{") {
      if (depth === 0) {
        if (skipped >= skip) return i;
        skipped += 1;
      } else {
        depth -= 1;
      }
    }
  }
  return -1;
}

function extractBalancedJson(text: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, i + 1);
    }
  }
  return null;
}

function embeddedStoryFromHtml(html: string): WattpadStory | null {
  const markerIdx = html.indexOf('"parts":[');
  if (markerIdx === -1) return null;
  for (let skip = 0; skip < 24; skip += 1) {
    const start = findEnclosingObjectStart(html, markerIdx, skip);
    if (start === -1) break;
    const candidate = extractBalancedJson(html, start);
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as WattpadStory;
      if (parsed && Array.isArray(parsed.parts)) return parsed;
    } catch {
      /* keep walking outwards */
    }
  }
  return null;
}


export function storyIdFromUrl(raw: string): string | null {
  const m = /\/story\/(\d+)/i.exec(raw);
  if (m) return m[1];
  const m2 = /\/(?:story\/)?(\d{6,})(?:[-/]|$)/.exec(new URL(raw).pathname);
  if (m2) return m2[1];
  const m3 = /(\d{6,})/.exec(raw);
  return m3 ? m3[1] : null;
}

function partIdFromUrl(raw: string): string | null {
  const m = /^\/(\d{6,})/i.exec(new URL(raw).pathname);
  return m ? m[1] : null;
}

function languageCode(story: WattpadStory): string {
  const name = (story.language?.name ?? "").toLowerCase();
  if (/عرب|arab/.test(name)) return "ar";
  if (/fran|français|fren/.test(name)) return "fr";
  if (/engl|english/.test(name)) return "en";
  return "ar";
}

export const wattpadAdapter: Adapter = {
  name: "wattpad",
  label: "wattpad",

  matches(url) {
    return /wattpad\.com$/i.test(url.hostname.replace(/^www\./, ""));
  },

  async fetchMeta(input) {
    let storyId = storyIdFromUrl(input);
    const partId = partIdFromUrl(input);

    // A single chapter link was pasted -> resolve its parent story.
    if (!storyId && partId) {
      const info = await fetchJson<{ group?: { id?: string } }>(
        `${API}/story_parts/${partId}?fields=id,title,group(id,title)`,
        { referer: input },
      );
      if (info?.group?.id) storyId = String(info.group.id);
    }
    if (!storyId) throw new Error("لم يتم العثور على معرّف الرواية في الرابط");

    let story = await fetchJson<WattpadStory>(
      `${API}/stories/${storyId}?fields=id,title,description,cover,user,author,language,parts(id,title,url)`,
      { referer: input },
    );

    if (!story || !story.parts || story.parts.length === 0) {
      // Fallback: read the payload embedded in the story page itself.
      const page = await fetchText(`https://www.wattpad.com/story/${storyId}`, { referer: input });
      if (page.ok && page.text) {
        const embedded = embeddedStoryFromHtml(page.text);
        if (embedded) {
          story = {
            ...embedded,
            user: embedded.user ?? story?.user,
            description: embedded.description ?? story?.description,
            cover: embedded.cover ?? story?.cover,
            title: embedded.title ?? story?.title,
          };
        } else {
          const $page = load(page.text);
          const ld = $page('script[type="application/ld+json"]').first().contents().text();
          let ldTitle = "";
          let ldDescription = "";
          try {
            const parsed = JSON.parse(ld) as { name?: string; description?: string; image?: string };
            ldTitle = normalizeText(parsed.name ?? "");
            ldDescription = normalizeText(parsed.description ?? "");
          } catch {
            /* ignore */
          }
          story = {
            ...(story ?? { id: storyId }),
            title: ldTitle || normalizeText($page("h1").first().text()) || story?.title || "",
            description: ldDescription || normalizeText($page("meta[name='description']").attr("content") ?? "") || story?.description || "",
            parts: story?.parts ?? [],
          };
        }
      }
    }

    if (!story) throw new Error("تعذّر الوصول إلى بيانات الرواية (قد يكون الرابط خاصًا)");

    const cover = typeof story.cover === "string" ? story.cover : (story.cover?.url ?? "");
    const chapters: ChapterRef[] =
      story.parts?.map((part, index) => ({
        idx: index + 1,
        title: normalizeText(part.title ?? "") || `فصل ${index + 1}`,
        url: part.url && /^https?:/.test(part.url) ? part.url : `https://www.wattpad.com/${part.id}`,
      })) ?? [];

    return {
      adapter: wattpadAdapter.name,
      sourceUrl: `https://www.wattpad.com/story/${storyId}`,
      host: "https://www.wattpad.com",
      title: normalizeText(story.title ?? ""),
      author: normalizeText(story.user?.fullname ?? story.user?.name ?? story.author ?? ""),
      description: normalizeText(story.description ?? ""),
      languageCode: languageCode(story),
      coverUrl: cover,
      chapters,
    };
  },

  async fetchChapter(ref, meta): Promise<ChapterContent> {
    const partId = partIdFromUrl(ref.url) ?? (/(\d{6,})/.exec(ref.url)?.[1] ?? "");
    if (!partId) throw new Error("معرّف الفصل غير صالح");
    const res = await fetchText(`https://www.wattpad.com/apiv2/storytext?id=${partId}`, {
      referer: meta.sourceUrl,
      accept: "text/html,application/xhtml+xml,*/*",
    });
    if (!res.ok || !res.text) throw new Error(`HTTP ${res.status}`);
    if (/ERROR/i.test(res.text.slice(0, 80))) throw new Error("تعذّر جلب نص الفصل");

    const $ = load(`<div id="wp-root">${res.text}</div>`);
    let content = extractContent($, ref.url, ["#wp-root"], ref.title);
    let title = sanitizeTitle(ref.title);

    if (content.text.replace(/\s+/g, "").length < 40) {
      // Fallback: parse the rendered chapter page.
      const page = await fetchText(ref.url, { referer: meta.sourceUrl });
      if (page.ok && page.text) {
        const $page = load(page.text);
        title = sanitizeTitle($page("h1").first().text()) || title;
        content = extractContent(
          $page,
          ref.url,
          [".panel-reading pre", ".panel-reading", "[data-p-id]", "article", "main"],
          title,
        );
      }
    }

    return {
      title,
      blocks: content.blocks,
      text: content.text || blocksToPlainText(content.blocks),
      imageCount: countImages(content.blocks),
    };
  },
};


