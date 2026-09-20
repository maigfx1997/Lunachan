import { NextResponse } from "next/server";
import { fetchChapterContent } from "@/lib/books";
import { serializeBook, serializeChapter } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; idx: string }> }) {
  const { id, idx } = await params;
  const bookId = Number(id);
  const chapterIdx = Number(idx);
  if (!Number.isFinite(bookId) || !Number.isFinite(chapterIdx)) {
    return NextResponse.json({ error: "invalid-id" }, { status: 400 });
  }

  try {
    const { chapter, book } = await fetchChapterContent(bookId, chapterIdx);
    return NextResponse.json({
      book: serializeBook(book),
      chapter: serializeChapter(chapter),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: code }, { status: code === "not-found" ? 404 : 500 });
  }
}
