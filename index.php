<?php
/**
 * ============================================================================
 *  لونا تشان — Luna Chan | index.php
 *  نقطة الدخول للاستضافات المجانية (PHP فقط، مثل aeonfree) وأي استضافة مشتركة.
 * ============================================================================
 *
 *  هذا الملف يشغّل نسخة PHP المستقلّة من لونا تشان بالكامل:
 *  السحب من كل المواقع + المعاينة + لوحة الأوزان + التحميل بصيغ
 *  EPUB / PDF / HTML / TXT / Markdown / DOCX / FB2 / JSON — بدون Node وبدون قاعدة بيانات.
 *
 *  التخزين: مجلد data/ (يُنشأ تلقائيًا ويُحمى بـ .htaccess).
 *  خط PDF: assets/fonts/Amiri-Regular.ttf (أو يُنزَّل مرة واحدة إلى data/fonts).
 *
 *  (اختياري) إن كانت لديكِ خدمة Next.js تعمل على نفس السيرفر، ضعي في luna.env:
 *      LUNA_NODE_URL=http://127.0.0.1:3000
 *  فيمرّر index.php الطلبات إليها — فقط عندما تردّ /api/health بـ {"ok":true}.
 * ============================================================================
 */

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
@ini_set('default_charset', 'UTF-8');
mb_internal_encoding('UTF-8');
date_default_timezone_set('UTC');

if (!function_exists('str_starts_with')) {
    function str_starts_with($h, $n) { return $n === '' || strncmp($h, $n, strlen($n)) === 0; }
}
if (!function_exists('str_contains')) {
    function str_contains($h, $n) { return $n === '' || strpos($h, $n) !== false; }
}

/* ---------------------------------------------------------------- config -- */

function luna_env($key, $default = null)
{
    $value = getenv($key);
    if ($value !== false && $value !== '') {
        return $value;
    }
    static $file = null;
    if ($file === null) {
        $file = [];
        $path = __DIR__ . '/luna.env';
        if (is_readable($path)) {
            foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
                $line = trim($line);
                if ($line === '' || $line[0] === '#') {
                    continue;
                }
                $parts = explode('=', $line, 2);
                if (count($parts) === 2) {
                    $file[trim($parts[0])] = trim($parts[1], " \t\"'");
                }
            }
        }
    }
    return isset($file[$key]) ? $file[$key] : $default;
}

/* ------------------------------------------ optional Next.js pass-through -- */

$nodeUrl = rtrim((string) luna_env('LUNA_NODE_URL', ''), '/');
if ($nodeUrl !== '' && function_exists('curl_init')) {
    $port = (int) parse_url($nodeUrl, PHP_URL_PORT);
    // Never point at the web server's own HTTP/HTTPS ports (that is what produced the "400 Bad Request" page).
    if (!in_array($port, [80, 443], true)) {
        $ch = curl_init($nodeUrl . '/api/health');
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT_MS => 1500, CURLOPT_CONNECTTIMEOUT_MS => 1200, CURLOPT_HTTPHEADER => ['Accept: application/json']]);
        $probe = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $health = is_string($probe) ? json_decode($probe, true) : null;
        if ($code === 200 && is_array($health) && !empty($health['ok']) && (!isset($health['engine']) || $health['engine'] !== 'php')) {
            luna_proxy($nodeUrl);
            exit;
        }
    }
}

function luna_proxy($nodeUrl)
{
    $uri = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/';
    $method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';
    $headers = [];
    foreach ($_SERVER as $key => $value) {
        if (strpos($key, 'HTTP_') !== 0) continue;
        $name = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($key, 5)))));
        if (in_array($name, ['Connection', 'Content-Length', 'Accept-Encoding', 'Host'], true)) continue;
        $headers[] = $name . ': ' . $value;
    }
    if (isset($_SERVER['CONTENT_TYPE'])) $headers[] = 'Content-Type: ' . $_SERVER['CONTENT_TYPE'];
    $headers[] = 'X-Forwarded-Proto: ' . ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http');
    $headers[] = 'X-Forwarded-Host: ' . (isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'localhost');

    $ch = curl_init($nodeUrl . $uri);
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_FOLLOWLOCATION => false, CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 600, CURLOPT_CONNECTTIMEOUT => 10]);
    if (!in_array($method, ['GET', 'HEAD'], true)) curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
    $raw = curl_exec($ch);
    $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    if ($raw === false) {
        http_response_code(502);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Luna Chan: upstream unavailable';
        return;
    }
    $statusSent = false;
    foreach (explode("\r\n", substr($raw, 0, $headerSize)) as $line) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
            if (!$statusSent) {
                http_response_code((int) $m[1]);
                $statusSent = true;
            }
            continue;
        }
        if ($line === '' || preg_match('/^(Transfer-Encoding|Connection|Content-Length|Content-Encoding):/i', $line)) continue;
        header($line, false);
    }
    echo substr($raw, $headerSize);
}

/* --------------------------------------------------------- PHP engine ---- */

require __DIR__ . '/php/Http.php';
require __DIR__ . '/php/Dom.php';
require __DIR__ . '/php/Scraper.php';
require __DIR__ . '/php/Store.php';
require __DIR__ . '/php/Export.php';
require __DIR__ . '/php/Pdf.php';
require __DIR__ . '/php/ui.php';
require __DIR__ . '/php/App.php';

LunaStore::init(rtrim((string) luna_env('LUNA_DATA_DIR', __DIR__ . '/data'), '/'));
LunaApp::run();
