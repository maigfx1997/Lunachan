import { notFound } from "next/navigation";
import { getBookWithChapters } from "@/lib/books";
import { serializeBook, serializeChapter } from "@/lib/serialize";
import { BookWorkspace } from "@/components/BookWorkspace";

export const dynamic = "force-dynamic";

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bookId = Number(id);
  if (!Number.isFinite(bookId)) notFound();

  try {
    const { book, chapters } = await getBookWithChapters(bookId);
    return (
      <BookWorkspace
        initialBook={serializeBook(book)}
        initialChapters={chapters.map((chapter) => serializeChapter(chapter))}
      />
    );
  } catch {
    notFound();
  }
}
