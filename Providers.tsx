"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DICTS, LOCALES, directionFor, type Dict, type Locale } from "@/lib/i18n";

type ThemeId = "girl" | "rose" | "mint";

type AppContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Dict;
  dir: "rtl" | "ltr";
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  localeVersion: number;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("ar");
  const [theme, setThemeState] = useState<ThemeId>("girl");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const storedLocale = window.localStorage.getItem("luna.locale") as Locale | null;
    const storedTheme = window.localStorage.getItem("luna.theme") as ThemeId | null;
    if (storedLocale && LOCALES.includes(storedLocale)) setLocaleState(storedLocale);
    if (storedTheme) setThemeState(storedTheme);
    setReady(true);
  }, []);

  useEffect(() => {
    const dir = directionFor(locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
    document.documentElement.dataset.theme = theme;
    if (ready) window.localStorage.setItem("luna.locale", locale);
    if (ready) window.localStorage.setItem("luna.theme", theme);
  }, [locale, theme, ready]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);
  const setTheme = useCallback((next: ThemeId) => setThemeState(next), []);

  const value = useMemo<AppContextValue>(
    () => ({
      locale,
      setLocale,
      t: DICTS[locale],
      dir: directionFor(locale),
      theme,
      setTheme,
      localeVersion: ready ? 1 : 0,
    }),
    [locale, setLocale, theme, setTheme, ready],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

export function useCuteHearts() {
  return useCallback((count = 14) => {
    if (typeof document === "undefined") return;
    const emojis = ["💖", "🌸", "✨", "🎀", "💫", "🌷", "💝", "⭐"];
    for (let i = 0; i < count; i += 1) {
      const node = document.createElement("span");
      node.className = "lc-heart";
      node.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      node.style.left = `${5 + Math.random() * 90}vw`;
      node.style.fontSize = `${16 + Math.random() * 20}px`;
      node.style.animationDuration = `${2.4 + Math.random() * 1.8}s`;
      node.style.animationDelay = `${Math.random() * 0.5}s`;
      document.body.appendChild(node);
      window.setTimeout(() => node.remove(), 4800);
    }
  }, []);
}
