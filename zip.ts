import "server-only";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { escapeHtml, escapeXml, type ExportBook, type ExportChapter } from "./types";
import { EXT_BY_MIME, type LoadedImage } from "./assets";
import { chapterText } from "./text";

function uid(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(3, "0")}`;
}

/** Stable, collision-free name for an in-chapter image (URL hashed, never truncated). */
function imageEntryName(url: string, mime: string): string {
  const ext = EXT_BY_MIME[mime] ?? "jpg";
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 20);
  return `images/${hash}.${ext}`;
}

function xhtmlChapter(chapter: ExportChapter, lang: string, dir: string, images: Map<string, LoadedImage>): string {
  const body = chapter.blocks
    .map((block) => {
      if (block.type === "p") return block.text ? `<p>${escapeHtml(block.text)}</p>` : "";
      if (block.type === "h") return `<h3>${escapeHtml(block.text)}</h3>`;
      const image = images.get(block.src);
      if (!image) return "";
      const name = `../${imageEntryName(block.src, image.mime)}`;
      return `<figure><img src="${name}" alt="${escapeHtml(block.alt ?? "")}" /></figure>`;
    })
    .join("\n      ");

  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}" dir="${dir}">
<head><meta charset="utf-8"/><title>${escapeHtml(chapter.title)}</title>
<link rel="stylesheet" type="text/css" href="../style.css"/></head>
<body>
  <section epub:type="chapter">
    <h2 class="chapter-title">${chapter.idx}. ${escapeHtml(chapter.title)}</h2>
    ${body}
  </section>
</body>
</html>`;
}

export async function buildEpub(book: ExportBook, images: Map<string, LoadedImage>): Promise<Buffer> {
  const zip = new JSZip();
  const dir = book.languageCode.slice(0, 2) === "ar" ? "rtl" : "ltr";
  const lang = book.languageCode.slice(0, 2) || "ar";

  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );

  zip.file(
    "OEBPS/style.css",
    `body { font-family: "Amiri","Noto Naskh Arabic",serif; line-height: 1.9; margin: 1.2em; color:#241a26; }
h1,h2 { color:#7a2554; line-height:1.5; }
p { margin: 0 0 0.9em; text-indent: 0; }
figure { margin: 1.2em 0; text-align: center; }
img { max-width: 100%; height: auto; border-radius: 8px; }
.chapter-title { border-bottom: 1px solid #f0c8de; padding-bottom: .4em; }
.meta { color:#9b6f86; font-size: .9em; }
.cover { text-align:center; }
.cover img { max-width: 100%; max-height: 95vh; }`,
  );

  // Original cover, byte-for-byte.
  let coverHref = "";
  let coverMediaType = "";
  if (book.cover) {
    const ext = EXT_BY_MIME[book.cover.mime] ?? "jpg";
    coverHref = `images/cover.${ext}`;
    coverMediaType = book.cover.mime;
    zip.file(`OEBPS/${coverHref}`, book.cover.bytes);
    zip.file(
      "OEBPS/text/cover.xhtml",
      `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}" dir="${dir}">
<head><meta charset="utf-8"/><title>${escapeHtml(book.title)}</title>
<link rel="stylesheet" type="text/css" href="../style.css"/></head>
<body><div class="cover"><img src="../${coverHref}" alt="${escapeHtml(book.title)}"/></div></body>
</html>`,
    );
  }

  // In-chapter images (downloaded untouched).
  const imageManifest: string[] = [];
  const written = new Set<string>();
  for (const chapter of book.chapters) {
    for (const block of chapter.blocks) {
      if (block.type !== "img") continue;
      const image = images.get(block.src);
      if (!image) continue;
      const target = imageEntryName(block.src, image.mime);
      if (written.has(target)) continue;
      written.add(target);
      zip.file(`OEBPS/${target}`, image.bytes);
      imageManifest.push(
        `<item id="img-${createHash("sha1").update(target).digest("hex").slice(0, 16)}" href="${target}" media-type="${image.mime}"/>`,
      );
    }
  }

  const chapterItems: string[] = [];
  const spineItems: string[] = [];
  const navPoints: string[] = [];

  book.chapters.forEach((chapter, index) => {
    const fileName = `${uid("ch", chapter.idx)}.xhtml`;
    zip.file(`OEBPS/text/${fileName}`, xhtmlChapter(chapter, lang, dir, images));
    chapterItems.push(`<item id="${uid("c", chapter.idx)}" href="text/${fileName}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="${uid("c", chapter.idx)}"/>`);
    navPoints.push(`<navPoint id="nav-${chapter.idx}" playOrder="${index + 1}">
      <navLabel><text>${escapeXml(`${chapter.idx}. ${chapter.title}`)}</text></navLabel>
      <content src="text/${fileName}"/>
    </navPoint>`);
  });

  const titlePageHref = "text/title.xhtml";
  zip.file(
    `OEBPS/${titlePageHref}`,
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}" dir="${dir}">
<head><meta charset="utf-8"/><title>${escapeHtml(book.title)}</title>
<link rel="stylesheet" type="text/css" href="../style.css"/></head>
<body>
  <h1>${escapeHtml(book.title)}</h1>
  ${book.author ? `<p class="meta">${escapeHtml(book.author)}</p>` : ""}
  ${book.description ? `<p>${escapeHtml(book.description)}</p>` : ""}
  <nav epub:type="toc" id="toc">
    <h2>الفصول</h2>
    <ol>${book.chapters.map((c) => `<li><a href="${uid("ch", c.idx)}.xhtml">${escapeHtml(`${c.idx}. ${c.title}`)}</a></li>`).join("")}</ol>
  </nav>
