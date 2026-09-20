/**
 * Parser for legacy `print_r()` style dumps: `array ( 'k' => 'v', 0 => array(…) )`.
 * Some API edge nodes (Wattpad among them) answer with this format instead of
 * JSON; instead of failing the import we decode it.
 */
export function parsePhpDump(input: string): unknown {
  const s = input.trim();
  let i = 0;

  const skipWs = () => {
    while (i < s.length && /\s/.test(s[i])) i += 1;
  };

  const readString = (): string => {
    const quote = s[i];
    i += 1;
    let out = "";
    while (i < s.length) {
      const ch = s[i];
      if (ch === "\\") {
        const next = s[i + 1];
        if (next === "'" || next === '"' || next === "\\") {
          out += next;
          i += 2;
          continue;
        }
        out += ch;
        i += 1;
        continue;
      }
      if (ch === quote) {
        i += 1;
        break;
      }
      out += ch;
      i += 1;
    }
    return out;
  };

  const parseValue = (): unknown => {
    skipWs();
    if (s.startsWith("array", i)) {
      i += 5;
      skipWs();
      if (s[i] === "(") i += 1;
      const entries: Array<[string | number | null, unknown]> = [];
      for (;;) {
        skipWs();
        if (i >= s.length) break;
        if (s[i] === ")") {
          i += 1;
          break;
        }
        const checkpoint = i;
        let key: string | number | null = null;
        if (s[i] === "'" || s[i] === '"') {
          key = readString();
        } else {
          const numericKey = /^-?\d+/.exec(s.slice(i));
          if (numericKey) {
            key = Number(numericKey[0]);
            i += numericKey[0].length;
          }
        }
        skipWs();
        if (s.slice(i, i + 2) === "=>") {
          i += 2;
        } else {
          i = checkpoint;
          key = null;
        }
        const value = parseValue();
        entries.push([key, value]);
        skipWs();
        if (s[i] === ",") {
          i += 1;
          continue;
        }
        if (s[i] === ")") {
          i += 1;
          break;
        }
        if (i >= s.length) break;
        i += 1; // tolerate stray tokens (e.g. *RECURSION*)
      }

      const allNumeric = entries.length > 0 && entries.every(([key]) => typeof key === "number");
      if (allNumeric) {
        const list: unknown[] = [];
        for (const [key, value] of entries) list[key as number] = value;
        return list;
      }
      const object: Record<string, unknown> = {};
      entries.forEach(([key, value], position) => {
        object[key === null ? String(position) : String(key)] = value;
      });
      return object;
    }

    if (s[i] === "'" || s[i] === '"') return readString();

    const number = /^-?\d+(?:\.\d+)?/.exec(s.slice(i));
    if (number) {
      i += number[0].length;
      return Number(number[0]);
    }

    const word = /^[A-Za-z_]+/.exec(s.slice(i))?.[0] ?? "";
    i += word.length || 1;
    if (/^null$/i.test(word)) return null;
    if (/^true$/i.test(word)) return true;
    if (/^false$/i.test(word)) return false;
    return word;
  };

  return parseValue();
}

export function looksLikePhpDump(text: string): boolean {
  return /^\s*array\s*\(/i.test(text);
}

/** Best effort: strict JSON first, then the PHP dump parser. */
export function parseLooseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    /* fall through */
  }
  if (looksLikePhpDump(trimmed)) {
    try {
      return parsePhpDump(trimmed);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
