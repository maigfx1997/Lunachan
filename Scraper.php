<?php
/**
 * لونا تشان — محرّكات السحب: يحمّل من كل المواقع.
 * لا يخترع أي نص: كل شيء يُقرأ من صفحة المصدر كما هو.
 */
final class LunaScraper
{
    /* ---------------------------------------------------------- helpers */

    public static function normalizeUrl($raw)
    {
        $value = preg_replace('/<[^>]*>/', ' ', (string) $raw);
        $value = str_ireplace('&amp;', '&', $value);
        $value = preg_replace('/[\x{200B}-\x{200F}\x{202A}-\x{202E}]/u', '', $value);
        $value = preg_replace('/[«»"\'`؛;،,]+/u', '', $value);
        $value = preg_replace('/\s+/u', '', trim((string) $value));
        if ($value === '' || $value === null) {
            return ['error' => 'empty'];
        }
        if (preg_match('/\.\.\.|…/u', $value)) {
            $id = preg_match('/(?:id=|\/)(\d{1,9})/', $value, $m) ? $m[1] : null;
            if ($id && preg_match('/novlar/i', $value)) $value = 'https://www.novlar.com/views/novel/details.php?id=' . $id;
            elseif ($id && preg_match('/uranus/i', $value)) $value = 'https://uranus-novel.com/ar/novels/' . $id;
            elseif ($id && preg_match('/wattpad/i', $value)) $value = 'https://www.wattpad.com/story/' . $id;
            else return ['error' => 'truncated'];
        }
        if (!preg_match('#^https?://#i', $value)) {
            if (preg_match('/^[a-z0-9.\-]+\.[a-z]{2,}(\/|$)/i', $value)) $value = 'https://' . $value;
            else return ['error' => 'invalid'];
        }
        $p = parse_url($value);
        if (!$p || empty($p['host']) || strpos($p['host'], '.') === false || !in_array(strtolower($p['scheme']), ['http', 'https'], true)) {
            return ['error' => 'invalid'];
        }
        return ['url' => $value];
    }

    public static function adapterFor($url)
    {
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        $host = preg_replace('/^www\./', '', $host);
        if (preg_match('/wattpad\.com$/', $host)) return 'wattpad';
        if (preg_match('/novlar|khalidblog/', $host)) return 'portal';
        if (preg_match('/uranus-novel|novel/', $host)) return 'modern';
        return 'generic';
    }

    private static function origin($url)
    {
        $p = parse_url($url);
        return $p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
    }

    /** Book meta + real chapter list. */
    public static function meta($input)
    {
        $n = self::normalizeUrl($input);
        if (isset($n['error'])) {
            throw new RuntimeException($n['error']);
        }
        $url = $n['url'];
        $adapter = self::adapterFor($url);
        $meta = call_user_func([self::class, $adapter . 'Meta'], $url);
        $meta['adapter'] = $adapter;

        if ($adapter === 'modern' && count($meta['chapters']) <= 2) {
            $next = count($meta['chapters']) + 1;
            $known = [];
            foreach ($meta['chapters'] as $c) $known[$c['url']] = true;
            for ($a = 0; $a < 4; $a++) {
                $ref = self::modernProbe($meta, $next);
                if (!$ref) break;
                if (!isset($known[$ref['url']])) $meta['chapters'][] = $ref;
                $next++;
            }
        }

        $list = [];
        foreach ($meta['chapters'] as $c) {
            if (empty($c['url'])) continue;
            $c['idx'] = count($list) + 1;
            $list[] = ['idx' => $c['idx'], 'title' => $c['title'], 'url' => $c['url']];
        }
        if (!$list) {
            $list = [['idx' => 1, 'title' => $meta['title'], 'url' => $meta['sourceUrl']]];
        }
        $meta['chapters'] = $list;
        return $meta;
    }

    public static function chapter($adapter, array $ref, array $meta)
    {
        $fn = $adapter . 'Chapter';
        if (!method_exists(self::class, $fn)) {
            $fn = 'genericChapter';
        }
        return call_user_func([self::class, $fn], $ref, $meta);
    }

