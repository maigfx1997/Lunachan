<?php
/**
 * لونا تشان — تحليل HTML وتنظيفه (DOMDocument + XPath).
 * يستخرج نص الفصل وصوره فقط، ويستبعد الإعلانات والقوائم والتعليقات.
 */
final class LunaDom
{
    const JUNK_TAGS = ['script', 'style', 'noscript', 'iframe', 'form', 'button', 'nav', 'aside', 'header', 'footer', 'svg', 'video', 'audio', 'ins', 'canvas', 'select', 'input', 'textarea'];
    const JUNK_CLASS = '/(advert|google-ad|google_ads|sponsor|promo|banner-ad|share|social|comment|disqus|rating|breadcrumb|pagination|newsletter|notification|cookie|popup|modal|toolbar|menu|sidebar|related|recommend|login|register|favicon|avatar|logo|chapter-header|chapter-nav|chapter-footer|chapter-meta|navigation|pager|controls)/i';
    const NOISE_LINE = '/^(?:الفصل|الجزء|chapter|chapitre|part|episode)\s*(?:السابق|التالي|previous|next|précédent|suivant)?\s*$/iu';
    const NOISE_EXACT = '/^(?:السابق|التالي|الفصل السابق|الفصل التالي|مشاركة|الإبلاغ|إبلاغ|تعليقات|رد|إعجاب|views?|likes?|comments?|share|report|next|previous|prev|next chapter|previous chapter|chapter list|فهرس الفصول|قائمة الفصول|<|>)$/iu';
    const NON_CHAPTER_LABEL = '/(ابدأ القراءة|أبدأ القراءة|اقرأ الآن|اقرأي|متابعة القراءة|الصفحة التالية|السابق|التالي|start reading|read now|continue reading|next chapter|previous chapter|login|sign in|register|share|comments?)/iu';

    /** @return array{0: DOMDocument, 1: DOMXPath} */
    public static function load($html)
    {
        $doc = new DOMDocument('1.0', 'UTF-8');
        libxml_use_internal_errors(true);
        $clean = (string) mb_convert_encoding((string) $html, 'UTF-8', 'UTF-8');
        $prepared = mb_encode_numericentity($clean, [0x80, 0x10FFFF, 0, 0x1FFFFF], 'UTF-8');
        if ($prepared === false || $prepared === '') {
            $prepared = '<html><body></body></html>';
        }
        $doc->loadHTML($prepared, LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_NONET);
        libxml_clear_errors();
        return [$doc, new DOMXPath($doc)];
    }

    public static function q(DOMXPath $xp, $expr, DOMNode $ctx = null)
    {
        $list = $ctx ? @$xp->query($expr, $ctx) : @$xp->query($expr);
        $out = [];
        if ($list) {
            foreach ($list as $n) {
                $out[] = $n;
            }
        }
        return $out;
    }

    public static function first(DOMXPath $xp, $expr, DOMNode $ctx = null)
    {
        $r = self::q($xp, $expr, $ctx);
        return $r ? $r[0] : null;
    }

    public static function textOf($node)
    {
        return $node ? self::normalize($node->textContent) : '';
    }

    public static function attr($node, $name)
    {
        return ($node instanceof DOMElement) ? (string) $node->getAttribute($name) : '';
    }

    public static function meta(DOMXPath $xp, array $names)
    {
        foreach ($names as $n) {
            foreach (["//meta[@property='$n']", "//meta[@name='$n']"] as $e) {
                $node = self::first($xp, $e);
                if ($node) {
                    $v = self::normalize(self::attr($node, 'content'));
                    if ($v !== '') {
                        return $v;
                    }
                }
            }
        }
        return '';
    }

    public static function jsonLd(DOMXPath $xp)
    {
        $out = [];
        foreach (self::q($xp, "//script[@type='application/ld+json']") as $s) {
            $raw = trim($s->textContent);
            if ($raw === '') {
                continue;
            }
            $p = json_decode($raw, true);
            if (!is_array($p)) {
                continue;
            }
            $stack = [$p];
            while ($stack) {
                $v = array_pop($stack);
                if (!is_array($v)) {
                    continue;
                }
                if (array_keys($v) === range(0, count($v) - 1)) {
                    foreach ($v as $item) {
                        $stack[] = $item;
                    }
                } else {
                    $out[] = $v;
                    if (isset($v['@graph'])) {
                        $stack[] = $v['@graph'];
                    }
                }
            }
        }
        return $out;
    }

