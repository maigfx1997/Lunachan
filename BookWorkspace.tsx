"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp, useCuteHearts } from "./Providers";
import {
  coverSrc,
  fetchChapter,
  loadChapter,
  proxiedImage,
  retryFailed,
  runFetchLoop,
  type PipelineProgress,
} from "@/lib/client/pipeline";
import { FORMAT_META, type ApiBook, type ApiChapter, type ApiWeights, type Block } from "@/lib/client/types";
import { formatBytes } from "@/lib/weights-format";

type Tab = "reader" | "weights" | "export";

function statusTone(status: string): string {
  if (status === "done") return "bg-emerald-100 text-emerald-700";
  if (status === "failed") return "bg-rose-100 text-rose-700";
  if (status === "fetching") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

export function BookWorkspace({ initialBook, initialChapters }: { initialBook: ApiBook; initialChapters: ApiChapter[] }) {
  const { t, locale } = useApp();
  const popHearts = useCuteHearts();

  const [book, setBook] = useState(initialBook);
  const [chapters, setChapters] = useState(initialChapters);
  const [tab, setTab] = useState<Tab>("reader");
  const [weights, setWeights] = useState<ApiWeights | null>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(initialChapters.find((c) => c.status === "done")?.idx ?? null);
  const [content, setContent] = useState<ApiChapter | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [flash, setFlash] = useState("");

  const pendingIdx = useMemo(() => chapters.filter((chapter) => chapter.status === "pending" || chapter.status === "fetching").map((c) => c.idx), [chapters]);
  const failedIdx = useMemo(() => chapters.filter((chapter) => chapter.status === "failed" || chapter.status === "empty").map((c) => c.idx), [chapters]);
  const doneCount = chapters.filter((chapter) => chapter.status === "done").length;

  const reloadWeights = useCallback(async () => {
    const res = await fetch(`/api/books/${book.id}/weights`, { cache: "no-store" });
    if (res.ok) setWeights((await res.json()) as ApiWeights);
  }, [book.id]);

  useEffect(() => {
    void reloadWeights();
  }, [reloadWeights, doneCount]);

  const loadChapterContent = useCallback(
    async (idx: number) => {
      setActiveIdx(idx);
      setLoadingContent(true);
      try {
        const chapter = await loadChapter(book.id, idx);
        setContent(chapter);
      } catch {
        setContent(null);
      } finally {
        setLoadingContent(false);
      }
    },
    [book.id],
  );

  useEffect(() => {
    if (activeIdx !== null) void loadChapterContent(activeIdx);
  }, [activeIdx, loadChapterContent]);

  const runPending = useCallback(
    async (indexes: number[]) => {
      if (indexes.length === 0) return;
      setRunning(true);
      setProgress({ total: indexes.length, done: 0, failed: 0, currentIndex: indexes[0] });
      setFlash(t.fetchingNow);
      await runFetchLoop(book.id, indexes, {
        concurrency: 3,
        onBook: (fresh) => setBook(fresh),
        onTick: (chapter, next) => {
          setProgress(next);
          if (chapter.id > 0) {
            setChapters((previous) => {
              const others = previous.filter((item) => item.idx !== chapter.idx);
              return [...others, chapter].sort((a, b) => a.idx - b.idx);
            });
          }
          if (next.done % 4 === 0) popHearts(3);
        },
      });
      setRunning(false);
      popHearts(18);
      setFlash(t.done);
      const res = await fetch(`/api/books/${book.id}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { book: ApiBook; chapters: ApiChapter[] };
        setBook(data.book);
        setChapters(data.chapters);
      }
      window.setTimeout(() => setFlash(""), 2500);
    },
    [book.id, popHearts, t],
  );

  const handleResume = () => void runPending(pendingIdx);
  const handleRetry = async () => {
    const result = await retryFailed(book.id);
    setBook(result.book);
    if (result.chapters.length) setChapters(result.chapters);
    await runPending(failedIdx);
  };

  const percent = chapters.length ? Math.round((doneCount / chapters.length) * 100) : 0;
  const maxFormatBytes = weights ? Math.max(...weights.formats.map((f) => f.bytes), 1) : 1;
  const sorted = weights ? [...weights.perChapter].sort((a, b) => b.bytes - a.bytes) : [];
  const heaviest = sorted[0];
  const lightest = sorted[sorted.length - 1];

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <Link href="/" className="lc-btn-soft inline-block text-xs no-underline">
        ← {t.brand}
      </Link>

      <section className="lc-card grid gap-6 p-6 md:grid-cols-[220px_1fr]">
        <div className="space-y-3">
          {book.hasCover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverSrc(book.id)} alt={t.cover} className="w-full rounded-3xl object-cover shadow-[0_18px_40px_rgba(122,37,84,0.22)]" />
          ) : (
            <div className="grid aspect-[3/4] w-full place-items-center rounded-3xl bg-white/70 text-5xl">🌷</div>
          )}
          <span className="lc-chip block text-center">🖼️ {t.cover}: {t.measured}</span>
        </div>

        <div className="space-y-4">
          <h1 className="text-2xl font-extrabold lc-gold-text">{book.title}</h1>
          <p className="text-sm text-[var(--lc-muted)]">
            ✍️ {book.author || "—"}
            {book.description ? "" : ""}
          </p>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="lc-chip">📚 {chapters.length} {t.chapters}</span>
            <span className="lc-chip">✅ {doneCount} {t.fetchedChapters}</span>
            {failedIdx.length > 0 && <span className="lc-chip">💔 {failedIdx.length}</span>}
            <span className="lc-chip">
              🔗{" "}
              <a href={book.sourceUrl} target="_blank" rel="noreferrer noopener" className="no-underline">
                {t.sourceUrl}
              </a>
            </span>
          </div>

          <div className="lc-progress">
            <span style={{ width: `${Math.max(percent, 3)}%` }} />
          </div>
          <p className="text-xs text-[var(--lc-muted)]">
            {doneCount} {t.of} {chapters.length} • {percent}%
          </p>

          <div>
            <h2 className="mb-1 text-sm font-extrabold text-[var(--lc-plum)]">📝 {t.description}</h2>
            <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--lc-ink)]/85">
              {book.description || t.noDescription}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {pendingIdx.length > 0 && (
              <button type="button" className="lc-btn" onClick={handleResume} disabled={running}>
                {running ? t.fetchingNow : `💞 ${t.resume} (${pendingIdx.length})`}
              </button>
            )}
            {failedIdx.length > 0 && (
              <button type="button" className="lc-btn-soft" onClick={() => void handleRetry()} disabled={running}>
                ♻️ {t.retryFailed}
              </button>
            )}
          </div>

          {flash && <p className="rounded-2xl bg-white/80 p-3 text-center text-sm font-bold text-[var(--lc-rose-deep)]">{flash}</p>}
          {progress && running && (
            <div className="space-y-2">
              <div className="lc-progress">
                <span style={{ width: `${Math.round(((progress.done + progress.failed) / Math.max(progress.total, 1)) * 100)}%` }} />
              </div>
              <p className="text-xs text-[var(--lc-muted)]">
                {t.fetchingChapter} #{progress.currentIndex} • {progress.done}/{progress.total}
                {progress.failed > 0 ? ` • 💔 ${progress.failed}` : ""}
              </p>
            </div>
          )}
        </div>
      </section>

      <nav className="flex flex-wrap gap-2">
        {(
          [
            { id: "reader", label: `👀 ${t.readerTitle}` },
            { id: "weights", label: `⚖️ ${t.weightsTitle}` },
            { id: "export", label: `📦 ${t.exportTitle}` },
          ] as { id: Tab; label: string }[]
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={tab === item.id ? "lc-btn text-sm" : "lc-btn-soft text-sm"}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "reader" && (
        <section className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <div className="lc-card lc-scroll max-h-[70vh] overflow-y-auto p-3">
            <h2 className="px-2 py-2 text-sm font-extrabold text-[var(--lc-plum)]">🔖 {t.chapters}</h2>
            <ul className="space-y-1">
              {chapters.map((chapter) => (
                <li key={chapter.idx}>
                  <button
                    type="button"
                    onClick={() => void loadChapterContent(chapter.idx)}
                    className={`w-full rounded-2xl px-3 py-2 text-start text-xs transition ${
                      activeIdx === chapter.idx ? "bg-[var(--lc-rose-deep)] text-white" : "hover:bg-white"
                    }`}
                  >
                    <span className="block truncate font-bold">
                      {chapter.idx}. {chapter.title || t.chapter}
                    </span>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] ${statusTone(chapter.status)}`}>
                      {chapter.status === "done" ? `✅ ${chapter.wordCount} ${t.words}` : chapter.status === "failed" ? `💔 ${t.statusFailed}` : `⏳ ${t.statusPending}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="lc-card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-extrabold text-[var(--lc-plum)]">
                {content ? `${content.idx}. ${content.title}` : t.selectChapter}
              </h2>
              {content && content.imageCount > 0 && (
                <span className="lc-chip">🖼️ {content.imageCount} {t.imagesInChapter}</span>
              )}
            </div>
            <p className="mb-4 text-xs text-[var(--lc-muted)]">💡 {t.readerHint}</p>

            {loadingContent ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="lc-skeleton h-4 rounded-full" />
                ))}
              </div>
            ) : !content ? (
              <div className="space-y-3 text-sm">
                <p className="text-[var(--lc-muted)]">{t.noContentYet}</p>
                {activeIdx !== null && !running && (
                  <button type="button" className="lc-btn" onClick={() => void runPending([activeIdx])}>
                    🎀 {t.fetchThisChapter}
                  </button>
                )}
              </div>
            ) : content.status !== "done" ? (
              <div className="space-y-3 text-sm">
                <p className="rounded-2xl bg-amber-50 p-3 text-amber-700">
                  🥺 {content.status === "failed" ? t.chapterFailed : t.noContentYet}
                  {content.error ? ` (${content.error})` : ""}
                </p>
                <button type="button" className="lc-btn" onClick={() => void runPending([content.idx])} disabled={running}>
                  ♻️ {t.fetchThisChapter}
                </button>
              </div>
            ) : (
              <article className="lc-reader lc-scroll max-h-[65vh] space-y-2 overflow-y-auto pe-2">
                {content.blocks.length === 0 && (content.plainText ?? "") === "" && (
                  <p className="text-sm text-[var(--lc-muted)]">{t.noContentYet}</p>
                )}
                {(content.blocks.length ? content.blocks : content.plainText.split("\n").map((text) => ({ type: "p" as const, text }))).map(
                  (block: Block, index) =>
                    block.type === "img" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={`${block.src}-${index}`}
                        src={proxiedImage(block.src, book.sourceUrl)}
                        alt={block.alt ?? ""}
                        loading="lazy"
                        className="mx-auto my-4 max-h-[60vh] rounded-2xl shadow-[0_14px_32px_rgba(122,37,84,0.18)]"
                      />
                    ) : block.type === "h" ? (
                      <h3 key={index} className="pt-3 text-base font-extrabold text-[var(--lc-plum)]">
                        {block.text}
                      </h3>
                    ) : (
                      block.text.trim() && <p key={index}>{block.text}</p>
                    ),
                )}
              </article>
            )}
          </div>
        </section>
      )}

      {tab === "weights" && (
        <section className="space-y-4">
          <div className="lc-card p-5">
            <h2 className="text-xl font-extrabold text-[var(--lc-plum)]">⚖️ {t.weightsTitle}</h2>
            <p className="mt-1 text-xs text-[var(--lc-muted)]">{t.weightsSubtitle}</p>

            <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: t.totalChapters, value: weights?.totals.chapters ?? chapters.length, icon: "📚" },
                { label: t.fetchedChapters, value: weights?.totals.fetched ?? doneCount, icon: "✅" },
                { label: t.words, value: (weights?.totals.words ?? 0).toLocaleString(locale), icon: "🔤" },
                { label: t.images, value: weights?.totals.images ?? 0, icon: "🖼️" },
                { label: t.readingTime, value: weights?.totals.readingMinutes ?? 0, icon: "⏱️" },
                { label: t.cover, value: formatBytes(weights?.totals.coverBytes ?? 0), icon: "💝" },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-[var(--lc-border)] bg-white/70 p-3 text-center">
                  <span className="text-xl">{item.icon}</span>
                  <p className="mt-1 text-lg font-extrabold text-[var(--lc-plum)]">{item.value}</p>
                  <p className="text-[11px] text-[var(--lc-muted)]">{item.label}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 space-y-2">
              {(weights?.formats ?? FORMAT_META.map((meta) => ({ format: meta.id, bytes: 0, estimated: true, images: 0 }))).map((row) => (
                <div key={row.format} className="flex items-center gap-3 text-xs">
                  <span className="w-24 shrink-0 font-bold text-[var(--lc-plum)]">
                    {FORMAT_META.find((meta) => meta.id === row.format)?.icon} {row.format.toUpperCase()}
                  </span>
                  <span className="h-3 flex-1 overflow-hidden rounded-full bg-white/70">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max(4, Math.round((row.bytes / maxFormatBytes) * 100))}%`,
                        background: "linear-gradient(90deg,var(--lc-rose),var(--lc-gold),var(--lc-lav))",
                      }}
                    />
                  </span>
                  <span className="w-20 shrink-0 text-end font-bold">{formatBytes(row.bytes)}</span>
                  <span className="w-16 shrink-0 text-end text-[10px] text-[var(--lc-muted)]">
                    {row.estimated ? `≈ ${t.estimated}` : `📐 ${t.measured}`}
                  </span>
                </div>
              ))}
            </div>

            {heaviest && lightest && (
              <p className="mt-4 text-xs text-[var(--lc-muted)]">
                🏋️ {t.heaviest}: <b>{heaviest.idx}. {heaviest.title}</b> ({formatBytes(heaviest.bytes)}) • 🪶 {t.lightest}:{" "}
                <b>{lightest.idx}. {lightest.title}</b> ({formatBytes(lightest.bytes)})
              </p>
            )}
          </div>

          <div className="lc-card lc-scroll max-h-[60vh] overflow-auto p-5">
            <h3 className="mb-3 text-sm font-extrabold text-[var(--lc-plum)]">🔖 {t.chapterWeights}</h3>
            <table className="w-full text-xs">
              <thead className="text-[var(--lc-muted)]">
                <tr>
                  <th className="p-2 text-start">#</th>
                  <th className="p-2 text-start">{t.chapters}</th>
                  <th className="p-2">{t.words}</th>
                  <th className="p-2">{t.images}</th>
                  <th className="p-2">{t.size}</th>
                  <th className="p-2">{t.share}</th>
                </tr>
              </thead>
              <tbody>
                {(weights?.perChapter ?? []).map((row) => (
                  <tr key={row.idx} className="border-t border-[var(--lc-border)]">
                    <td className="p-2 font-bold">{row.idx}</td>
                    <td className="max-w-[240px] truncate p-2">{row.title}</td>
                    <td className="p-2 text-center">{row.words}</td>
                    <td className="p-2 text-center">{row.images}</td>
                    <td className="p-2 text-center">{formatBytes(row.bytes)}</td>
                    <td className="p-2 text-center">{row.share}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "export" && (
        <section className="space-y-4">
          <div className="lc-card p-5">
            <h2 className="text-xl font-extrabold text-[var(--lc-plum)]">📦 {t.exportTitle}</h2>
            <p className="mt-1 text-xs text-[var(--lc-muted)]">{t.exportSubtitle}</p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {FORMAT_META.map((meta) => {
                const weight = weights?.formats.find((row) => row.format === meta.id);
                const disabled = doneCount === 0 || (meta.id === "pdf" && !weights?.totals.fetched);
                return (
                  <a
                    key={meta.id}
                    href={disabled ? undefined : `/api/books/${book.id}/export?format=${meta.id}`}
                    className={`lc-card block p-4 no-underline transition ${disabled ? "pointer-events-none opacity-50" : "hover:-translate-y-1"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-2xl">{meta.icon}</span>
                      <span className={`rounded-full bg-gradient-to-r ${meta.accent} px-2 py-0.5 text-[10px] font-bold text-white`}>{meta.label}</span>
                    </div>
                    <p className="mt-2 text-xs text-[var(--lc-muted)]">
                      {locale === "fr" ? meta.note.fr : locale === "en" ? meta.note.en : meta.note.ar}
                    </p>
                    <p className="mt-2 text-sm font-extrabold text-[var(--lc-plum)]">
                      ⬇️ {t.download} • {formatBytes(weight?.bytes ?? 0)}
                    </p>
                  </a>
                );
              })}
            </div>

            {(weights?.totals.failed ?? 0) > 0 && (
              <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-xs text-amber-700">💔 {t.unavailableNote}</p>
            )}
            <p className="mt-3 text-[11px] text-[var(--lc-muted)]">
              🎀 {t.poweredBy} • {t.legal}
            </p>
          </div>

          <div className="lc-card p-5 text-xs text-[var(--lc-muted)]">
            <h3 className="mb-2 text-sm font-extrabold text-[var(--lc-plum)]">🔗 {t.sourceUrl}</h3>
            <a href={book.sourceUrl} target="_blank" rel="noreferrer noopener" className="break-all">
              {book.sourceUrl}
            </a>
          </div>
        </section>
      )}
    </main>
  );
}


