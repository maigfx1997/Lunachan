<?php
/**
 * لونا تشان — الموجّه وواجهة API (نسخة PHP المستقلّة).
 * المسارات: index.php?r=books|import|book|delete|fetch|chapter|retry|weights|cover|image|export|health|diag
 */
final class LunaApp
{
    private static function json($data, $status = 200)
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    private static function fail($code, $message, $status = 400)
    {
        self::json(['error' => $code, 'message' => $message], $status);
    }

    private static function body()
    {
        $raw = file_get_contents('php://input');
        $d = json_decode((string) $raw, true);
        if (!is_array($d)) $d = $_POST;
        return is_array($d) ? $d : [];
    }

    private static function publicBook(array $book)
    {
        list($done, $failed) = LunaStore::counts($book);
        return [
            'id' => (int) $book['id'],
            'sourceUrl' => $book['sourceUrl'],
            'host' => $book['host'],
            'adapter' => $book['adapter'],
            'title' => $book['title'],
            'author' => $book['author'],
            'description' => $book['description'],
            'languageCode' => $book['languageCode'],
            'coverUrl' => $book['coverUrl'],
            'coverMime' => $book['coverMime'],
            'totalChapters' => count($book['chapters']),
            'status' => $done + $failed >= count($book['chapters']) ? ($done > 0 ? 'ready' : 'failed') : 'importing',
            'fetchedChapters' => $done,
            'failedChapters' => $failed,
            'doneChapters' => $done,
            'hasCover' => LunaStore::coverPath($book) !== null,
            'createdAt' => $book['createdAt'],
            'updatedAt' => $book['updatedAt'],
            'error' => '',
        ];
    }

    private static function route()
    {
        $r = isset($_GET['r']) ? (string) $_GET['r'] : '';
        if ($r !== '') return $r;
        $uri = isset($_SERVER['REQUEST_URI']) ? (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) : '/';
        $script = dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/index.php'));
        if ($script !== '/' && $script !== '\\' && strpos($uri, $script) === 0) $uri = substr($uri, strlen($script));
        $uri = '/' . ltrim($uri, '/');
        if ($uri === '/api/health') return 'health';
        if ($uri === '/api/import') return 'import';
        if ($uri === '/api/books') return 'books';
        if ($uri === '/api/image') return 'image';
        if (preg_match('#^/api/books/(\d+)/chapters/(\d+)/fetch$#', $uri, $m)) { $_GET['id'] = $m[1]; $_GET['idx'] = $m[2]; return 'fetch'; }
        if (preg_match('#^/api/books/(\d+)/chapters/(\d+)$#', $uri, $m)) { $_GET['id'] = $m[1]; $_GET['idx'] = $m[2]; return 'chapter'; }
        if (preg_match('#^/api/books/(\d+)/(cover|export|weights|retry)$#', $uri, $m)) { $_GET['id'] = $m[1]; return $m[2]; }
        if (preg_match('#^/api/books/(\d+)$#', $uri, $m)) { $_GET['id'] = $m[1]; return ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'DELETE' ? 'delete' : 'book'; }
        if (preg_match('#^/book/(\d+)$#', $uri, $m)) { $_GET['open'] = $m[1]; return 'ui'; }
        return 'ui';
    }