    private static function re($pattern, $repl, $s)
    {
        $r = preg_replace($pattern, $repl, $s);
        return $r === null ? $s : $r;
    }

    public static function normalize($s)
    {
        $s = str_replace("\xC2\xA0", ' ', (string) $s);
        $s = self::re('/[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', '', $s);
        $s = self::re('/[ \t]{2,}/', ' ', $s);
        $s = self::re('/\s*\n\s*/', "\n", $s);
        $s = self::re('/\n{3,}/', "\n\n", $s);
        return trim($s);
    }

    public static function sanitizeTitle($s)
    {
        return trim(self::re('/^[\s\-–—:_.]+|[\s\-–—:_.]+$/u', '', self::normalize($s)));
    }

    public static function stripSuffix($title, array $suffixes)
    {
        $out = $title;
        foreach ($suffixes as $sfx) {
            $out = self::re('/\s*[-–|—:]\s*' . preg_quote($sfx, '/') . '\s*$/iu', '', $out);
        }
        return self::normalize($out);
    }

    public static function absolute($url, $base)
    {
        $url = trim((string) $url);
        if ($url === '' || stripos($url, 'data:') === 0 || stripos($url, 'javascript:') === 0 || $url[0] === '#') {
            return '';
        }
        if (preg_match('#^[a-z][a-z0-9+.\-]*://#i', $url)) {
            return $url;
        }
        $b = parse_url((string) $base);
        if (!$b || empty($b['scheme']) || empty($b['host'])) {
            return '';
        }
        $origin = $b['scheme'] . '://' . $b['host'] . (isset($b['port']) ? ':' . $b['port'] : '');
        if (strpos($url, '//') === 0) {
            return $b['scheme'] . ':' . $url;
        }
        $basePath = isset($b['path']) && $b['path'] !== '' ? $b['path'] : '/';
        if ($url[0] === '/') {
            return $origin . self::normPath($url);
        }
        if ($url[0] === '?') {
            return $origin . $basePath . $url;
        }
        $dir = self::re('#/[^/]*$#', '/', $basePath);
        if ($dir === '') {
            $dir = '/';
        }
        return $origin . self::normPath($dir . $url);
    }

    private static function normPath($path)
    {
        $query = '';
        $qPos = strpos($path, '?');
        if ($qPos !== false) {
            $query = substr($path, $qPos);
            $path = substr($path, 0, $qPos);
        }
        $out = [];
        foreach (explode('/', $path) as $seg) {
            if ($seg === '.' || $seg === '') {
                continue;
            }
            if ($seg === '..') {
                array_pop($out);
                continue;
            }
            $out[] = $seg;
        }
        $trail = substr($path, -1) === '/' ? '/' : '';
        return '/' . implode('/', $out) . ($out ? $trail : '') . $query;
    }

    public static function htmlLang(DOMXPath $xp)
    {
        $html = self::first($xp, '//html');
        $raw = strtolower(substr(self::attr($html, 'lang'), 0, 2));
        return in_array($raw, ['ar', 'fr', 'en'], true) ? $raw : 'ar';
    }

    public static function countWords($text)
    {
        $parts = preg_split('/\s+/u', trim((string) $text));
        if (!$parts) {
            return 0;
        }
        $n = 0;
        foreach ($parts as $p) {
            if ($p !== '' && preg_match('/[\p{L}\p{N}]/u', $p)) {
                $n++;
            }
        }
        return $n;
    }

    /* ------------------------------------------------------------ cleaning */

