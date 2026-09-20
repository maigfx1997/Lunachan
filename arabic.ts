/**
 * Minimal Arabic shaper + visual reordering, used for PDF generation where no
 * browser shaping engine is available. Converts logical Arabic text into
 * presentation forms and lays it out visually right-to-left.
 */

type Forms = { isolated: number; final?: number; initial?: number; medial?: number };

const FORMS: Record<string, Forms> = {
  "\u0621": { isolated: 0xfe80 },
  "\u0622": { isolated: 0xfe81, final: 0xfe82 },
  "\u0623": { isolated: 0xfe83, final: 0xfe84 },
  "\u0624": { isolated: 0xfe85, final: 0xfe86 },
  "\u0625": { isolated: 0xfe87, final: 0xfe88 },
  "\u0626": { isolated: 0xfe89, final: 0xfe8a, initial: 0xfe8b, medial: 0xfe8c },
  "\u0627": { isolated: 0xfe8d, final: 0xfe8e },
  "\u0628": { isolated: 0xfe8f, final: 0xfe90, initial: 0xfe91, medial: 0xfe92 },
  "\u0629": { isolated: 0xfe93, final: 0xfe94 },
  "\u062a": { isolated: 0xfe95, final: 0xfe96, initial: 0xfe97, medial: 0xfe98 },
  "\u062b": { isolated: 0xfe99, final: 0xfe9a, initial: 0xfe9b, medial: 0xfe9c },
  "\u062c": { isolated: 0xfe9d, final: 0xfe9e, initial: 0xfe9f, medial: 0xfea0 },
  "\u062d": { isolated: 0xfea1, final: 0xfea2, initial: 0xfea3, medial: 0xfea4 },
  "\u062e": { isolated: 0xfea5, final: 0xfea6, initial: 0xfea7, medial: 0xfea8 },
  "\u062f": { isolated: 0xfea9, final: 0xfeaa },
  "\u0630": { isolated: 0xfeab, final: 0xfeac },
  "\u0631": { isolated: 0xfead, final: 0xfeae },
  "\u0632": { isolated: 0xfeaf, final: 0xfeb0 },
  "\u0633": { isolated: 0xfeb1, final: 0xfeb2, initial: 0xfeb3, medial: 0xfeb4 },
  "\u0634": { isolated: 0xfeb5, final: 0xfeb6, initial: 0xfeb7, medial: 0xfeb8 },
  "\u0635": { isolated: 0xfeb9, final: 0xfeba, initial: 0xfebb, medial: 0xfebc },
  "\u0636": { isolated: 0xfebd, final: 0xfebe, initial: 0xfebf, medial: 0xfec0 },
  "\u0637": { isolated: 0xfec1, final: 0xfec2, initial: 0xfec3, medial: 0xfec4 },
  "\u0638": { isolated: 0xfec5, final: 0xfec6, initial: 0xfec7, medial: 0xfec8 },
  "\u0639": { isolated: 0xfec9, final: 0xfeca, initial: 0xfecb, medial: 0xfecc },
  "\u063a": { isolated: 0xfecd, final: 0xfece, initial: 0xfecf, medial: 0xfed0 },
  "\u0641": { isolated: 0xfed1, final: 0xfed2, initial: 0xfed3, medial: 0xfed4 },
  "\u0642": { isolated: 0xfed5, final: 0xfed6, initial: 0xfed7, medial: 0xfed8 },
  "\u0643": { isolated: 0xfed9, final: 0xfeda, initial: 0xfedb, medial: 0xfedc },
  "\u0644": { isolated: 0xfedd, final: 0xfede, initial: 0xfedf, medial: 0xfee0 },
  "\u0645": { isolated: 0xfee1, final: 0xfee2, initial: 0xfee3, medial: 0xfee4 },
  "\u0646": { isolated: 0xfee5, final: 0xfee6, initial: 0xfee7, medial: 0xfee8 },
  "\u0647": { isolated: 0xfee9, final: 0xfeea, initial: 0xfeeb, medial: 0xfeec },
  "\u0648": { isolated: 0xfeed, final: 0xfeee },
  "\u0649": { isolated: 0xfeef, final: 0xfef0 },
  "\u064a": { isolated: 0xfef1, final: 0xfef2, initial: 0xfef3, medial: 0xfef4 },
  "\u0640": { isolated: 0x0640, final: 0x0640, initial: 0x0640, medial: 0x0640 },
  "\u0671": { isolated: 0xfb50, final: 0xfb51 },
  "\u06cc": { isolated: 0xfbfc, final: 0xfbfd, initial: 0xfbfe, medial: 0xfbff },
};