</body>
</html>`,
  );

  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}" dir="${dir}">
<head><meta charset="utf-8"/><title>الفصول</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
  <nav epub:type="toc" id="toc"><h1>الفصول</h1>
    <ol>${book.chapters.map((c) => `<li><a href="text/${uid("ch", c.idx)}.xhtml">${escapeHtml(`${c.idx}. ${c.title}`)}</a></li>`).join("")}</ol>
  </nav>
</body>
</html>`,
  );

  zip.file(
    "OEBPS/toc.ncx",
    `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="luna-chan-${book.id}"/></head>
  <docTitle><text>${escapeXml(book.title)}</text></docTitle>
  <navMap>${navPoints.join("\n")}</navMap>
</ncx>`,
  );

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">luna-chan-${book.id}</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    <dc:language>${escapeXml(lang)}</dc:language>
    ${book.author ? `<dc:creator>${escapeXml(book.author)}</dc:creator>` : ""}
    ${book.description ? `<dc:description>${escapeXml(book.description.slice(0, 900))}</dc:description>` : ""}
    <dc:source>${escapeXml(book.sourceUrl)}</dc:source>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
    ${coverHref ? `<meta name="cover" content="cover-image"/>` : ""}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="titlepage" href="${titlePageHref}" media-type="application/xhtml+xml"/>
    ${coverHref ? `<item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-image" href="${coverHref}" media-type="${coverMediaType}" properties="cover-image"/>` : ""}
    ${chapterItems.join("\n    ")}
    ${imageManifest.join("\n    ")}
  </manifest>
  <spine toc="ncx" page-progression-direction="${dir === "rtl" ? "rtl" : "ltr"}">
    ${coverHref ? '<itemref idref="cover-page"/>' : ""}
    <itemref idref="titlepage"/>
    ${spineItems.join("\n    ")}
  </spine>