    public static function run()
    {
        $r = self::route();
        try {
            switch ($r) {
                case 'health':
                    self::json(['ok' => true, 'engine' => 'php', 'storage' => LunaStore::writable()]);
                    // no break — json() exits
                case 'diag':
                    self::json([
                        'engine' => 'php',
                        'php' => PHP_VERSION,
                        'extensions' => ['curl' => function_exists('curl_init'), 'dom' => class_exists('DOMDocument'), 'mbstring' => function_exists('mb_strlen'), 'zlib' => function_exists('gzdeflate'), 'gd' => function_exists('imagecreatefromstring')],
                        'storage' => ['dir' => LunaStore::$dir, 'writable' => LunaStore::writable()],
                        'fonts' => is_file(dirname(__DIR__) . '/assets/fonts/Amiri-Regular.ttf') || is_file(LunaStore::$dir . '/fonts/Amiri-Regular.ttf'),
                    ]);
                case 'books':
                    $out = [];
                    foreach (LunaStore::listBooks() as $b) $out[] = self::publicBook($b);
                    self::json(['books' => $out]);
                case 'import':
                    return self::import();
                case 'book':
                    $book = self::book();
                    self::json(['book' => self::publicBook($book), 'chapters' => LunaStore::chapters($book)]);
                case 'delete':
                    $book = self::book();
                    LunaStore::deleteBook($book['id']);
                    self::json(['ok' => true]);
                case 'fetch':
                    return self::fetch();
                case 'chapter':
                    $book = self::book();
                    $idx = (int) ($_GET['idx'] ?? 0);
                    $ch = LunaStore::loadChapter($book['id'], $idx);
                    $light = null;
                    foreach (LunaStore::chapters($book) as $c) {
                        if ($c['idx'] === $idx) $light = $c;
                    }
                    if (!$light) self::fail('chapter-not-found', 'الفصل غير موجود', 404);
                    if ($ch) {
                        $light['blocks'] = $ch['blocks'];
                        $light['plainText'] = $ch['plainText'];
                        $light['preview'] = mb_substr((string) $ch['plainText'], 0, 400);
                    }
                    self::json(['chapter' => $light]);
                case 'retry':
                    $book = self::book();
                    $reset = LunaStore::resetFailed($book['id']);
                    self::json(['reset' => $reset, 'book' => self::publicBook($book), 'chapters' => LunaStore::chapters($book)]);
                case 'weights':
                    $book = self::book();
                    $cover = LunaStore::coverPath($book);
                    self::json(LunaExport::weights($book, LunaStore::chapters($book), $cover ? (int) filesize($cover) : 0));
                case 'cover':
                    return self::cover();
                case 'image':
                    return self::image();
                case 'export':
                    return self::export();
                default:
                    header('Content-Type: text/html; charset=utf-8');
                    echo luna_ui_html(['api' => 'index.php?r=', 'open' => isset($_GET['open']) ? (int) $_GET['open'] : 0]);
                    exit;
            }
        } catch (Throwable $e) {
            $code = $e->getMessage();
            $messages = ['empty' => 'لم يتم لصق أي رابط', 'invalid' => 'الرابط غير صالح', 'truncated' => 'الرابط يبدو مقطوعًا: انسخي رابط الرواية كاملًا', 'not-found' => 'لم يتم العثور على الرواية', 'storage-not-writable' => 'مجلد data غير قابل للكتابة على الاستضافة', 'font-missing' => 'خط Amiri غير متوفر: ارفعي مجلد assets/fonts', 'empty-book' => 'لم يُسحب أي فصل بعد', 'invalid-format' => 'صيغة غير مدعومة'];
            self::fail($code, isset($messages[$code]) ? $messages[$code] : 'تعذّر تنفيذ الطلب: ' . $code, $code === 'not-found' ? 404 : 400);
        }
    }

    private static function book()
    {
        $id = (int) ($_GET['id'] ?? 0);
        $book = $id > 0 ? LunaStore::loadBook($id) : null;
        if (!$book) throw new RuntimeException('not-found');
        return $book;
    }

    private static function import()
    {
        $data = self::body();
        $url = isset($data['url']) ? (string) $data['url'] : (string) ($_GET['url'] ?? '');
        if (trim($url) === '') self::fail('empty', 'لم يتم لصق أي رابط');
        if (!LunaStore::writable()) self::fail('storage-not-writable', 'مجلد data غير قابل للكتابة على الاستضافة', 500);
        @set_time_limit(90);

        $meta = LunaScraper::meta($url);
        $existing = LunaStore::findBySource($meta['sourceUrl']);
        $id = $existing ? (int) $existing['id'] : LunaStore::nextId();

        $coverFile = $existing ? ($existing['coverFile'] ?? '') : '';
        $coverMime = $existing ? ($existing['coverMime'] ?? '') : '';
        if ($meta['coverUrl'] !== '') {
            $bin = LunaHttp::binary($meta['coverUrl'], $meta['sourceUrl']);
            if ($bin['ok'] && strpos($bin['mime'], 'image/') === 0) {
                $coverFile = LunaStore::saveCover($id, $bin['data'], $bin['mime']);
                $coverMime = $bin['mime'];
            }
        }
        $book = [
            'id' => $id,
            'sourceUrl' => $meta['sourceUrl'],
            'host' => $meta['host'],
            'adapter' => $meta['adapter'],
            'title' => $meta['title'] !== '' ? $meta['title'] : 'بدون عنوان',
            'author' => $meta['author'],
            'description' => $meta['description'],
            'languageCode' => $meta['languageCode'],
            'coverUrl' => $meta['coverUrl'],
            'coverMime' => $coverMime,
            'coverFile' => $coverFile,
            'chapters' => $meta['chapters'],
            'createdAt' => $existing ? $existing['createdAt'] : date('c'),
            'updatedAt' => date('c'),
        ];
        LunaStore::saveBook($book);
        self::json(['book' => self::publicBook($book), 'chapters' => LunaStore::chapters($book)]);
    }

