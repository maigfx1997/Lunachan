<?php
/**
 * لونا تشان — التصدير: EPUB · DOCX · HTML · TXT · Markdown · FB2 · JSON (+ PDF في Pdf.php).
 * الغلاف والصور تُدمج ببايتاتها الأصلية دون أي إعادة ضغط.
 */
final class LunaExport
{
    const FORMATS = ['epub', 'pdf', 'html', 'txt', 'md', 'docx', 'fb2', 'json'];
    const MIME = [
        'epub' => 'application/epub+zip',
        'pdf' => 'application/pdf',
        'html' => 'text/html; charset=utf-8',
        'txt' => 'text/plain; charset=utf-8',
        'md' => 'text/markdown; charset=utf-8',
        'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'fb2' => 'application/xml; charset=utf-8',
        'json' => 'application/json; charset=utf-8',
    ];
    const HEADERS = [
        'ar' => ['chapters' => 'الفصول', 'notes' => 'ملاحظات الاستيراد', 'description' => 'الوصف', 'author' => 'المؤلف', 'source' => 'المصدر', 'unavailable' => 'فصول لم تُقرأ تلقائيًا', 'toc' => 'المحتويات'],
        'fr' => ['chapters' => 'Chapitres', 'notes' => "Notes d'importation", 'description' => 'Résumé', 'author' => 'Auteur', 'source' => 'Source', 'unavailable' => 'Chapitres non récupérés', 'toc' => 'Sommaire'],
        'en' => ['chapters' => 'Chapters', 'notes' => 'Import notes', 'description' => 'Summary', 'author' => 'Author', 'source' => 'Source', 'unavailable' => 'Chapters not retrieved', 'toc' => 'Contents'],
    ];

    public static function extForMime($mime)
    {
        $map = ['image/jpeg' => 'jpg', 'image/jpg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp', 'image/avif' => 'avif', 'image/bmp' => 'bmp', 'image/svg+xml' => 'svg'];
        return isset($map[$mime]) ? $map[$mime] : 'jpg';
    }

    public static function esc($s)
    {
        return htmlspecialchars((string) $s, ENT_QUOTES | ENT_XML1, 'UTF-8');
    }

    private static function lang(array $book)
    {
        $code = substr((string) $book['languageCode'], 0, 2);
        return isset(self::HEADERS[$code]) ? $code : 'ar';
    }

    public static function safeName($title, $id, $ext)
    {
        $base = trim(preg_replace('/\s+/u', ' ', preg_replace('/[\\\\\/:*?"<>|\n\r\t]/u', ' ', (string) $title)));
        $base = mb_substr($base, 0, 70);
        return ($base !== '' ? $base : "book-$id") . " - $id.$ext";
    }

    public static function chapterText(array $chapter)
    {
        $parts = [];
        foreach ($chapter['blocks'] as $b) {
            if ($b['type'] === 'p' || $b['type'] === 'h') $parts[] = $b['text'];
        }
        return trim(preg_replace('/\n{3,}/', "\n\n", implode("\n\n", $parts)));
    }

    /* ------------------------------------------------------------ images */

    public static function jpegInfo($b)
    {
        if (substr($b, 0, 2) !== "\xFF\xD8") return null;
        $len = strlen($b);
        $o = 2;
        while ($o + 9 < $len) {
            if (ord($b[$o]) !== 0xFF) {
                $o++;
                continue;
            }
            $marker = ord($b[$o + 1]);
            if ($marker === 0xD8 || $marker === 0x01 || ($marker >= 0xD0 && $marker <= 0xD7)) {
                $o += 2;
                continue;
            }
            $segLen = (ord($b[$o + 2]) << 8) | ord($b[$o + 3]);
            if ($marker >= 0xC0 && $marker <= 0xCF && $marker !== 0xC4 && $marker !== 0xC8 && $marker !== 0xCC) {
                return ['h' => (ord($b[$o + 5]) << 8) | ord($b[$o + 6]), 'w' => (ord($b[$o + 7]) << 8) | ord($b[$o + 8]), 'c' => ord($b[$o + 9])];
            }
            $o += 2 + $segLen;
        }
        return null;
    }