</package>`,
  );

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export async function buildDocx(book: ExportBook, images: Map<string, LoadedImage>): Promise<Buffer> {
  const zip = new JSZip();
  const media: { name: string; bytes: Buffer; mime: string }[] = [];
  const rels: { id: string; target: string }[] = [];
  let relCounter = 1;

  const paragraph = (text: string, options: { bold?: boolean; size?: number; rtl?: boolean } = {}) => {
    const rtl = options.rtl ?? true;
    return `<w:p><w:pPr><w:bidi w:val="${rtl ? "1" : "0"}"/><w:jc w:val="${rtl ? "right" : "left"}"/>${
      options.size ? `<w:rPr><w:sz w:val="${options.size}"/></w:rPr>` : ""
    }</w:pPr><w:r><w:rPr>${options.bold ? "<w:b/>" : ""}<w:rtl w:val="${rtl ? "1" : "0"}"/>${
      options.size ? `<w:sz w:val="${options.size}"/>` : ""
    }</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  };

  const bodyParts: string[] = [];
  bodyParts.push(paragraph(book.title, { bold: true, size: 40 }));
  if (book.author) bodyParts.push(paragraph(book.author, { size: 24 }));
  if (book.sourceUrl) bodyParts.push(paragraph(book.sourceUrl, { size: 18 }));
  if (book.description) {
    bodyParts.push(paragraph(book.description, { size: 22 }));
  }

  if (book.cover) {
    const ext = EXT_BY_MIME[book.cover.mime] ?? "jpg";
    const name = `cover.${ext}`;
    media.push({ name, bytes: book.cover.bytes, mime: book.cover.mime });
    const relId = `rIdImg${relCounter++}`;
    rels.push({ id: relId, target: `media/${name}` });
    const width = 3.2;
    const height = width * 1.5;
    bodyParts.push(
      `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${Math.round(
        width * 914400,
      )}" cy="${Math.round(height * 914400)}"/><wp:docPr id="1" name="Cover"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="Cover"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(
        width * 914400,
      )}" cy="${Math.round(height * 914400)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
    );
  }

  for (const chapter of book.chapters) {
    bodyParts.push(paragraph(`${chapter.idx}. ${chapter.title}`, { bold: true, size: 32 }));
    for (const block of chapter.blocks) {
      if (block.type === "p") {
        if (block.text) bodyParts.push(paragraph(block.text, { size: 24 }));
        continue;
      }
      if (block.type === "h") {
        bodyParts.push(paragraph(block.text, { bold: true, size: 26 }));
        continue;
      }
      const image = images.get(block.src);
      if (!image) continue;
      const ext = EXT_BY_MIME[image.mime] ?? "jpg";
      const name = `img${media.length}.${ext}`;
      media.push({ name, bytes: image.bytes, mime: image.mime });
      const relId = `rIdImg${relCounter++}`;
      rels.push({ id: relId, target: `media/${name}` });
      const maxWidthInches = 4.6;
      const ratio = image.width && image.height ? image.height / image.width : 1.4;
      const width = maxWidthInches;
      const height = Math.min(7.5, width * ratio);
      bodyParts.push(
        `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${Math.round(
          width * 914400,
        )}" cy="${Math.round(height * 914400)}"/><wp:docPr id="${media.length + 10}" name="${name}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${
          media.length + 10
        }" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(
          width * 914400,
        )}" cy="${Math.round(height * 914400)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
      );
    }
  }

  if (book.unavailable.length) {
    bodyParts.push(paragraph("فصول لم تُقرأ تلقائيًا", { bold: true, size: 26 }));
    for (const chapter of book.unavailable) {
      bodyParts.push(paragraph(`${chapter.idx}. ${chapter.title}`, { size: 22 }));
    }
  }

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${media
    .map((item) => `<Default Extension="${item.name.split(".").pop()}" ContentType="${item.mime}"/>`)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join("\n  ")}
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );

  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  ${rels
    .map(
      (rel) =>
        `<Relationship Id="${rel.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${rel.target}"/>`,
    )
    .join("\n  ")}
</Relationships>`,
  );

  zip.file(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Amiri" w:hAnsi="Amiri" w:cs="Amiri"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>
  <w:pPrDefault><w:pPr><w:bidi w:val="1"/><w:jc w:val="right"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>`,
  );

  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    ${bodyParts.join("\n    ")}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/><w:bidi w:val="1"/></w:sectPr>
  </w:body>
</w:document>`,
  );

  for (const item of media) {
    zip.file(`word/media/${item.name}`, item.bytes);
  }

  // Plain-text copy so the chapter text is always reachable/searchable.
  const textDump = book.chapters
    .map((chapter) => `${chapter.idx}. ${chapter.title}\n\n${chapterText(chapter)}`)
    .join("\n\n========================\n\n");
  zip.file("README.txt", `${book.title}\n${book.sourceUrl}\n\n${textDump}\n`);

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
