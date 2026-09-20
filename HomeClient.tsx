"use client";

import { useApp } from "./Providers";
import { ImportPanel } from "./ImportPanel";
import { Library } from "./Library";
import type { ApiBook } from "@/lib/client/types";

const FEATURES = [
  { icon: "🖼️", ar: "الغلاف الأصلي", fr: "Couverture originale", en: "Original cover", note: { ar: "بدون أي تغيير أو إعادة ضغط", fr: "Sans recompression", en: "Never re-encoded" } },
  { icon: "📝", ar: "الوصف كامل", fr: "Résumé complet", en: "Full summary", note: { ar: "كما نشره الموقع تمامًا", fr: "Tel que publié", en: "Exactly as published" } },
  { icon: "🔖", ar: "عناوين الفصول", fr: "Titres des chapitres", en: "Chapter titles", note: { ar: "حتى 500 فصل أو أكثر", fr: "Jusqu'à 500+", en: "500+ chapters" } },
  { icon: "🖼️", ar: "الصور داخل الفصول", fr: "Images des chapitres", en: "In-chapter images", note: { ar: "تُدمج داخل الكتاب", fr: "Intégrées au livre", en: "Embedded in book" } },
  { icon: "⚖️", ar: "لوحة الأوزان", fr: "Panneau des poids", en: "Weights panel", note: { ar: "حجم كل صيغة قبل التحميل", fr: "Taille avant téléchargement", en: "Size before download" } },
  { icon: "🚪", ar: "بلا تسجيل دخول", fr: "Sans inscription", en: "No sign-in", note: { ar: "افتحي وحمّلي مباشرة", fr: "Accès direct", en: "Direct access" } },
];

export function HomeClient({ initialBooks }: { initialBooks: ApiBook[] }) {
  const { t, locale } = useApp();

  return (
    <main className="mx-auto max-w-6xl space-y-10 px-4 py-8">
      <section className="lc-card relative overflow-hidden p-6 md:p-10">
        <div className="pointer-events-none absolute -top-24 start-10 h-56 w-56 rounded-full bg-[var(--lc-glow)] blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 end-0 text-6xl opacity-20">🌙✨</div>
        <div className="relative space-y-4">
          <span className="lc-chip">💗 {t.everySite}</span>
          <h1 className="text-[clamp(1.7rem,4vw,3rem)] font-extrabold leading-tight lc-gold-text">{t.heroTitle}</h1>
          <p className="max-w-3xl text-sm leading-8 text-[var(--lc-muted)] md:text-base">{t.heroSubtitle}</p>
          <div className="flex flex-wrap gap-3">
            <a href="#import" className="lc-btn no-underline">
              🎀 {t.pasteButton}
            </a>
            <a href="#formats" className="lc-btn-soft no-underline">
              📦 EPUB • PDF • HTML • TXT • MD • DOCX • FB2 • JSON
            </a>
          </div>
        </div>
      </section>

      <div id="import">
        <ImportPanel />
      </div>

      <section id="formats" className="grid gap-4 md:grid-cols-3">
        {FEATURES.map((feature) => (
          <article key={feature.icon + feature.ar} className="lc-card p-5">
            <span className="text-2xl">{feature.icon}</span>
            <h3 className="mt-2 font-extrabold text-[var(--lc-plum)]">
              {locale === "fr" ? feature.fr : locale === "en" ? feature.en : feature.ar}
            </h3>
            <p className="mt-1 text-xs text-[var(--lc-muted)]">
              {locale === "fr" ? feature.note.fr : locale === "en" ? feature.note.en : feature.note.ar}
            </p>
          </article>
        ))}
      </section>

      <Library initialBooks={initialBooks} />

      <section className="lc-card p-6">
        <h2 className="mb-4 text-xl font-extrabold text-[var(--lc-plum)]">✨ {t.howTo}</h2>
        <ol className="grid gap-4 md:grid-cols-4">
          {[t.step1, t.step2, t.step3, t.step4].map((step, index) => (
            <li key={step} className="rounded-2xl border border-dashed border-[var(--lc-border)] bg-white/70 p-4 text-sm">
              <span className="mb-2 grid h-8 w-8 place-items-center rounded-full bg-[var(--lc-rose-deep)] text-sm font-bold text-white">
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </section>

      <footer className="lc-card space-y-2 p-6 text-center text-xs text-[var(--lc-muted)]">
        <p className="font-bold text-[var(--lc-plum)]">🌙 {t.brand}</p>
        <p>{t.legal}</p>
        <p>{t.footerNote}</p>
      </footer>
    </main>
  );
}
