"use client";

import Link from "next/link";
import { LOCALE_FLAGS, LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n";
import { useApp } from "./Providers";

const THEMES: { id: "girl" | "rose" | "mint"; swatch: string }[] = [
  { id: "girl", swatch: "linear-gradient(120deg,#b79cf5,#7a2554,#d9b04c)" },
  { id: "rose", swatch: "linear-gradient(120deg,#ff7fa8,#c53a63,#e0a83f)" },
  { id: "mint", swatch: "linear-gradient(120deg,#7fd8c4,#2f8f7c,#d3b25a)" },
];

export function SiteHeader() {
  const { t, locale, setLocale, theme, setTheme } = useApp();

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--lc-border)] bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-3 no-underline">
          <span className="grid h-11 w-11 place-items-center rounded-2xl text-2xl shadow-[0_10px_24px_var(--lc-glow)]" style={{ background: "linear-gradient(135deg,#ffd9ec,#f6dfa4)" }}>
            🌙
          </span>
          <span className="leading-tight">
            <strong className="block text-lg font-extrabold lc-gold-text">{t.brand}</strong>
            <small className="block text-[11px] text-[var(--lc-muted)]">{t.tagline}</small>
          </span>
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border border-[var(--lc-border)] bg-white/80 p-1">
            {LOCALES.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLocale(code as Locale)}
                className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                  locale === code ? "bg-[var(--lc-rose-deep)] text-white shadow" : "text-[var(--lc-plum)] hover:bg-white"
                }`}
                title={LOCALE_LABELS[code]}
              >
                <span className="me-1">{LOCALE_FLAGS[code]}</span>
                {code.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-full border border-[var(--lc-border)] bg-white/80 p-1">
            {THEMES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-label={item.id}
                onClick={() => setTheme(item.id)}
                className={`h-7 w-7 rounded-full border-2 transition ${theme === item.id ? "scale-110 border-[var(--lc-plum)]" : "border-transparent"}`}
                style={{ background: item.swatch }}
              />
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
