<?php
/**
 * لونا تشان — طبقة HTTP (cURL فقط، لا تحتاج allow_url_fopen).
 * تعمل على الاستضافات المشتركة والمجانية.
 */
final class LunaHttp
{
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

    /** Low-level request with manual redirect following (safe under open_basedir). */
    private static function request($url, array $headers, $timeout, $maxBytes = 0)
    {
        $current = $url;
        for ($hop = 0; $hop < 8; $hop++) {
            $ch = curl_init($current);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HEADER => true,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_CONNECTTIMEOUT => 12,
                CURLOPT_TIMEOUT => $timeout,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_ENCODING => '',
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_SSL_VERIFYHOST => 0,
            ]);
            $raw = curl_exec($ch);
            $errno = curl_errno($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
            $ctype = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
            curl_close($ch);

            if ($raw === false || $errno !== 0) {
                return ['status' => 0, 'body' => '', 'url' => $current, 'type' => '', 'error' => 'curl-' . $errno];
            }
            $head = substr($raw, 0, $headerSize);
            $body = (string) substr($raw, $headerSize);

            if (in_array($status, [301, 302, 303, 307, 308], true) && preg_match('/^Location:\s*(.+)$/mi', $head, $m)) {
                $resolved = LunaDom::absolute(trim($m[1]), $current);
                if ($resolved !== '' && $resolved !== $current) {
                    $current = $resolved;
                    continue;
                }
            }
            if ($maxBytes > 0 && strlen($body) > $maxBytes) {
                return ['status' => $status, 'body' => '', 'url' => $current, 'type' => $ctype, 'error' => 'too-large'];
            }
            return ['status' => $status, 'body' => $body, 'url' => $current, 'type' => $ctype, 'error' => ''];
        }
        return ['status' => 0, 'body' => '', 'url' => $current, 'type' => '', 'error' => 'redirect-loop'];
    }

    public static function text($url, array $opt = [])
    {
        $json = !empty($opt['json']);
        $headers = [
            'User-Agent: ' . self::UA,
            'Accept: ' . (isset($opt['accept']) ? $opt['accept'] : ($json ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml,text/plain,*/*')),
            // JSON endpoints answer with legacy PHP dumps when Arabic is preferred; keep them in English.
            'Accept-Language: ' . ($json ? 'en-US,en;q=0.9' : 'ar,fr-FR;q=0.9,en-US;q=0.8,en;q=0.7'),
            'Cache-Control: no-cache',
            'Pragma: no-cache',
        ];
        if (!empty($opt['referer'])) {
            $headers[] = 'Referer: ' . $opt['referer'];
        }
        $timeout = isset($opt['timeout']) ? (int) $opt['timeout'] : 25;
        $retries = isset($opt['retries']) ? (int) $opt['retries'] : 2;

        for ($attempt = 0; $attempt <= $retries; $attempt++) {
            $res = self::request($url, $headers, $timeout);
            if ($res['status'] > 0) {
                $body = $json ? $res['body'] : self::toUtf8($res['body'], $res['type']);
                return [
                    'ok' => $res['status'] >= 200 && $res['status'] < 300,
                    'status' => $res['status'],
                    'body' => $body,
                    'url' => $res['url'],
                    'type' => $res['type'],
                ];
            }
            usleep(350000 * ($attempt + 1));
        }
        return ['ok' => false, 'status' => 0, 'body' => '', 'url' => $url, 'type' => ''];
    }

    public static function json($url, array $opt = [])
    {
        for ($attempt = 0; $attempt < 3; $attempt++) {
            $res = self::text($url, $opt + ['json' => true, 'retries' => 1]);
            if ($res['ok'] && $res['body'] !== '') {
                $parsed = self::parseLoose($res['body']);
                if ($parsed !== null) {
                    return $parsed;
                }
            }
            usleep(300000 * ($attempt + 1));
        }
        return null;
    }

    /** Downloads an image untouched (never re-encoded). */
    public static function binary($url, $referer = null, $maxBytes = 12582912)
    {
        $headers = [
            'User-Agent: ' . self::UA,
            'Accept: image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
            'Accept-Language: ar,en;q=0.8',
        ];
        if ($referer) {
            $headers[] = 'Referer: ' . $referer;
        }
        $res = self::request($url, $headers, 25, $maxBytes);
        if ($res['status'] < 200 || $res['status'] >= 300 || $res['body'] === '') {
            return ['ok' => false, 'data' => '', 'mime' => ''];
        }
        $parts = explode(';', $res['type']);
        $headerMime = strtolower(trim($parts[0]));
        $mime = strpos($headerMime, 'image/') === 0 ? $headerMime : self::sniffImage($res['body'], $url);
        return ['ok' => true, 'data' => $res['body'], 'mime' => $mime];
    }

    private static function toUtf8($body, $type)
    {
        if ($body === '' || mb_check_encoding($body, 'UTF-8')) {
            return $body;
        }
        $cs = null;
        if (preg_match('/charset=([\w-]+)/i', (string) $type, $m)) {
            $cs = $m[1];
        } elseif (preg_match('/<meta[^>]+charset\s*=\s*["\']?([\w-]+)/i', substr($body, 0, 4096), $m)) {
            $cs = $m[1];
        }
        if ($cs && strcasecmp($cs, 'utf-8') !== 0) {
            $conv = @mb_convert_encoding($body, 'UTF-8', $cs);
            if (is_string($conv) && $conv !== '') {
                return $conv;
            }
        }
        $conv = @mb_convert_encoding($body, 'UTF-8', 'Windows-1256');
        return is_string($conv) && $conv !== '' ? $conv : (string) mb_convert_encoding($body, 'UTF-8', 'UTF-8');
    }

    /** JSON first, then the legacy `array ( 'k' => 'v' )` dump some APIs emit. */
    public static function parseLoose($text)
    {
        $t = trim((string) $text);
        if ($t === '') {
            return null;
        }
        $j = json_decode($t, true);
        if ($j !== null) {
            return $j;
        }
        if (preg_match('/^array\s*\(/i', $t)) {
            try {
                return self::parsePhpDump($t);
            } catch (Throwable $e) {
                return null;
            }
        }
        return null;
    }

    public static function parsePhpDump($s)
    {
        $s = trim($s);
        $len = strlen($s);
        $i = 0;
        $skipWs = function () use (&$i, $s, $len) {
            while ($i < $len && ctype_space($s[$i])) {
                $i++;
            }
        };
        $readString = function () use (&$i, $s, $len) {
            $q = $s[$i];
            $i++;
            $out = '';
            while ($i < $len) {
                $c = $s[$i];
                if ($c === '\\') {
                    $n = $i + 1 < $len ? $s[$i + 1] : '';
                    if ($n === "'" || $n === '"' || $n === '\\') {
                        $out .= $n;
                        $i += 2;
                        continue;
                    }
                    $out .= $c;
                    $i++;
                    continue;
                }
                if ($c === $q) {
                    $i++;
                    break;
                }
                $out .= $c;
                $i++;
            }
            return $out;
        };
        $parseValue = null;
        $parseValue = function () use (&$parseValue, &$i, $s, $len, $skipWs, $readString) {
            $skipWs();
            if (substr($s, $i, 5) === 'array') {
                $i += 5;
                $skipWs();
                if ($i < $len && $s[$i] === '(') {
                    $i++;
                }
                $entries = [];
                while (true) {
                    $skipWs();
                    if ($i >= $len) {
                        break;
                    }
                    if ($s[$i] === ')') {
                        $i++;
                        break;
                    }
                    $cp = $i;
                    $key = null;
                    if ($s[$i] === "'" || $s[$i] === '"') {
                        $key = $readString();
                    } elseif (preg_match('/^-?\d+/', substr($s, $i, 20), $m)) {
                        $key = (int) $m[0];
                        $i += strlen($m[0]);
                    }
                    $skipWs();
                    if (substr($s, $i, 2) === '=>') {
                        $i += 2;
                    } else {
                        $i = $cp;
                        $key = null;
                    }
                    $value = $parseValue();
                    $entries[] = [$key, $value];
                    $skipWs();
                    if ($i < $len && $s[$i] === ',') {
                        $i++;
                        continue;
                    }
                    if ($i < $len && $s[$i] === ')') {
                        $i++;
                        break;
                    }
                    if ($i >= $len) {
                        break;
                    }
                    $i++;
                }
                $allNumeric = count($entries) > 0;
                foreach ($entries as $e) {
                    if (!is_int($e[0])) {
                        $allNumeric = false;
                        break;
                    }
                }
                $out = [];
                if ($allNumeric) {
                    foreach ($entries as $e) {
                        $out[$e[0]] = $e[1];
                    }
                    ksort($out);
                    return array_values($out);
                }
                foreach ($entries as $pos => $e) {
                    $out[$e[0] === null ? (string) $pos : (string) $e[0]] = $e[1];
                }
                return $out;
            }
            if ($i < $len && ($s[$i] === "'" || $s[$i] === '"')) {
                return $readString();
            }
            if (preg_match('/^-?\d+(?:\.\d+)?/', substr($s, $i, 40), $m)) {
                $i += strlen($m[0]);
                return $m[0] + 0;
            }
            if (preg_match('/^[A-Za-z_]+/', substr($s, $i, 40), $m)) {
                $i += strlen($m[0]);
                $w = strtolower($m[0]);
                if ($w === 'null') {
                    return null;
                }
                if ($w === 'true') {
                    return true;
                }
                if ($w === 'false') {
                    return false;
                }
                return $m[0];
            }
            $i++;
            return null;
        };
        return $parseValue();
    }

    public static function mimeFromUrl($url)
    {
        $clean = explode('#', explode('?', $url)[0])[0];
        $ext = strtolower((string) pathinfo($clean, PATHINFO_EXTENSION));
        $map = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'jpe' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp', 'avif' => 'image/avif', 'bmp' => 'image/bmp', 'svg' => 'image/svg+xml'];
        return isset($map[$ext]) ? $map[$ext] : 'application/octet-stream';
    }

    public static function sniffImage($buf, $url = '')
    {
        if (strlen($buf) > 12) {
            if (substr($buf, 0, 2) === "\xFF\xD8") return 'image/jpeg';
            if (substr($buf, 0, 4) === "\x89PNG") return 'image/png';
            if (substr($buf, 0, 3) === 'GIF') return 'image/gif';
            if (substr($buf, 8, 4) === 'WEBP') return 'image/webp';
            if (strpos(substr($buf, 4, 8), 'ftypavif') !== false) return 'image/avif';
            if (stripos(substr($buf, 0, 200), '<svg') !== false) return 'image/svg+xml';
        }
        return self::mimeFromUrl($url);
    }
}
