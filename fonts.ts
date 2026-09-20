import "server-only";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const FONT_FILES = {
  regular: "Amiri-Regular.ttf",
  bold: "Amiri-Bold.ttf",
} as const;

const CANDIDATE_DIRS = [
  path.join(process.cwd(), "assets", "fonts"),
  path.join(process.cwd(), "..", "assets", "fonts"),
  path.join(process.cwd(), ".next", "standalone", "assets", "fonts"),
  path.join(__dirname, "..", "..", "..", "assets", "fonts"),
];

const REMOTE_FALLBACK = "https://raw.githubusercontent.com/google/fonts/main/ofl/amiri/";

const cache = new Map<string, Buffer | null>();

async function resolveLocal(file: string): Promise<Buffer | null> {
  for (const dir of CANDIDATE_DIRS) {
    const full = path.join(dir, file);
    try {
      await fsp.access(full, fs.constants.R_OK);
      return await fsp.readFile(full);
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

async function downloadFont(file: string): Promise<Buffer | null> {
  const target = path.join(os.tmpdir(), `luna-${file}`);
  try {
    const cached = await fsp.readFile(target);
    if (cached.length > 10000) return cached;
  } catch {
    /* not cached yet */
  }
  try {
    const res = await fetch(`${REMOTE_FALLBACK}${file}`, { cache: "no-store" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 10000) return null;
    await fsp.writeFile(target, buf).catch(() => undefined);
    return buf;
  } catch {
    return null;
  }
}

/** Arabic-capable font bytes for the PDF writer (Amiri, OFL licensed). */
export async function loadArabicFont(weight: "regular" | "bold" = "regular"): Promise<Buffer | null> {
  const file = FONT_FILES[weight];
  if (cache.has(file)) return cache.get(file) ?? null;
  const local = await resolveLocal(file);
  const buffer = local ?? (await downloadFont(file));
  cache.set(file, buffer);
  return buffer;
}