    public static function stripJunk(DOMNode $scope)
    {
        $doc = $scope->ownerDocument;
        $xp = new DOMXPath($doc);
        $remove = [];
        foreach (self::q($xp, './/*', $scope) as $el) {
            if (!($el instanceof DOMElement)) {
                continue;
            }
            $tag = strtolower($el->nodeName);
            $cls = $el->getAttribute('class');
            $ident = $cls . ' ' . $el->getAttribute('id');
            $style = strtolower(str_replace(' ', '', $el->getAttribute('style')));
            if (in_array($tag, self::JUNK_TAGS, true)) {
                $remove[] = $el;
                continue;
            }
            if (trim($ident) !== '' && preg_match(self::JUNK_CLASS, $ident)) {
                $remove[] = $el;
                continue;
            }
            if ($cls !== '' && preg_match('/(^|\s)(ad|ads|advertisement)(\s|$)/i', $cls)) {
                $remove[] = $el;
                continue;
            }
            if (strpos($style, 'display:none') !== false) {
                $remove[] = $el;
                continue;
            }
            if ($tag === 'a') {
                $rel = strtolower($el->getAttribute('rel'));
                $href = strtolower($el->getAttribute('href'));
                if ($rel === 'prev' || $rel === 'next' || strpos($href, 'prev') !== false || strpos($href, 'next') !== false) {
                    $remove[] = $el;
                    continue;
                }
            }
            if ($tag === 'img') {
                $src = strtolower($el->getAttribute('src') ?: $el->getAttribute('data-src'));
                if ($src === '' || preg_match('/sprite|icon|avatar|emoji|logo|badge|pixel|1x1|spacer|placeholder/', $src)) {
                    $remove[] = $el;
                }
            }
        }
        foreach ($remove as $el) {
            if ($el->parentNode) {
                @$el->parentNode->removeChild($el);
            }
        }
    }

    private static function hasImage(DOMElement $el)
    {
        return $el->getElementsByTagName('img')->length > 0 || $el->getElementsByTagName('source')->length > 0;
    }

    /** Converts a cleaned element into ordered text/image blocks. */
    public static function blocks(DOMNode $scope, $base)
    {
        $blocks = [];
        $seenImg = [];
        $walk = null;
        $walk = function (DOMNode $node) use (&$walk, &$blocks, &$seenImg, $base) {
            foreach ($node->childNodes as $child) {
                if ($child->nodeType === XML_TEXT_NODE || $child->nodeType === XML_CDATA_SECTION_NODE) {
                    $text = self::normalize($child->textContent);
                    if ($text !== '') {
                        $blocks[] = ['type' => 'p', 'text' => $text];
                    }
                    continue;
                }
                if ($child->nodeType !== XML_ELEMENT_NODE) {
                    continue;
                }
                /** @var DOMElement $child */
                $tag = strtolower($child->nodeName);
                if ($tag === 'img' || $tag === 'source') {
                    $raw = $child->getAttribute('src') ?: ($child->getAttribute('data-src') ?: ($child->getAttribute('data-original') ?: $child->getAttribute('data-lazy-src')));
                    $url = self::absolute($raw, $base);
                    if ($url !== '' && preg_match('#^https?://#i', $url) && !isset($seenImg[$url])) {
                        $seenImg[$url] = true;
                        $blocks[] = ['type' => 'img', 'src' => $url, 'alt' => self::normalize($child->getAttribute('alt'))];
                    }
                    continue;
                }
                if (self::hasImage($child)) {
                    $walk($child);
                    continue;
                }
                if ($tag === 'br') {
                    $blocks[] = ['type' => 'p', 'text' => ''];
                    continue;
                }
                $text = self::normalize($child->textContent);
                if ($text === '') {
                    continue;
                }
                if (preg_match('/^h[1-6]$/', $tag)) {
                    $blocks[] = ['type' => 'h', 'text' => $text];
                } else {
                    $blocks[] = ['type' => 'p', 'text' => $text];
                }
            }
        };
        $walk($scope);

        // Merge adjacent pieces, drop duplicates and blank edges.
        $merged = [];
        $seenText = [];
        foreach ($blocks as $b) {
            $prev = $merged ? $merged[count($merged) - 1] : null;
            if ($b['type'] === 'p') {
                $text = trim($b['text']);
                if ($text === '' && (!$prev || $prev['type'] !== 'p')) {
                    continue;
                }
                if ($text !== '' && isset($seenText[$text])) {
                    continue;
                }
                if ($text !== '') {
                    $seenText[$text] = true;
                }
                if ($prev && $prev['type'] === 'p' && ($prev['text'] === '' || $text === '')) {
                    $merged[count($merged) - 1] = ['type' => 'p', 'text' => $prev['text'] !== '' ? $prev['text'] : $text];
                    continue;
                }
                $merged[] = ['type' => 'p', 'text' => $text];
                continue;
            }
            if ($prev && $prev['type'] === 'img' && $b['type'] === 'img' && $prev['src'] === $b['src']) {
                continue;
            }
            $merged[] = $b;
        }
        while ($merged && $merged[0]['type'] === 'p' && $merged[0]['text'] === '') {
            array_shift($merged);
        }
        while ($merged && $merged[count($merged) - 1]['type'] === 'p' && $merged[count($merged) - 1]['text'] === '') {
            array_pop($merged);
        }
        return $merged;
    }