    public static function dims($bytes, $mime)
    {
        if ($mime === 'image/png' && strlen($bytes) > 24) {
            $w = unpack('N', substr($bytes, 16, 4))[1];
            $h = unpack('N', substr($bytes, 20, 4))[1];
            return [$w, $h];
        }
        if ($mime === 'image/gif' && strlen($bytes) > 10) {
            return [unpack('v', substr($bytes, 6, 2))[1], unpack('v', substr($bytes, 8, 2))[1]];
        }
        if ($mime === 'image/jpeg') {
            $i = self::jpegInfo($bytes);
            if ($i) return [$i['w'], $i['h']];
        }
        if ($mime === 'image/webp' && strlen($bytes) > 30) {
            $chunk = substr($bytes, 12, 4);
            if ($chunk === 'VP8X') {
                $w = 1 + (ord($bytes[24]) | (ord($bytes[25]) << 8) | (ord($bytes[26]) << 16));
                $h = 1 + (ord($bytes[27]) | (ord($bytes[28]) << 8) | (ord($bytes[29]) << 16));
                return [$w, $h];
            }
            if ($chunk === 'VP8 ') return [unpack('v', substr($bytes, 26, 2))[1] & 0x3FFF, unpack('v', substr($bytes, 28, 2))[1] & 0x3FFF];
            if ($chunk === 'VP8L') {
                $bits = unpack('V', substr($bytes, 21, 4))[1];
                return [($bits & 0x3FFF) + 1, (($bits >> 14) & 0x3FFF) + 1];
            }
        }
        if (function_exists('getimagesizefromstring')) {
            $info = @getimagesizefromstring($bytes);
            if ($info) return [(int) $info[0], (int) $info[1]];
        }
        return [0, 0];
    }

    /** Downloads each in-chapter image once, untouched, within a time budget. */
    public static function loadImages(array $chapters, $referer, $budgetSeconds = 40, $maxTotal = 60000000)
    {
        $start = microtime(true);
        $out = [];
        $total = 0;
        foreach ($chapters as $ch) {
            foreach ($ch['blocks'] as $b) {
                if ($b['type'] !== 'img' || isset($out[$b['src']])) continue;
                if (microtime(true) - $start > $budgetSeconds || count($out) >= 400) return $out;
                $bin = LunaHttp::binary($b['src'], $referer);
                if (!$bin['ok'] || strpos($bin['mime'], 'image/') !== 0 || $bin['mime'] === 'image/svg+xml') continue;
                $total += strlen($bin['data']);
                if ($total > $maxTotal) return $out;
                list($w, $h) = self::dims($bin['data'], $bin['mime']);
                $out[$b['src']] = ['bytes' => $bin['data'], 'mime' => $bin['mime'], 'w' => $w, 'h' => $h];
            }
        }
        return $out;
    }

    /* --------------------------------------------------------------- zip */

    /** Minimal ZIP writer: entries = name => data | [data, storeOnly]. */
    public static function zip(array $entries)
    {
        $out = '';
        $cd = '';
        $offset = 0;
        $count = 0;
        $time = 0;
        $date = ((2024 - 1980) << 9) | (1 << 5) | 1;
        foreach ($entries as $name => $spec) {
            list($data, $store) = is_array($spec) ? $spec : [$spec, false];
            $crc = crc32($data);
            $usize = strlen($data);
            $method = 0;
            $cdata = $data;
            if (!$store) {
                $deflated = gzdeflate($data, 6);
                if ($deflated !== false && strlen($deflated) < $usize) {
                    $method = 8;
                    $cdata = $deflated;
                }
            }
            $csize = strlen($cdata);
            $nlen = strlen($name);
            $local = pack('VvvvvvVVVvv', 0x04034b50, 20, 0x0800, $method, $time, $date, $crc, $csize, $usize, $nlen, 0) . $name . $cdata;
            $cd .= pack('VvvvvvvVVVvvvvvVV', 0x02014b50, 20, 20, 0x0800, $method, $time, $date, $crc, $csize, $usize, $nlen, 0, 0, 0, 0, 0, $offset) . $name;
            $out .= $local;
            $offset += strlen($local);
            $count++;
        }
        return $out . $cd . pack('VvvvvVVv', 0x06054b50, 0, 0, $count, $count, strlen($cd), $offset, 0);
    }