    private static function fetch()
    {
        $book = self::book();
        $idx = (int) ($_GET['idx'] ?? 0);
        $ref = null;
        foreach ($book['chapters'] as $c) {
            if ((int) $c['idx'] === $idx) $ref = $c;
        }
        if (!$ref) self::fail('chapter-not-found', 'الفصل غير موجود', 404);
        @set_time_limit(60);
        try {
            $content = LunaScraper::chapter($book['adapter'], $ref, $book);
            $blocks = array_values(array_filter($content['blocks'], function ($b) {
                return $b['type'] !== 'p' || trim($b['text']) !== '';
            }));
            $text = $content['text'];
            $hasBody = preg_replace('/\s+/u', '', $text) !== '' || $content['images'] > 0;
            $ch = [
                'idx' => $idx,
                'title' => $content['title'] !== '' ? $content['title'] : $ref['title'],
                'status' => $hasBody ? 'done' : 'empty',
                'blocks' => $blocks,
                'plainText' => $text,
                'wordCount' => LunaDom::countWords($text),
                'charCount' => mb_strlen($text),
                'imageCount' => (int) $content['images'],
                'error' => $hasBody ? '' : 'empty-content',
                'fetchedAt' => date('c'),
            ];
        } catch (Throwable $e) {
            $ch = ['idx' => $idx, 'title' => $ref['title'], 'status' => 'failed', 'blocks' => [], 'plainText' => '', 'wordCount' => 0, 'charCount' => 0, 'imageCount' => 0, 'error' => $e->getMessage(), 'fetchedAt' => date('c')];
        }
        LunaStore::saveChapter($book['id'], $idx, $ch);
        $light = null;
        foreach (LunaStore::chapters($book) as $c) {
            if ($c['idx'] === $idx) $light = $c;
        }
        self::json(['chapter' => $light, 'book' => self::publicBook($book)]);
    }

    private static function cover()
    {
        $book = self::book();
        $path = LunaStore::coverPath($book);
        if (!$path) {
            if ($book['coverUrl'] !== '') {
                header('Location: ' . $book['coverUrl'], true, 302);
                exit;
            }
            self::fail('no-cover', 'لا يوجد غلاف', 404);
        }
        header('Content-Type: ' . ($book['coverMime'] ?: 'image/jpeg'));
        header('Content-Length: ' . filesize($path));
        header('Cache-Control: public, max-age=31536000, immutable');
        readfile($path);
        exit;
    }

    private static function image()
    {
        $u = isset($_GET['u']) ? (string) $_GET['u'] : '';
        $p = parse_url($u);
        if (!$p || empty($p['host']) || !in_array(strtolower($p['scheme'] ?? ''), ['http', 'https'], true) || preg_match('/^(localhost|127\.|0\.|10\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/i', $p['host'])) {
            self::fail('blocked', 'رابط غير مسموح', 403);
        }
        $bin = LunaHttp::binary($u, isset($_GET['r']) ? (string) $_GET['r'] : null);
        if (!$bin['ok']) self::fail('upstream', 'تعذّر جلب الصورة', 502);
        header('Content-Type: ' . $bin['mime']);
        header('Content-Length: ' . strlen($bin['data']));
        header('Cache-Control: public, max-age=86400');
        echo $bin['data'];
        exit;
    }

    private static function export()
    {
        $book = self::book();
        $format = strtolower((string) ($_GET['format'] ?? ''));
        if (!in_array($format, LunaExport::FORMATS, true)) self::fail('invalid-format', 'صيغة غير مدعومة');
        @set_time_limit(180);
        @ini_set('memory_limit', '512M');

        $light = LunaStore::chapters($book);
        $done = [];
        $unavailable = [];
        foreach ($light as $c) {
            if ($c['status'] === 'done') {
                $full = LunaStore::loadChapter($book['id'], $c['idx']);
                if (!$full) continue;
                $done[] = ['idx' => $c['idx'], 'title' => $full['title'] ?: $c['title'], 'status' => 'done', 'blocks' => $full['blocks'], 'plainText' => $full['plainText'], 'sourceUrl' => $c['sourceUrl']];
            } else {
                $unavailable[] = ['idx' => $c['idx'], 'title' => $c['title']];
            }
        }
        if (!$done) self::fail('empty-book', 'لم يُسحب أي فصل بعد', 409);

        $coverPath = LunaStore::coverPath($book);
        $exportBook = [
            'id' => (int) $book['id'],
            'title' => $book['title'] !== '' ? $book['title'] : 'بدون عنوان',
            'author' => (string) $book['author'],
            'description' => (string) $book['description'],
            'languageCode' => (string) $book['languageCode'],
            'sourceUrl' => (string) $book['sourceUrl'],
            'cover' => $coverPath ? ['bytes' => file_get_contents($coverPath), 'mime' => $book['coverMime'] ?: LunaHttp::sniffImage(file_get_contents($coverPath), $coverPath)] : null,
        ];
        list($filename, $mime, $bytes) = LunaExport::build($exportBook, $done, $unavailable, $format);
        $inline = isset($_GET['inline']) && $_GET['inline'] === '1';
        header('Content-Type: ' . $mime);
        header('Content-Length: ' . strlen($bytes));
        header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . "; filename*=UTF-8''" . rawurlencode($filename));
        header('Cache-Control: no-store');
        header('X-File-Size: ' . strlen($bytes));
        echo $bytes;
        exit;
    }
}