    private static function isNoise(array $block, $chapterTitle)
    {
        if ($block['type'] !== 'p') {
            return false;
        }
        $text = trim($block['text']);
        if ($text === '') {
            return false;
        }
        if (preg_match('/^\d{1,5}$/', $text)) return true;
        if (preg_match(self::NOISE_EXACT, $text)) return true;
        if (preg_match(self::NOISE_LINE, $text)) return true;
        if ($chapterTitle !== '' && preg_replace('/\s+/u', ' ', $text) === preg_replace('/\s+/u', ' ', trim($chapterTitle))) return true;
        if (preg_match('/^(?:الفصل|chapter)\s+\d+\s*$/iu', $text)) return true;
        return false;
    }

    public static function cleanBlocks(array $blocks, $chapterTitle = '')
    {
        $out = [];
        $seen = [];
        foreach ($blocks as $b) {
            if (self::isNoise($b, $chapterTitle)) {
                continue;
            }
            if ($b['type'] === 'p' || $b['type'] === 'h') {
                $key = trim($b['text']);
                if ($key === '' || isset($seen[$key])) {
                    continue;
                }
                $seen[$key] = true;
            }
            $out[] = $b;
        }
        return $out;
    }

    public static function plain(array $blocks)
    {
        $lines = [];
        foreach ($blocks as $b) {
            if ($b['type'] === 'p' || $b['type'] === 'h') {
                $lines[] = $b['text'];
            }
        }
        return trim(self::re('/\n{3,}/', "\n\n", implode("\n", $lines)));
    }

    public static function countImages(array $blocks)
    {
        $n = 0;
        foreach ($blocks as $b) {
            if ($b['type'] === 'img') {
                $n++;
            }
        }
        return $n;
    }

    private static function isolate(DOMNode $node)
    {
        $tmp = new DOMDocument('1.0', 'UTF-8');
        $imp = $tmp->importNode($node, true);
        $tmp->appendChild($imp);
        return $imp;
    }

    /**
     * Picks the best content container: XPath candidates ordered from specific
     * to generic; the first one that carries a real chapter wins.
     */
    public static function extract(DOMXPath $xp, array $xpaths, $base, $chapterTitle = '')
    {
        $best = null;
        $bestScore = -1;
        foreach ($xpaths as $expr) {
            $nodes = self::q($xp, $expr);
            if (!$nodes) {
                continue;
            }
            $blocks = [];
            foreach ($nodes as $n) {
                $iso = self::isolate($n);
                self::stripJunk($iso);
                $blocks = array_merge($blocks, self::blocks($iso, $base));
            }
            $blocks = self::cleanBlocks($blocks, $chapterTitle);
            $text = self::plain($blocks);
            $letters = mb_strlen((string) preg_replace('/\s+/u', '', $text));
            $imgs = self::countImages($blocks);
            if ($letters === 0 && $imgs === 0) {
                continue;
            }
            if ($letters >= 120 || $imgs >= 2) {
                return ['blocks' => $blocks, 'text' => $text, 'images' => $imgs];
            }
            $score = $letters + $imgs * 200;
            if ($score > $bestScore) {
                $bestScore = $score;
                $best = ['blocks' => $blocks, 'text' => $text, 'images' => $imgs];
            }
        }
        if ($best) {
            return $best;
        }
        $body = self::first($xp, '//body');
        if (!$body) {
            return ['blocks' => [], 'text' => '', 'images' => 0];
        }
        $iso = self::isolate($body);
        self::stripJunk($iso);
        $blocks = self::cleanBlocks(self::blocks($iso, $base), $chapterTitle);
        return ['blocks' => $blocks, 'text' => self::plain($blocks), 'images' => self::countImages($blocks)];
    }