    /* ------------------------------------------------------------- build */

    /**
     * @param array $book   public book (title, author, description, languageCode, sourceUrl, id, cover => [bytes,mime]|null)
     * @param array $chapters done chapters with blocks
     * @param array $unavailable [[idx,title],...]
     */
    public static function build(array $book, array $chapters, array $unavailable, $format)
    {
        $book['unavailable'] = $unavailable;
        $ext = $format;
        $filename = self::safeName($book['title'], $book['id'], $ext);
        $mime = self::MIME[$format];
        switch ($format) {
            case 'txt':
                return [$filename, $mime, self::txt($book, $chapters)];
            case 'md':
                return [$filename, $mime, self::md($book, $chapters)];
            case 'html':
                return [$filename, $mime, self::html($book, $chapters)];
            case 'json':
                return [$filename, $mime, self::json($book, $chapters)];
        }
        $images = self::loadImages($chapters, $book['sourceUrl']);
        switch ($format) {
            case 'fb2':
                return [$filename, $mime, self::fb2($book, $chapters, $images)];
            case 'epub':
                return [$filename, $mime, self::epub($book, $chapters, $images)];
            case 'docx':
                return [$filename, $mime, self::docx($book, $chapters, $images)];
            case 'pdf':
                return [$filename, $mime, LunaPdf::build($book, $chapters, $images)];
        }
        throw new RuntimeException('invalid-format');
    }

    private static function notes(array $book, $l)
    {
        if (empty($book['unavailable'])) return [];
        $items = array_map(function ($c) {
            return $c['idx'] . '. ' . $c['title'];
        }, $book['unavailable']);
        return [self::HEADERS[$l]['notes'] . ' — ' . self::HEADERS[$l]['unavailable'] . ': ' . implode(' • ', $items)];
    }

    public static function txt(array $book, array $chapters)
    {
        $l = self::lang($book);
        $H = self::HEADERS[$l];
        $lines = [$book['title']];
        if ($book['author'] !== '') $lines[] = $H['author'] . ': ' . $book['author'];
        $lines[] = $H['source'] . ': ' . $book['sourceUrl'];
        $lines[] = str_repeat('=', 48);
        if ($book['description'] !== '') {
            $lines[] = $H['description'];
            $lines[] = $book['description'];
            $lines[] = '';
        }
        $lines[] = $H['chapters'] . ': ' . count($chapters);
        $lines[] = '';
        foreach ($chapters as $c) {
            $lines[] = '';
            $lines[] = '— ' . $c['idx'] . '. ' . $c['title'] . ' —';
            $lines[] = '';
            $text = self::chapterText($c);
            $lines[] = $text !== '' ? $text : '(فارغ)';
        }
        foreach (self::notes($book, $l) as $n) {
            $lines[] = '';
            $lines[] = str_repeat('=', 48);
            $lines[] = $n;
        }
        return implode("\n", $lines);
    }

    public static function md(array $book, array $chapters)
    {
        $l = self::lang($book);
        $H = self::HEADERS[$l];
        $lines = ['# ' . $book['title'], ''];
        if ($book['author'] !== '') $lines[] = '**' . $H['author'] . ':** ' . $book['author'] . "\n";
        $lines[] = '**' . $H['source'] . ':** ' . $book['sourceUrl'] . "\n";
        if ($book['description'] !== '') $lines[] = '## ' . $H['description'] . "\n\n" . $book['description'] . "\n";
        $lines[] = '## ' . $H['toc'] . "\n";
        foreach ($chapters as $c) $lines[] = $c['idx'] . '. ' . $c['title'];
        $lines[] = '';
        foreach ($chapters as $c) {
            $lines[] = "\n## " . $c['idx'] . '. ' . $c['title'] . "\n";
            foreach ($c['blocks'] as $b) {
                if ($b['type'] === 'p') $lines[] = $b['text'] . "\n";
                elseif ($b['type'] === 'h') $lines[] = '### ' . $b['text'] . "\n";
                else $lines[] = '![' . ($b['alt'] !== '' ? $b['alt'] : 'صورة الفصل') . '](' . $b['src'] . ")\n";
            }
        }
        foreach (self::notes($book, $l) as $n) $lines[] = "\n---\n\n_" . $n . '_';
        return implode("\n", $lines);
    }