    private static function result($title, array $content, $fallbackTitle)
    {
        return [
            'title' => $title !== '' ? $title : $fallbackTitle,
            'blocks' => $content['blocks'],
            'text' => $content['text'],
            'images' => $content['images'],
        ];
    }

    /* ---------------------------------------------------------- wattpad */

    private static function wattpadEmbedded($html)
    {
        $marker = strpos($html, '"parts":[');
        if ($marker === false) return null;
        for ($skip = 0; $skip < 24; $skip++) {
            $start = self::enclosingObjectStart($html, $marker, $skip);
            if ($start < 0) break;
            $candidate = self::balancedJson($html, $start);
            if ($candidate === null) continue;
            $parsed = json_decode($candidate, true);
            if (is_array($parsed) && isset($parsed['parts']) && is_array($parsed['parts'])) return $parsed;
        }
        return null;
    }

    private static function enclosingObjectStart($html, $index, $skip)
    {
        $depth = 0;
        $skipped = 0;
        for ($i = $index; $i >= 0; $i--) {
            $ch = $html[$i];
            if ($ch === '}') $depth++;
            elseif ($ch === '{') {
                if ($depth === 0) {
                    if ($skipped >= $skip) return $i;
                    $skipped++;
                } else $depth--;
            }
        }
        return -1;
    }

    private static function balancedJson($text, $start)
    {
        $depth = 0;
        $inString = false;
        $escape = false;
        $len = strlen($text);
        for ($i = $start; $i < $len; $i++) {
            $ch = $text[$i];
            if ($inString) {
                if ($escape) $escape = false;
                elseif ($ch === '\\') $escape = true;
                elseif ($ch === '"') $inString = false;
                continue;
            }
            if ($ch === '"') $inString = true;
            elseif ($ch === '{') $depth++;
            elseif ($ch === '}') {
                $depth--;
                if ($depth === 0) return substr($text, $start, $i - $start + 1);
            }
        }
        return null;
    }

    private static function wattpadMeta($input)
    {
        $storyId = null;
        $partId = null;
        if (preg_match('#/story/(\d+)#i', $input, $m)) $storyId = $m[1];
        $path = (string) parse_url($input, PHP_URL_PATH);
        if (!$storyId && preg_match('#^/(\d{6,})#', $path, $m)) $partId = $m[1];
        if (!$storyId && !$partId && preg_match('/(\d{6,})/', $input, $m)) $storyId = $m[1];
        if (!$storyId && $partId) {
            $info = LunaHttp::json("https://www.wattpad.com/api/v3/story_parts/$partId?fields=id,title,group(id,title)", ['referer' => $input]);
            if (is_array($info) && !empty($info['group']['id'])) $storyId = (string) $info['group']['id'];
        }
        if (!$storyId) throw new RuntimeException('لم يتم العثور على معرّف الرواية في الرابط');

        $story = LunaHttp::json("https://www.wattpad.com/api/v3/stories/$storyId?fields=id,title,description,cover,user,author,language,parts(id,title,url)", ['referer' => $input]);
        if (!is_array($story) || empty($story['parts'])) {
            $page = LunaHttp::text("https://www.wattpad.com/story/$storyId", ['referer' => $input]);
            if ($page['ok'] && $page['body'] !== '') {
                $embedded = self::wattpadEmbedded($page['body']);
                if ($embedded) {
                    $story = array_merge(is_array($story) ? $story : [], $embedded);
                } elseif (!is_array($story)) {
                    list($doc, $xp) = LunaDom::load($page['body']);
                    $story = ['id' => $storyId, 'title' => LunaDom::textOf(LunaDom::first($xp, '//h1')), 'description' => LunaDom::meta($xp, ['description', 'og:description']), 'parts' => []];
                }
            }
        }
        if (!is_array($story)) throw new RuntimeException('تعذّر الوصول إلى بيانات الرواية (قد يكون الرابط خاصًا)');

        $cover = '';
        if (isset($story['cover'])) $cover = is_array($story['cover']) ? (string) ($story['cover']['url'] ?? '') : (string) $story['cover'];
        $chapters = [];
        foreach ((array) ($story['parts'] ?? []) as $part) {
            if (!is_array($part) || !isset($part['id'])) continue;
            $url = (!empty($part['url']) && preg_match('#^https?://#', $part['url'])) ? $part['url'] : 'https://www.wattpad.com/' . $part['id'];
            $title = LunaDom::normalize((string) ($part['title'] ?? ''));
            $chapters[] = ['idx' => count($chapters) + 1, 'title' => $title !== '' ? $title : 'فصل ' . (count($chapters) + 1), 'url' => $url];
        }
        $langName = mb_strtolower((string) ($story['language']['name'] ?? ''));
        $lang = preg_match('/عرب|arab/u', $langName) ? 'ar' : (preg_match('/fran|fren/u', $langName) ? 'fr' : (preg_match('/engl/u', $langName) ? 'en' : 'ar'));
        $author = (string) ($story['user']['fullname'] ?? ($story['user']['name'] ?? ($story['author'] ?? '')));
        return [
            'sourceUrl' => "https://www.wattpad.com/story/$storyId",
            'host' => 'https://www.wattpad.com',
            'title' => LunaDom::normalize((string) ($story['title'] ?? '')),
            'author' => LunaDom::normalize($author),
            'description' => LunaDom::normalize((string) ($story['description'] ?? '')),
            'languageCode' => $lang,
            'coverUrl' => $cover,
            'chapters' => $chapters,
        ];
    }