    /* ---------------------------------------------------------- discovery */

    private static function pickString($v)
    {
        if (is_string($v)) {
            return self::normalize($v);
        }
        if (is_array($v)) {
            if (isset($v['url']) && is_string($v['url'])) return $v['url'];
            if (isset($v['name']) && is_string($v['name'])) return self::normalize($v['name']);
            if (isset($v[0])) return self::pickString($v[0]);
        }
        return '';
    }

    public static function findCover(DOMXPath $xp, $base)
    {
        foreach (self::jsonLd($xp) as $ld) {
            $raw = isset($ld['image']) ? $ld['image'] : (isset($ld['thumbnailUrl']) ? $ld['thumbnailUrl'] : null);
            if ($raw !== null) {
                $url = self::absolute(self::pickString($raw), $base);
                if ($url !== '') {
                    return $url;
                }
            }
        }
        $og = self::meta($xp, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']);
        if ($og !== '') {
            return self::absolute($og, $base);
        }
        $best = ['', 0];
        foreach (self::q($xp, '//img') as $img) {
            $src = self::absolute(self::attr($img, 'src') ?: self::attr($img, 'data-src'), $base);
            if ($src === '' || !preg_match('#^https?:#', $src)) {
                continue;
            }
            $cls = strtolower(self::attr($img, 'class') . ' ' . self::attr($img, 'id') . ' ' . self::attr($img, 'alt'));
            $bonus = preg_match('/cover|book|novel|poster|thumb|story/', $cls) ? 500 : 0;
            $size = $bonus + (int) self::attr($img, 'width') * (int) self::attr($img, 'height');
            if ($size > $best[1]) {
                $best = [$src, $size];
            }
        }
        return $best[0];
    }

    public static function findDescription(DOMXPath $xp)
    {
        foreach (self::jsonLd($xp) as $ld) {
            if (isset($ld['description']) && is_string($ld['description']) && mb_strlen(trim($ld['description'])) > 40) {
                return self::normalize($ld['description']);
            }
        }
        $candidates = ["//*[@id='synopsisText']", "//*[contains(@class,'synopsis')]", "//*[@id='summary']", "//*[contains(@class,'summary')]", "//*[@itemprop='description']", "//*[contains(@class,'novel-summary')]", "//*[contains(@class,'description')]", "//*[contains(@class,'desc')]", '//article'];
        $best = '';
        foreach ($candidates as $expr) {
            foreach (self::q($xp, $expr) as $node) {
                $iso = self::isolate($node);
                self::stripJunk($iso);
                $text = self::normalize($iso->textContent);
                if (mb_strlen($text) > mb_strlen($best) && mb_strlen($text) > 40) {
                    $best = $text;
                }
            }
        }
        if ($best !== '') {
            return $best;
        }
        $meta = self::meta($xp, ['og:description', 'twitter:description', 'description']);
        return mb_strlen($meta) > 40 ? $meta : $best;
    }

    public static function chapterOrdinal($label, $url)
    {
        if (preg_match('/(?:الفصل|الجزء|chapter|chapitre|part|episode)\s*[-_#]*\s*(\d{1,4})/iu', $label, $m)) return (int) $m[1];
        if (preg_match('/(?:post_id|chapter|chapitre|chapter_id|ep|part|id)=(\d{1,7})/i', $url, $m)) return (int) $m[1];
        return null;
    }
}
