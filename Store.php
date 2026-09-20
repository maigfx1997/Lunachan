<?php
/**
 * لونا تشان — تخزين على الملفات (بدون قاعدة بيانات).
 * يعمل على أي استضافة PHP لديها مجلد قابل للكتابة.
 */
final class LunaStore
{
    public static $dir = '';

    public static function init($dir)
    {
        self::$dir = $dir;
        foreach ([$dir, "$dir/books", "$dir/fonts"] as $d) {
            if (!is_dir($d)) @mkdir($d, 0755, true);
        }
        if (!file_exists("$dir/.htaccess")) {
            @file_put_contents("$dir/.htaccess", "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n");
        }
        if (!file_exists("$dir/index.html")) @file_put_contents("$dir/index.html", '');
    }

    public static function writable()
    {
        return is_dir(self::$dir) && is_writable(self::$dir);
    }

    private static function encode($data)
    {
        return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    }

    private static function writeAtomic($path, $data)
    {
        $tmp = $path . '.' . uniqid('', true) . '.tmp';
        if (@file_put_contents($tmp, $data, LOCK_EX) === false) throw new RuntimeException('storage-not-writable');
        if (!@rename($tmp, $path)) {
            @unlink($tmp);
            throw new RuntimeException('storage-not-writable');
        }
    }

    private static function readJson($path)
    {
        if (!is_file($path)) return null;
        $raw = @file_get_contents($path);
        if ($raw === false || $raw === '') return null;
        $d = json_decode($raw, true);
        return is_array($d) ? $d : null;
    }

    public static function nextId()
    {
        $f = self::$dir . '/seq.txt';
        $h = @fopen($f, 'c+');
        if (!$h) throw new RuntimeException('storage-not-writable');
        flock($h, LOCK_EX);
        $cur = (int) trim((string) stream_get_contents($h));
        $next = $cur + 1;
        ftruncate($h, 0);
        rewind($h);
        fwrite($h, (string) $next);
        fflush($h);
        flock($h, LOCK_UN);
        fclose($h);
        return $next;
    }

    public static function bookDir($id)
    {
        return self::$dir . '/books/' . (int) $id;
    }

    public static function saveBook(array $book)
    {
        $d = self::bookDir($book['id']);
        foreach ([$d, "$d/ch"] as $p) {
            if (!is_dir($p)) @mkdir($p, 0755, true);
        }
        self::writeAtomic("$d/meta.json", self::encode($book));
    }

    public static function loadBook($id)
    {
        return self::readJson(self::bookDir($id) . '/meta.json');
    }

    public static function findBySource($url)
    {
        foreach (glob(self::$dir . '/books/*/meta.json') ?: [] as $f) {
            $b = self::readJson($f);
            if ($b && isset($b['sourceUrl']) && $b['sourceUrl'] === $url) return $b;
        }
        return null;
    }

    public static function listBooks()
    {
        $out = [];
        foreach (glob(self::$dir . '/books/*/meta.json') ?: [] as $f) {
            $b = self::readJson($f);
            if ($b) $out[] = $b;
        }
        usort($out, function ($a, $b) {
            return strcmp((string) ($b['createdAt'] ?? ''), (string) ($a['createdAt'] ?? ''));
        });
        return $out;
    }

    public static function deleteBook($id)
    {
        $d = self::bookDir($id);
        if (!is_dir($d)) return;
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($it as $p) {
            $p->isDir() ? @rmdir($p->getPathname()) : @unlink($p->getPathname());
        }
        @rmdir($d);
    }

    /* -------------------------------------------------------- chapters */

    private static function updateIndex($id, $idx, array $entry)
    {
        $f = self::bookDir($id) . '/index.json';
        $h = @fopen($f, 'c+');
        if (!$h) throw new RuntimeException('storage-not-writable');
        flock($h, LOCK_EX);
        $raw = stream_get_contents($h);
        $map = $raw ? json_decode($raw, true) : [];
        if (!is_array($map)) $map = [];
        $map[(string) $idx] = $entry;
        ftruncate($h, 0);
        rewind($h);
        fwrite($h, self::encode($map));
        fflush($h);
        flock($h, LOCK_UN);
        fclose($h);
    }