    public static function html(array $book, array $chapters)
    {
        $l = self::lang($book);
        $H = self::HEADERS[$l];
        $dir = $l === 'ar' ? 'rtl' : 'ltr';
        $e = [self::class, 'esc'];
        $cover = $book['cover'] ? 'data:' . $book['cover']['mime'] . ';base64,' . base64_encode($book['cover']['bytes']) : '';
        $toc = '';
        $body = '';
        foreach ($chapters as $c) {
            $toc .= '<li><a href="#ch-' . $c['idx'] . '">' . $e($c['title']) . '</a></li>';
            $inner = '';
            foreach ($c['blocks'] as $b) {
                if ($b['type'] === 'p') $inner .= $b['text'] !== '' ? '<p>' . $e($b['text']) . '</p>' : '';
                elseif ($b['type'] === 'h') $inner .= '<h3>' . $e($b['text']) . '</h3>';
                else $inner .= '<figure><img src="' . $e($b['src']) . '" alt="' . $e($b['alt']) . '" referrerpolicy="no-referrer" loading="lazy" /></figure>';
            }
            $body .= '<section class="chapter" id="ch-' . $c['idx'] . '"><h2>' . $c['idx'] . '. ' . $e($c['title']) . '</h2>' . $inner . '</section>';
        }
        $notes = '';
        foreach (self::notes($book, $l) as $n) $notes .= '<p>' . $e($n) . '</p>';
        return '<!doctype html><html lang="' . $l . '" dir="' . $dir . '"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>' . $e($book['title']) . '</title><style>
body{margin:0;background:#fff7fb;color:#2c2030;font-family:"Amiri","Noto Naskh Arabic","Segoe UI",system-ui,sans-serif;line-height:2}
.wrap{max-width:760px;margin:0 auto;padding:32px 20px 80px}header{text-align:center}
.cover{max-width:300px;width:70%;border-radius:14px;box-shadow:0 18px 40px rgba(122,37,84,.18)}
h1{font-size:2rem;margin:18px 0 6px;color:#7a2554}.meta{color:#9b6f86;font-size:.95rem}
.desc{background:#fff;border:1px solid #f6d6e6;border-radius:16px;padding:16px 18px;margin:24px 0;white-space:pre-wrap}
nav.toc a{color:#a03b6e;text-decoration:none}section.chapter{margin-top:42px}
section.chapter h2{color:#7a2554;border-bottom:2px dashed #f2c6dd;padding-bottom:8px}p{margin:0 0 14px}
figure{margin:18px 0;text-align:center}figure img{max-width:100%;border-radius:12px;box-shadow:0 10px 24px rgba(122,37,84,.12)}
.notes{margin-top:48px;font-size:.9rem;color:#9b6f86;border-top:1px solid #f6d6e6;padding-top:14px}
</style></head><body><div class="wrap"><header>' . ($cover ? '<img class="cover" src="' . $cover . '" alt="' . $e($book['title']) . '"/>' : '') .
            '<h1>' . $e($book['title']) . '</h1><div class="meta">' . ($book['author'] !== '' ? $e($H['author']) . ': ' . $e($book['author']) . ' • ' : '') . $e($book['sourceUrl']) . '</div></header>' .
            ($book['description'] !== '' ? '<div class="desc">' . $e($book['description']) . '</div>' : '') .
            '<nav class="toc"><h2>' . $e($H['toc']) . '</h2><ol>' . $toc . '</ol></nav>' . $body .
            ($notes !== '' ? '<div class="notes">' . $notes . '</div>' : '') . '</div></body></html>';
    }

    public static function json(array $book, array $chapters)
    {
        $out = [
            'title' => $book['title'],
            'author' => $book['author'],
            'description' => $book['description'],
            'language' => $book['languageCode'],
            'source' => $book['sourceUrl'],
            'chapterCount' => count($chapters),
            'unavailableChapters' => $book['unavailable'],
            'chapters' => [],
        ];
        foreach ($chapters as $c) {
            $out['chapters'][] = ['index' => $c['idx'], 'title' => $c['title'], 'url' => $c['sourceUrl'], 'blocks' => $c['blocks'], 'text' => self::chapterText($c)];
        }
        return json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_INVALID_UTF8_SUBSTITUTE);
    }

    public static function fb2(array $book, array $chapters, array $images)
    {
        $e = [self::class, 'esc'];
        $binaries = [];
        $ids = [];
        $counter = 0;
        $register = function ($key, $bytes, $mime) use (&$binaries, &$ids, &$counter) {
            if (isset($ids[$key])) return $ids[$key];
            $counter++;
            $id = 'img' . $counter . '.' . self::extForMime($mime);
            $ids[$key] = $id;
            $binaries[] = '<binary id="' . $id . '" content-type="' . $mime . '">' . base64_encode($bytes) . '</binary>';
            return $id;
        };
        $body = '';
        foreach ($chapters as $c) {
            $content = '';
            foreach ($c['blocks'] as $b) {
                if ($b['type'] === 'p') $content .= $b['text'] !== '' ? '<p>' . $e($b['text']) . '</p>' : '';
                elseif ($b['type'] === 'h') $content .= '<subtitle>' . $e($b['text']) . '</subtitle>';
                elseif (isset($images[$b['src']])) $content .= '<image l:href="#' . $register($b['src'], $images[$b['src']]['bytes'], $images[$b['src']]['mime']) . '"/>';
            }
            $body .= '<section><title><p>' . $e($c['idx'] . '. ' . $c['title']) . '</p></title>' . $content . '</section>';
        }
        $coverId = $book['cover'] ? $register('__cover__', $book['cover']['bytes'], $book['cover']['mime']) : '';
        return '<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><genre>novel</genre><author><nickname>' . $e($book['author'] !== '' ? $book['author'] : '—') . '</nickname></author><book-title>' . $e($book['title']) . '</book-title><annotation><p>' . $e($book['description']) . '</p></annotation>' . ($coverId ? '<coverpage><image l:href="#' . $coverId . '"/></coverpage>' : '') . '<lang>' . $e($book['languageCode'] ?: 'ar') . '</lang></title-info><document-info><program-used>Luna Chan</program-used></document-info></description><body>' . $body . '</body>' . implode('', $binaries) . '</FictionBook>';
    }

    private static function xhtmlHead($title, $lang, $dir, $cssPath)
    {
        return '<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="' . $lang . '" lang="' . $lang . '" dir="' . $dir . '"><head><meta charset="utf-8"/><title>' . self::esc($title) . '</title><link rel="stylesheet" type="text/css" href="' . $cssPath . '"/></head><body>';
    }

    private static function imageEntry($url, $mime)
    {
        return 'images/' . substr(sha1($url), 0, 20) . '.' . self::extForMime($mime);
    }

    public static function epub(array $book, array $chapters, array $images)
    {
        $e = [self::class, 'esc'];
        $lang = substr($book['languageCode'], 0, 2) ?: 'ar';
        $dir = $lang === 'ar' ? 'rtl' : 'ltr';
        $entries = ['mimetype' => ['application/epub+zip', true]];
        $entries['META-INF/container.xml'] = '<?xml version="1.0" encoding="utf-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
        $entries['OEBPS/style.css'] = 'body{font-family:"Amiri","Noto Naskh Arabic",serif;line-height:1.9;margin:1.2em;color:#241a26}h1,h2{color:#7a2554;line-height:1.5}p{margin:0 0 .9em}figure{margin:1.2em 0;text-align:center}img{max-width:100%;height:auto;border-radius:8px}.chapter-title{border-bottom:1px solid #f0c8de;padding-bottom:.4em}.meta{color:#9b6f86;font-size:.9em}.cover{text-align:center}.cover img{max-width:100%;max-height:95vh}';

        $coverHref = '';
        if ($book['cover']) {
            $coverHref = 'images/cover.' . self::extForMime($book['cover']['mime']);
            $entries['OEBPS/' . $coverHref] = $book['cover']['bytes'];
            $entries['OEBPS/text/cover.xhtml'] = self::xhtmlHead($book['title'], $lang, $dir, '../style.css') . '<div class="cover"><img src="../' . $coverHref . '" alt="' . $e($book['title']) . '"/></div></body></html>';
        }

        $manifestImages = '';
        $written = [];
        foreach ($chapters as $c) {
            foreach ($c['blocks'] as $b) {
                if ($b['type'] !== 'img' || !isset($images[$b['src']])) continue;
                $target = self::imageEntry($b['src'], $images[$b['src']]['mime']);
                if (isset($written[$target])) continue;
                $written[$target] = true;
                $entries['OEBPS/' . $target] = $images[$b['src']]['bytes'];
                $manifestImages .= '<item id="img-' . substr(sha1($target), 0, 16) . '" href="' . $target . '" media-type="' . $images[$b['src']]['mime'] . '"/>';
            }
        }

        $items = '';
        $spine = '';
        $nav = '';
        $ncx = '';
        foreach ($chapters as $i => $c) {
            $file = sprintf('ch-%03d.xhtml', $c['idx']);
            $inner = '';
            foreach ($c['blocks'] as $b) {
                if ($b['type'] === 'p') $inner .= $b['text'] !== '' ? '<p>' . $e($b['text']) . '</p>' : '';
                elseif ($b['type'] === 'h') $inner .= '<h3>' . $e($b['text']) . '</h3>';
                elseif (isset($images[$b['src']])) $inner .= '<figure><img src="../' . self::imageEntry($b['src'], $images[$b['src']]['mime']) . '" alt="' . $e($b['alt']) . '"/></figure>';
            }
            $entries['OEBPS/text/' . $file] = self::xhtmlHead($c['title'], $lang, $dir, '../style.css') . '<section epub:type="chapter"><h2 class="chapter-title">' . $c['idx'] . '. ' . $e($c['title']) . '</h2>' . $inner . '</section></body></html>';
            $id = sprintf('c-%03d', $c['idx']);
            $items .= '<item id="' . $id . '" href="text/' . $file . '" media-type="application/xhtml+xml"/>';
            $spine .= '<itemref idref="' . $id . '"/>';
            $nav .= '<li><a href="text/' . $file . '">' . $e($c['idx'] . '. ' . $c['title']) . '</a></li>';
            $ncx .= '<navPoint id="nav-' . $c['idx'] . '" playOrder="' . ($i + 1) . '"><navLabel><text>' . $e($c['idx'] . '. ' . $c['title']) . '</text></navLabel><content src="text/' . $file . '"/></navPoint>';
        }

        $entries['OEBPS/text/title.xhtml'] = self::xhtmlHead($book['title'], $lang, $dir, '../style.css') . '<h1>' . $e($book['title']) . '</h1>' . ($book['author'] !== '' ? '<p class="meta">' . $e($book['author']) . '</p>' : '') . ($book['description'] !== '' ? '<p>' . $e($book['description']) . '</p>' : '') . '<nav epub:type="toc" id="toc"><h2>الفصول</h2><ol>' . str_replace('href="text/', 'href="', $nav) . '</ol></nav></body></html>';
        $entries['OEBPS/nav.xhtml'] = self::xhtmlHead('الفصول', $lang, $dir, 'style.css') . '<nav epub:type="toc" id="toc"><h1>الفصول</h1><ol>' . $nav . '</ol></nav></body></html>';
        $entries['OEBPS/toc.ncx'] = '<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="luna-chan-' . $book['id'] . '"/></head><docTitle><text>' . $e($book['title']) . '</text></docTitle><navMap>' . $ncx . '</navMap></ncx>';
        $entries['OEBPS/content.opf'] = '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="' . $lang . '"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">luna-chan-' . $book['id'] . '</dc:identifier><dc:title>' . $e($book['title']) . '</dc:title><dc:language>' . $e($lang) . '</dc:language>' . ($book['author'] !== '' ? '<dc:creator>' . $e($book['author']) . '</dc:creator>' : '') . ($book['description'] !== '' ? '<dc:description>' . $e(mb_substr($book['description'], 0, 900)) . '</dc:description>' : '') . '<dc:source>' . $e($book['sourceUrl']) . '</dc:source><meta property="dcterms:modified">' . gmdate('Y-m-d\TH:i:s\Z') . '</meta>' . ($coverHref ? '<meta name="cover" content="cover-image"/>' : '') . '</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="style.css" media-type="text/css"/><item id="titlepage" href="text/title.xhtml" media-type="application/xhtml+xml"/>' . ($coverHref ? '<item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-image" href="' . $coverHref . '" media-type="' . $book['cover']['mime'] . '" properties="cover-image"/>' : '') . $items . $manifestImages . '</manifest><spine toc="ncx" page-progression-direction="' . $dir . '">' . ($coverHref ? '<itemref idref="cover-page"/>' : '') . '<itemref idref="titlepage"/>' . $spine . '</spine></package>';

        return self::zip($entries);
    }

    private static function docxPara($text, $bold = false, $size = 24)
    {
        return '<w:p><w:pPr><w:bidi w:val="1"/><w:jc w:val="right"/></w:pPr><w:r><w:rPr>' . ($bold ? '<w:b/>' : '') . '<w:rtl w:val="1"/><w:sz w:val="' . $size . '"/></w:rPr><w:t xml:space="preserve">' . self::esc($text) . '</w:t></w:r></w:p>';
    }

    private static function docxImage($relId, $name, $docPrId, $wIn, $hIn)
    {
        $cx = (int) round($wIn * 914400);
        $cy = (int) round($hIn * 914400);
        return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' . $cx . '" cy="' . $cy . '"/><wp:docPr id="' . $docPrId . '" name="' . $name . '"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' . $docPrId . '" name="' . $name . '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' . $relId . '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' . $cx . '" cy="' . $cy . '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    }

    public static function docx(array $book, array $chapters, array $images)
    {
        $media = [];
        $rels = [];
        $rel = 1;
        $body = self::docxPara($book['title'], true, 40);
        if ($book['author'] !== '') $body .= self::docxPara($book['author'], false, 24);
        $body .= self::docxPara($book['sourceUrl'], false, 18);
        if ($book['description'] !== '') $body .= self::docxPara($book['description'], false, 22);

        if ($book['cover']) {
            $name = 'cover.' . self::extForMime($book['cover']['mime']);
            $media[$name] = [$book['cover']['bytes'], $book['cover']['mime']];
            $id = 'rIdImg' . $rel++;
            $rels[$id] = 'media/' . $name;
            list($w, $h) = self::dims($book['cover']['bytes'], $book['cover']['mime']);
            $ratio = ($w && $h) ? $h / $w : 1.5;
            $body .= self::docxImage($id, 'Cover', 1, 3.2, min(7.5, 3.2 * $ratio));
        }
        $docPr = 10;
        foreach ($chapters as $c) {
            $body .= self::docxPara($c['idx'] . '. ' . $c['title'], true, 32);
            foreach ($c['blocks'] as $b) {
                if ($b['type'] === 'p') {
                    if ($b['text'] !== '') $body .= self::docxPara($b['text'], false, 24);
                } elseif ($b['type'] === 'h') {
                    $body .= self::docxPara($b['text'], true, 26);
                } elseif (isset($images[$b['src']])) {
                    $img = $images[$b['src']];
                    $name = 'img' . count($media) . '.' . self::extForMime($img['mime']);
                    $media[$name] = [$img['bytes'], $img['mime']];
                    $id = 'rIdImg' . $rel++;
                    $rels[$id] = 'media/' . $name;
                    $ratio = ($img['w'] && $img['h']) ? $img['h'] / $img['w'] : 1.4;
                    $body .= self::docxImage($id, $name, $docPr++, 4.6, min(7.5, 4.6 * $ratio));
                }
            }
        }
        if (!empty($book['unavailable'])) {
            $body .= self::docxPara('فصول لم تُقرأ تلقائيًا', true, 26);
            foreach ($book['unavailable'] as $u) $body .= self::docxPara($u['idx'] . '. ' . $u['title'], false, 22);
        }

        $defaults = '';
        $seenExt = [];
        foreach ($media as $name => $spec) {
            $ext = pathinfo($name, PATHINFO_EXTENSION);
            if (isset($seenExt[$ext])) continue;
            $seenExt[$ext] = true;
            $defaults .= '<Default Extension="' . $ext . '" ContentType="' . $spec[1] . '"/>';
        }
        $relXml = '';
        foreach ($rels as $id => $target) {
            $relXml .= '<Relationship Id="' . $id . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' . $target . '"/>';
        }
        $entries = [];
        $entries['[Content_Types].xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' . $defaults . '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
        $entries['_rels/.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
        $entries['word/_rels/document.xml.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' . $relXml . '</Relationships>';
        $entries['word/styles.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Amiri" w:hAnsi="Amiri" w:cs="Amiri"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi w:val="1"/><w:jc w:val="right"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';
        $entries['word/document.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' . $body . '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/><w:bidi w:val="1"/></w:sectPr></w:body></w:document>';
        foreach ($media as $name => $spec) $entries['word/media/' . $name] = $spec[0];
        $dump = [];
        foreach ($chapters as $c) $dump[] = $c['idx'] . '. ' . $c['title'] . "\n\n" . self::chapterText($c);
        $entries['README.txt'] = $book['title'] . "\n" . $book['sourceUrl'] . "\n\n" . implode("\n\n========================\n\n", $dump) . "\n";
        return self::zip($entries);
    }

    /* ----------------------------------------------------------- weights */

    public static function weights(array $book, array $chapters, $coverBytes)
    {
        $done = array_values(array_filter($chapters, function ($c) {
            return $c['status'] === 'done';
        }));
        $words = 0;
        $chars = 0;
        $images = 0;
        foreach ($done as $c) {
            $words += $c['wordCount'];
            $chars += $c['charCount'];
            $images += $c['imageCount'];
        }
        $textBytes = (int) round($chars * 1.7);
        $imageBytes = $images * 140 * 1024;
        $titles = count($done) * 90;
        $formats = [
            ['format' => 'txt', 'bytes' => $textBytes + $titles, 'estimated' => false, 'images' => 0],
            ['format' => 'md', 'bytes' => (int) round(($textBytes + $titles) * 1.08), 'estimated' => false, 'images' => 0],
            ['format' => 'html', 'bytes' => (int) round(($textBytes + $titles) * 1.3) + 4096, 'estimated' => false, 'images' => 0],
            ['format' => 'json', 'bytes' => (int) round(($textBytes + $titles) * 0.42), 'estimated' => false, 'images' => 0],
            ['format' => 'fb2', 'bytes' => (int) round(($textBytes + $titles) * 1.35) + $imageBytes, 'estimated' => true, 'images' => $images],
            ['format' => 'epub', 'bytes' => (int) round(($textBytes + $titles) * 1.15) + $imageBytes + $coverBytes + 26 * 1024, 'estimated' => true, 'images' => $images + ($coverBytes ? 1 : 0)],
            ['format' => 'docx', 'bytes' => (int) round(($textBytes + $titles) * 0.55) + $imageBytes + 22 * 1024, 'estimated' => true, 'images' => $images],
            ['format' => 'pdf', 'bytes' => (int) round(($textBytes + $titles) * 0.5) + (int) round($imageBytes * 0.75) + 300 * 1024, 'estimated' => true, 'images' => $images],
        ];
        $total = max(1, $chars);
        $per = [];
        foreach ($chapters as $c) {
            $per[] = ['idx' => $c['idx'], 'title' => $c['title'], 'status' => $c['status'], 'words' => $c['wordCount'], 'chars' => $c['charCount'], 'images' => $c['imageCount'], 'bytes' => (int) round($c['charCount'] * 1.7), 'share' => (int) round($c['charCount'] / $total * 100)];
        }
        $failed = 0;
        foreach ($chapters as $c) {
            if ($c['status'] === 'failed' || $c['status'] === 'empty') $failed++;
        }
        $maxBytes = 0;
        foreach ($formats as $f) $maxBytes = max($maxBytes, $f['bytes']);
        return [
            'totals' => ['chapters' => count($chapters), 'fetched' => count($done), 'failed' => $failed, 'words' => $words, 'chars' => $chars, 'images' => $images, 'readingMinutes' => max(1, (int) round($words / 180)), 'coverBytes' => $coverBytes, 'estimatedBytes' => $maxBytes],
            'formats' => $formats,
            'perChapter' => $per,
        ];
    }
}