const LAM_ALEF: Record<string, { isolated: number; final: number }> = {
  "\u0622": { isolated: 0xfef5, final: 0xfef6 },
  "\u0623": { isolated: 0xfef7, final: 0xfef8 },
  "\u0625": { isolated: 0xfef9, final: 0xfefa },
  "\u0627": { isolated: 0xfefb, final: 0xfefc },
};

const DIACRITICS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/;
const HARAKAT = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/;

export function isArabicLetter(ch: string): boolean {
  if (/[\u0621-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/.test(ch)) {
    return !!FORMS[ch] || !DIACRITICS.test(ch) || ch === "\u0640";
  }
  return false;
}

function hasDualJoin(ch: string): boolean {
  return !!FORMS[ch]?.initial;
}

function acceptsJoin(ch: string): boolean {
  return isArabicLetter(ch) && !!FORMS[ch] && (FORMS[ch].final !== undefined || FORMS[ch].initial !== undefined);
}

function nextLetter(text: string, index: number): { ch: string; index: number } | null {
  for (let i = index + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (HARAKAT.test(ch)) continue;
    return { ch, index: i };
  }
  return null;
}

function previousLetter(text: string, index: number): string | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = text[i];
    if (HARAKAT.test(ch)) continue;
    return ch;
  }
  return null;
}

/** Converts logical Arabic text to presentation forms (no reordering). */
export function shapeArabic(input: string): string {
  const text = input.normalize("NFC");
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (HARAKAT.test(ch)) {
      out += ch;
      continue;
    }
    if (ch === "\u0644") {
      const next = nextLetter(text, i);
      if (next && LAM_ALEF[next.ch]) {
        const prev = previousLetter(text, i);
        const connectsPrev = !!prev && hasDualJoin(prev);
        const lig = LAM_ALEF[next.ch];
        out += String.fromCharCode(connectsPrev ? lig.final : lig.isolated);
        i = next.index;
        continue;
      }
    }
    const forms = FORMS[ch];
    if (!forms) {
      out += ch;
      continue;
    }
    const prev = previousLetter(text, i);
    const next = nextLetter(text, i);
    const connectPrev = !!prev && hasDualJoin(prev);
    const connectNext = !!next && acceptsJoin(next.ch);

    let code = forms.isolated;
    if (connectPrev && connectNext && forms.medial) code = forms.medial;
    else if (connectPrev && forms.final) code = forms.final;
    else if (connectNext && forms.initial) code = forms.initial;
    out += String.fromCharCode(code);
  }
  return out;
}

const MIRROR: Record<string, string> = {
  "(": ")",
  ")": "(",
  "[": "]",
  "]": "[",
  "{": "}",
  "}": "{",
  "<": ">",
  ">": "<",
  "\u00ab": "\u00bb",
  "\u00bb": "\u00ab",
};

type Direction = "rtl" | "ltr" | "neutral";

function directionOf(ch: string): Direction {
  if (isArabicLetter(ch) || /[\u060c\u061b\u061f\u066a-\u066d]/.test(ch)) return "rtl";
  if (/[A-Za-z\u00c0-\u024f]/.test(ch)) return "ltr";
  if (/[0-9\u0660-\u0669]/.test(ch)) return "ltr";
  return "neutral";
}

/**
 * Lays a shaped string out visually: runs are reordered right-to-left and
 * Arabic runs are reversed, so a simple left-to-right text writer renders the
 * line correctly.
 */
export function visualOrder(logical: string, forceRtl = true): string {
  const shaped = shapeArabic(logical);
  const runs: { dir: Direction; text: string }[] = [];
  let paragraphDir: Direction = forceRtl ? "rtl" : "ltr";

  for (const ch of shaped) {
    const dir = directionOf(ch);
    if (dir !== "neutral" && runs.length === 0) paragraphDir = dir;
    const effective: Direction = dir === "neutral" ? (runs.length ? runs[runs.length - 1].dir : paragraphDir) : dir;
    const last = runs[runs.length - 1];
    if (last && last.dir === effective) last.text += ch;
    else runs.push({ dir: effective, text: ch });
  }

  const ordered = paragraphDir === "rtl" ? [...runs].reverse() : runs;
  return ordered
    .map((run) => {
      if (run.dir === "rtl") return [...run.text].reverse().map((ch) => MIRROR[ch] ?? ch).join("");
      if (run.dir === "ltr") return run.text;
      return [...run.text].map((ch) => MIRROR[ch] ?? ch).join("");
    })
    .join("");
}

export function hasArabic(text: string): boolean {
  return /[\u0600-\u06ff]/.test(text);
}