    public static function index($id)
    {
        $map = self::readJson(self::bookDir($id) . '/index.json');
        return is_array($map) ? $map : [];
    }

    public static function saveChapter($id, $idx, array $ch)
    {
        $d = self::bookDir($id) . '/ch';
        if (!is_dir($d)) @mkdir($d, 0755, true);
        self::writeAtomic("$d/" . (int) $idx . '.json', self::encode($ch));
        self::updateIndex($id, $idx, [
            's' => $ch['status'],
            't' => $ch['title'],
            'w' => (int) $ch['wordCount'],
            'c' => (int) $ch['charCount'],
            'i' => (int) $ch['imageCount'],
            'e' => (string) $ch['error'],
            'p' => mb_substr((string) $ch['plainText'], 0, 200),
        ]);
    }

    public static function loadChapter($id, $idx)
    {
        return self::readJson(self::bookDir($id) . '/ch/' . (int) $idx . '.json');
    }

    public static function resetFailed($id)
    {
        $book = self::loadBook($id);
        if (!$book) return 0;
        $n = 0;
        foreach (self::index($id) as $idx => $e) {
            if (in_array($e['s'], ['failed', 'empty'], true)) {
                @unlink(self::bookDir($id) . '/ch/' . (int) $idx . '.json');
                self::updateIndex($id, $idx, ['s' => 'pending', 't' => $e['t'], 'w' => 0, 'c' => 0, 'i' => 0, 'e' => '', 'p' => '']);
                $n++;
            }
        }
        return $n;
    }

    /** Light chapter records (no blocks) merged from refs + index. */
    public static function chapters(array $book)
    {
        $index = self::index($book['id']);
        $out = [];
        foreach ($book['chapters'] as $ref) {
            $e = isset($index[(string) $ref['idx']]) ? $index[(string) $ref['idx']] : null;
            $out[] = [
                'idx' => (int) $ref['idx'],
                'title' => $e && $e['t'] !== '' ? $e['t'] : $ref['title'],
                'sourceUrl' => $ref['url'],
                'status' => $e ? $e['s'] : 'pending',
                'wordCount' => $e ? (int) $e['w'] : 0,
                'charCount' => $e ? (int) $e['c'] : 0,
                'imageCount' => $e ? (int) $e['i'] : 0,
                'error' => $e ? (string) $e['e'] : '',
                'preview' => $e ? (string) $e['p'] : '',
                'blocks' => [],
                'plainText' => '',
            ];
        }
        return $out;
    }

    public static function counts(array $book)
    {
        $done = 0;
        $failed = 0;
        foreach (self::index($book['id']) as $e) {
            if ($e['s'] === 'done') $done++;
            elseif ($e['s'] === 'failed' || $e['s'] === 'empty') $failed++;
        }
        return [$done, $failed];
    }

    /* ----------------------------------------------------------- cover */

    public static function saveCover($id, $data, $mime)
    {
        $map = ['image/jpeg' => 'jpg', 'image/jpg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp', 'image/avif' => 'avif', 'image/bmp' => 'bmp', 'image/svg+xml' => 'svg'];
        $ext = isset($map[$mime]) ? $map[$mime] : 'img';
        $d = self::bookDir($id);
        if (!is_dir($d)) @mkdir($d, 0755, true);
        foreach (glob("$d/cover.*") ?: [] as $old) @unlink($old);
        self::writeAtomic("$d/cover.$ext", $data);
        return "cover.$ext";
    }

    public static function coverPath(array $book)
    {
        if (empty($book['coverFile'])) return null;
        $p = self::bookDir($book['id']) . '/' . basename($book['coverFile']);
        return is_file($p) ? $p : null;
    }
}
