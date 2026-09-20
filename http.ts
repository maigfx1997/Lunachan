import iconv from "iconv-lite";
import { parseLooseJson } from "./php";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export type FetchOptions = {
  referer?: string;
  accept?: string;
  timeoutMs?: number;
  retries?: number;
  json?: boolean;
};

export type FetchTextResult = {
  ok: boolean;
  status: number;
  text: string;
  finalUrl: string;
  contentType: string;
};

function charsetFromHeaders(contentType: string): string | null {
  const m = /charset=([\w-]+)/i.exec(contentType);
  return m ? m[1].toLowerCase() : null;
}

function charsetFromHtml(head: string): string | null {
  const m =
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head) ??
    /<\?xml[^>]+encoding=["']([\w-]+)/i.exec(head);
  return m ? m[1].toLowerCase() : null;
}

/** UTF-8 sanity check: a valid utf-8 decode should not produce the replacement char. */
function looksBroken(text: string): boolean {
  return text.includes("\uFFFD");
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<FetchTextResult> {
  const { referer, accept, timeoutMs = 25000, retries = 2, json = false } = options;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": UA,
          Accept: accept ?? (json ? "application/json,text/plain,*/*" : "text/html,application/xhtml+xml,text/plain,*/*"),
          // JSON endpoints (Wattpad's API for instance) answer in a legacy PHP
          // array dump when an Arabic Accept-Language is sent, so keep JSON
          // requests in English.
          "Accept-Language": json ? "en-US,en;q=0.9" : "ar,fr-FR;q=0.9,en-US;q=0.8,en;q=0.7",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          ...(referer ? { Referer: referer } : {}),
        },
      });
      const contentType = res.headers.get("content-type") ?? "";
      const buf = Buffer.from(await res.arrayBuffer());
      let text = buf.toString("utf8");
      if (!json && (!contentType.includes("utf-8") || looksBroken(text))) {
        const declared = charsetFromHeaders(contentType) ?? charsetFromHtml(text.slice(0, 4096));
        if (declared && declared !== "utf-8" && iconv.encodingExists(declared)) {
          text = iconv.decode(buf, declared);
        } else if (looksBroken(text)) {
          const win = iconv.decode(buf, "windows-1256");
          if (!looksBroken(win)) text = win;
        }
      }
      clearTimeout(timer);
      return { ok: res.ok, status: res.status, text, finalUrl: res.url || url, contentType };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return {
    ok: false,
    status: 0,
    text: "",
    finalUrl: url,
    contentType: "",
    ...(lastError ? {} : {}),
  };
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetchText(url, {
      ...options,
      json: true,
      accept: "application/json, text/plain, */*",
      retries: 1,
    });
    if (res.ok && res.text) {
      const parsed = parseLooseJson(res.text);
      if (parsed !== undefined) return parsed as T;
    }
    await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
  }
  return null;
}

export type FetchedBinary = { ok: boolean; status: number; data: Buffer; mime: string };

const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

export function mimeFromUrl(url: string): string {
  const clean = url.split("?")[0].split("#")[0];
  const ext = clean.slice(clean.lastIndexOf(".") + 1).toLowerCase();
  return IMAGE_MIME[ext] ?? "application/octet-stream";
}

export function sniffImageMime(buf: Buffer, fallbackUrl = ""): string {
  if (buf.length > 12) {
    if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
    if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
    if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
    if (buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
    if (buf.subarray(4, 12).toString("ascii").includes("ftypavif")) return "image/avif";
    if (buf.subarray(0, 200).toString("utf8").toLowerCase().includes("<svg")) return "image/svg+xml";
  }
  return mimeFromUrl(fallbackUrl);
}

/** Downloads an image without ever re-encoding it. */
export async function fetchBinary(url: string, referer?: string, maxBytes = 12 * 1024 * 1024): Promise<FetchedBinary> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en;q=0.8",
        ...(referer ? { Referer: referer } : {}),
      },
    });
    const arr = Buffer.from(await res.arrayBuffer());
    clearTimeout(timer);
    if (!res.ok || arr.length === 0 || arr.length > maxBytes) {
      return { ok: false, status: res.status, data: Buffer.alloc(0), mime: "" };
    }
    const headerMime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const mime = headerMime.startsWith("image/") ? headerMime : sniffImageMime(arr, url);
    return { ok: true, status: res.status, data: arr, mime };
  } catch {
    clearTimeout(timer);
    return { ok: false, status: 0, data: Buffer.alloc(0), mime: "" };
  }
}