    private static function wattpadChapter(array $ref, array $meta)
    {
        $path = (string) parse_url($ref['url'], PHP_URL_PATH);
        $partId = preg_match('#^/(\d{6,})#', $path, $m) ? $m[1] : (preg_match('/(\d{6,})/', $ref['url'], $m) ? $m[1] : '');
        if ($partId === '') throw new RuntimeException('معرّف الفصل غير صالح');
        $res = LunaHttp::text("https://www.wattpad.com/apiv2/storytext?id=$partId", ['referer' => $meta['sourceUrl'], 'accept' => 'text/html,application/xhtml+xml,*/*']);
        if (!$res['ok'] || $res['body'] === '') throw new RuntimeException('HTTP ' . $res['status']);
        if (preg_match('/ERROR/', substr($res['body'], 0, 80))) throw new RuntimeException('تعذّر جلب نص الفصل');

        list($doc, $xp) = LunaDom::load('<div id="wp-root">' . $res['body'] . '</div>');
        $title = LunaDom::sanitizeTitle($ref['title']);
        $content = LunaDom::extract($xp, ["//*[@id='wp-root']"], $ref['url'], $title);

        if (mb_strlen((string) preg_replace('/\s+/u', '', $content['text'])) < 40 && $content['images'] === 0) {
            $page = LunaHttp::text($ref['url'], ['referer' => $meta['sourceUrl']]);
            if ($page['ok'] && $page['body'] !== '') {
                list($d2, $xp2) = LunaDom::load($page['body']);
                $title = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp2, '//h1'))) ?: $title;
                $content = LunaDom::extract($xp2, ["//*[contains(@class,'panel-reading')]//pre", "//*[contains(@class,'panel-reading')]", '//*[@data-p-id]', '//article', '//main'], $ref['url'], $title);
            }
        }
        return self::result($title, $content, $ref['title']);
    }

    /* -------------------------------------------- portal (details.php/read.php) */

    private static function portalMeta($input)
    {
        $first = LunaHttp::text($input, ['referer' => $input]);
        if (!$first['ok'] || $first['body'] === '') throw new RuntimeException('تعذّر فتح الرابط (HTTP ' . $first['status'] . ')');
        $html = $first['body'];
        $finalUrl = $first['url'];

        if (preg_match('/read\.php|chapter/i', $finalUrl)) {
            list($dc, $xc) = LunaDom::load($html);
            $back = LunaDom::attr(LunaDom::first($xc, "//a[contains(@href,'details.php?id=')]"), 'href');
            if ($back !== '') {
                $target = LunaDom::absolute($back, $finalUrl);
                $res = LunaHttp::text($target, ['referer' => $finalUrl]);
                if ($res['ok'] && $res['body'] !== '') {
                    $html = $res['body'];
                    $finalUrl = $res['url'];
                }
            }
        }

        list($doc, $xp) = LunaDom::load($html);
        $title = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp, '//h1')));
        if ($title === '') $title = LunaDom::stripSuffix(LunaDom::meta($xp, ['og:title', 'twitter:title']), ['منصة الروايات', 'روايات']);
        if ($title === '') $title = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp, '//title')));

        $cover = LunaDom::absolute(LunaDom::attr(LunaDom::first($xp, "//img[contains(@class,'cover-img')]"), 'src'), $finalUrl);
        if ($cover === '') $cover = LunaDom::findCover($xp, $finalUrl);

        $description = LunaDom::textOf(LunaDom::first($xp, "//*[@id='synopsisText']"));
        if ($description === '') $description = LunaDom::textOf(LunaDom::first($xp, "//*[contains(@class,'synopsis-text')]"));
        if ($description === '') $description = LunaDom::findDescription($xp);

        $author = LunaDom::textOf(LunaDom::first($xp, "//*[contains(@class,'author-card')]//h4"));
        if ($author === '') $author = LunaDom::textOf(LunaDom::first($xp, "//a[contains(@href,'author-profile')]//h4"));
        if ($author === '') $author = LunaDom::textOf(LunaDom::first($xp, "//a[contains(@href,'author-profile')]"));
        if ($author === '') $author = LunaDom::meta($xp, ['author']);

        $byUrl = [];
        $position = 0;
        foreach (LunaDom::q($xp, "//a[contains(@href,'read.php')]") as $a) {
            $href = LunaDom::attr($a, 'href');
            if (!preg_match('/post_id=\d+|read\.php/', $href)) continue;
            $url = LunaDom::absolute($href, $finalUrl);
            if ($url === '') continue;
            $position++;
            $label = LunaDom::textOf(LunaDom::first($xp, './/small', $a));
            $strong = LunaDom::textOf(LunaDom::first($xp, './/strong', $a));
            $anchorText = LunaDom::textOf($a);
            $combined = LunaDom::sanitizeTitle(implode(' — ', array_filter([$label, $strong])) ?: $anchorText);
            $isNoise = preg_match(LunaDom::NON_CHAPTER_LABEL, $combined) || preg_match(LunaDom::NON_CHAPTER_LABEL, $anchorText);
            $order = LunaDom::chapterOrdinal($combined !== '' ? $combined : $anchorText, $url);
            if (isset($byUrl[$url])) {
                $ex = &$byUrl[$url];
                if (($ex['title'] === '' || preg_match(LunaDom::NON_CHAPTER_LABEL, $ex['title'])) && !$isNoise && $combined !== '') {
                    $ex['title'] = $combined;
                    $ex['order'] = $order;
                }
                unset($ex);
                continue;
            }
            $byUrl[$url] = ['url' => $url, 'title' => $isNoise ? '' : $combined, 'order' => $order, 'position' => $position];
        }
        $candidates = array_values(array_filter($byUrl, function ($c) use ($byUrl) {
            return $c['title'] !== '' || count($byUrl) === 1;
        }));
        usort($candidates, function ($a, $b) {
            if ($a['order'] !== null && $b['order'] !== null && $a['order'] !== $b['order']) return $a['order'] - $b['order'];
            if ($a['order'] !== null && $b['order'] === null) return -1;
            if ($a['order'] === null && $b['order'] !== null) return 1;
            return $a['position'] - $b['position'];
        });
        $chapters = [];
        foreach ($candidates as $i => $c) {
            $chapters[] = ['idx' => $i + 1, 'title' => $c['title'] !== '' ? $c['title'] : 'الفصل ' . ($i + 1), 'url' => $c['url']];
        }
        if (!$chapters) $chapters[] = ['idx' => 1, 'title' => $title !== '' ? $title : 'الفصل 1', 'url' => $finalUrl];

        return ['sourceUrl' => $finalUrl, 'host' => self::origin($finalUrl), 'title' => $title, 'author' => $author, 'description' => $description, 'languageCode' => 'ar', 'coverUrl' => $cover, 'chapters' => $chapters];
    }

    private static function portalChapter(array $ref, array $meta)
    {
        $res = LunaHttp::text($ref['url'], ['referer' => $meta['sourceUrl']]);
        if (!$res['ok'] || $res['body'] === '') throw new RuntimeException('HTTP ' . $res['status']);
        list($doc, $xp) = LunaDom::load($res['body']);
        $title = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp, "//*[contains(@class,'chapter-header')]//h1")));
        if ($title === '') $title = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp, '//h1')));
        if ($title === '') $title = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp, '//h2')));
        if ($title === '') $title = $ref['title'];
        $content = LunaDom::extract($xp, [
            "//*[@id='chapterContent']//*[contains(@class,'paragraph-content')]",
            "//*[@id='chapterContent']",
            "//*[contains(@class,'chapter-content')]",
            "//*[contains(@class,'chapter-container')]",
            "//*[contains(@class,'paragraph-content')]",
            '//article',
        ], $ref['url'], $title);
        return self::result($title, $content, $ref['title']);
    }

    /* ------------------------------------------- modern (novels/{id}/chapters/{n}) */

    private static function cleanSummary($text)
    {
        $lines = [];
        foreach (preg_split('/\n+/u', (string) $text) as $line) {
            $line = trim($line);
            if ($line === '') continue;
            if (preg_match('/^(كتبت بتاريخ|عدد الفصول|حالة الرواية|اللغة|آخر تحديث|المشاهدات|التقييم|الناشر|سنة النشر)/u', $line)) continue;
            $lines[] = $line;
        }
        return LunaDom::normalize(implode("\n", $lines));
    }

    private static function chapterNumberFromUrl($url)
    {
        return preg_match('#chapters/(\d+)#i', $url, $m) ? (int) $m[1] : PHP_INT_MAX;
    }

    private static function modernMeta($input)
    {
        $res = LunaHttp::text($input, ['referer' => $input]);
        if (!$res['ok'] || $res['body'] === '') throw new RuntimeException('تعذّر فتح الرابط (HTTP ' . $res['status'] . ')');
        list($doc, $xp) = LunaDom::load($res['body']);
        $base = $res['url'];
        $suffixes = ['منصة الروايات', 'أورانوس', 'Uranus Novel', 'Uranus', 'منصة عربية رائدة لنشر وقراءة الروايات والقصص'];

        $rawTitle = LunaDom::meta($xp, ['og:title', 'twitter:title']);
        if ($rawTitle === '') $rawTitle = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp, '//h1')));
        if ($rawTitle === '') $rawTitle = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp, '//title')));
        $title = LunaDom::stripSuffix($rawTitle, $suffixes);

        $description = self::cleanSummary(LunaDom::textOf(LunaDom::first($xp, "//*[@id='tab-summary']")));
        if (mb_strlen($description) < 60) {
            $alt = self::cleanSummary(LunaDom::textOf(LunaDom::first($xp, "//*[contains(@class,'novel-summary') or contains(@class,'summary') or contains(@class,'synopsis') or contains(@class,'description')]")));
            if (mb_strlen($alt) > mb_strlen($description)) $description = $alt;
        }
        if (mb_strlen($description) < 40) $description = LunaDom::findDescription($xp);

        $cover = LunaDom::findCover($xp, $base);
        if (preg_match('/logo|default-cover|placeholder|favicon/i', $cover)) $cover = '';

        $author = LunaDom::textOf(LunaDom::first($xp, "//a[contains(@href,'/profile/')]"));
        if ($author === '') $author = LunaDom::textOf(LunaDom::first($xp, "//a[contains(@href,'/author')]"));
        if ($author === '') $author = LunaDom::meta($xp, ['author']);

        $novelPath = preg_match('#/novels/\d+#i', (string) parse_url($base, PHP_URL_PATH), $m) ? $m[0] : '';
        $chapters = [];
        $seen = [];
        foreach (LunaDom::q($xp, "//a[contains(@href,'/chapters/')]") as $a) {
            $href = LunaDom::attr($a, 'href');
            if (!preg_match('#/chapters/\d+#i', $href)) continue;
            if ($novelPath !== '' && strpos($href, $novelPath) === false) continue;
            $url = LunaDom::absolute($href, $base);
            if ($url === '' || isset($seen[$url])) continue;
            $seen[$url] = true;
            $label = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp, ".//h4|.//h3|.//strong|.//*[contains(@class,'chapter-title')]", $a)));
            if ($label === '') $label = LunaDom::sanitizeTitle(LunaDom::textOf($a));
            $chapters[] = ['idx' => 0, 'title' => $label, 'url' => $url];
        }
        usort($chapters, function ($a, $b) {
            return self::chapterNumberFromUrl($a['url']) - self::chapterNumberFromUrl($b['url']);
        });
        foreach ($chapters as $i => &$c) {
            $c['idx'] = $i + 1;
            if ($c['title'] === '') $c['title'] = 'الفصل ' . ($i + 1);
        }
        unset($c);
        if (!$chapters) $chapters[] = ['idx' => 1, 'title' => $title !== '' ? $title : 'الفصل 1', 'url' => $base];

        return ['sourceUrl' => $base, 'host' => self::origin($base), 'title' => $title, 'author' => $author, 'description' => $description, 'languageCode' => LunaDom::htmlLang($xp), 'coverUrl' => $cover, 'chapters' => $chapters];
    }

    private static function modernChapter(array $ref, array $meta)
    {
        $res = LunaHttp::text($ref['url'], ['referer' => $meta['sourceUrl']]);
        if (!$res['ok'] || $res['body'] === '') throw new RuntimeException('HTTP ' . $res['status']);
        list($doc, $xp) = LunaDom::load($res['body']);
        $title = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp, "//*[contains(@class,'chapter-title-main')]")));
        if ($title === '') $title = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp, "//*[contains(@class,'chapter-header')]//h1")));
        if ($title === '') $title = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp, '//h1')));
        if ($title === '') $title = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp, '//title')));
        $title = LunaDom::stripSuffix($title, ['منصة الروايات', 'أورانوس']);
        if ($title === '') $title = $ref['title'];
        $content = LunaDom::extract($xp, [
            "//*[@id='readingBody']",
            "//*[contains(@class,'reading-body')]",
            "//*[@id='chapterContent']",
            "//*[contains(@class,'chapter-content-area')]",
            "//*[contains(@class,'chapter-content')]",
            "//*[contains(@class,'reading-container')]",
            '//article',
        ], $ref['url'], $title);
        return self::result($title, $content, $ref['title']);
    }

    private static function modernProbe(array $meta, $n)
    {
        $path = (string) parse_url($meta['sourceUrl'], PHP_URL_PATH);
        if (!preg_match('#/novels/\d+#i', $path)) return null;
        $candidate = self::origin($meta['sourceUrl']) . rtrim($path, '/') . '/chapters/' . $n;
        $res = LunaHttp::text($candidate, ['referer' => $meta['sourceUrl'], 'retries' => 0]);
        if (!$res['ok'] || $res['body'] === '') return null;
        list($doc, $xp) = LunaDom::load($res['body']);
        $title = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp, "//*[contains(@class,'chapter-title-main')]")));
        if ($title === '') $title = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp, '//h1')));
        if ($title === '') return null;
        return ['idx' => $n, 'title' => $title, 'url' => $candidate];
    }

    /* ---------------------------------------------------------- generic */

    private static function genericChapterNumber($url, $title)
    {
        if (preg_match('/(?:chapter|chapters|chapitre|part|episode|read|فصل)[-_\/]?(\d{1,4})/iu', $url, $m)) return (int) $m[1];
        if (preg_match('/[?&](?:chapter|chap|ep|part|id)=(\d{1,4})/i', $url, $m)) return (int) $m[1];
        $segments = array_reverse(explode('/', explode('?', $url)[0]));
        foreach ($segments as $seg) {
            if (preg_match('/(\d{1,4})(?:\D|$)/', $seg, $m)) return (int) $m[1];
        }
        if (preg_match('/(\d{1,4})/', $title, $m)) return (int) $m[1];
        return PHP_INT_MAX;
    }

    private static function genericMeta($input)
    {
        $res = LunaHttp::text($input, ['referer' => $input]);
        if (!$res['ok'] || $res['body'] === '') throw new RuntimeException('تعذّر فتح الرابط (HTTP ' . $res['status'] . ')');
        list($doc, $xp) = LunaDom::load($res['body']);
        $base = $res['url'];
        $origin = self::origin($base);

        $title = LunaDom::meta($xp, ['og:title', 'twitter:title']);
        if ($title === '') $title = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp, '//h1')));
        if ($title === '') $title = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp, '//title')));
        if ($title === '') $title = 'بدون عنوان';

        $cover = LunaDom::findCover($xp, $base);
        $description = LunaDom::findDescription($xp);
        $author = LunaDom::meta($xp, ['author', 'article:author']);
        if ($author === '') $author = LunaDom::textOf(LunaDom::first($xp, "//a[@rel='author']|//*[contains(@class,'author')]"));

        $chapters = [];
        $seen = [];
        foreach (LunaDom::q($xp, '//a[@href]') as $a) {
            $href = LunaDom::attr($a, 'href');
            if ($href === '' || $href[0] === '#' || stripos($href, 'javascript:') === 0) continue;
            $url = LunaDom::absolute($href, $base);
            if ($url === '') continue;
            $p = parse_url($url);
            if (!$p || empty($p['host'])) continue;
            $linkOrigin = $p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
            if ($linkOrigin !== $origin) continue;
            if (preg_match('/(login|signin|register|signup|privacy|terms|contact|about|dmca|policy|tag|genre|category|search|دخول|تسجيل|سياسة|اتصل|حول|تصنيف)/iu', $url)) continue;
            $label = LunaDom::sanitizeTitle(LunaDom::attr($a, 'title') ?: LunaDom::textOf($a));
            if (preg_match(LunaDom::NON_CHAPTER_LABEL, $label)) continue;
            $looksLikeChapter = preg_match('/(chapter|chapitre|capitulo|capítulo|part|partie|episode|ep\b|read|فصل|جزء|قراءة)/iu', $url . ' ' . $label);
            $pathParts = explode('/', isset($p['path']) ? $p['path'] : '/');
            $numbered = preg_match('/\d/', isset($p['path']) ? $p['path'] : '') && count($pathParts) >= 3;
            if (!$looksLikeChapter && !$numbered) continue;
            if (mb_strlen($label) < 2 || isset($seen[$url])) continue;
            $seen[$url] = true;
            $chapters[] = ['idx' => 0, 'title' => $label, 'url' => $url];
        }
        usort($chapters, function ($a, $b) {
            return self::genericChapterNumber($a['url'], $a['title']) - self::genericChapterNumber($b['url'], $b['title']);
        });
        $chapters = array_slice($chapters, 0, 500);
        foreach ($chapters as $i => &$c) {
            $c['idx'] = $i + 1;
            if ($c['title'] === '') $c['title'] = 'الفصل ' . ($i + 1);
        }
        unset($c);
        if (count($chapters) < 2) $chapters = [['idx' => 1, 'title' => $title, 'url' => $base]];

        return ['sourceUrl' => $base, 'host' => $origin, 'title' => $title, 'author' => $author, 'description' => $description, 'languageCode' => LunaDom::htmlLang($xp), 'coverUrl' => $cover, 'chapters' => $chapters];
    }

    private static function genericChapter(array $ref, array $meta)
    {
        $res = LunaHttp::text($ref['url'], ['referer' => $meta['sourceUrl']]);
        if (!$res['ok'] || $res['body'] === '') throw new RuntimeException('HTTP ' . $res['status']);
        list($doc, $xp) = LunaDom::load($res['body']);
        $title = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp, '//h1')));
        if ($title === '') $title = LunaDom::sanitizeTitle(LunaDom::textOf(LunaDom::first($xp, "//*[contains(@class,'chapter-title')]")));
        if ($title === '') $title = LunaDom::sanitizeTitle(LunaDom::meta($xp, ['og:title']));
        if ($title === '') $title = $ref['title'];
        $content = LunaDom::extract($xp, [
            '//article',
            "//*[contains(@class,'chapter-content')]",
            "//*[contains(@id,'chapter-content')]",
            "//*[contains(@class,'chapter')]",
            "//*[contains(@class,'reading')]",
            "//*[contains(@class,'novel-content')]",
            "//*[contains(@class,'entry-content')]",
            "//*[contains(@class,'post-content')]",
            "//*[contains(@id,'content')]",
            '//main',
        ], $ref['url'], $title);
        return self::result($title, $content, $ref['title']);
    }
}
