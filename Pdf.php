<?php
/**
 * لونا تشان — كاتب PDF خالص بـ PHP: خط Amiri مضمّن + تشكيل عربي + ترتيب RTL.
 */
final class LunaArabic
{
    private static $forms = [
        0x0621 => [0xFE80], 0x0622 => [0xFE81, 0xFE82], 0x0623 => [0xFE83, 0xFE84], 0x0624 => [0xFE85, 0xFE86], 0x0625 => [0xFE87, 0xFE88],
        0x0626 => [0xFE89, 0xFE8A, 0xFE8B, 0xFE8C], 0x0627 => [0xFE8D, 0xFE8E], 0x0628 => [0xFE8F, 0xFE90, 0xFE91, 0xFE92], 0x0629 => [0xFE93, 0xFE94],
        0x062A => [0xFE95, 0xFE96, 0xFE97, 0xFE98], 0x062B => [0xFE99, 0xFE9A, 0xFE9B, 0xFE9C], 0x062C => [0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0],
        0x062D => [0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4], 0x062E => [0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8], 0x062F => [0xFEA9, 0xFEAA], 0x0630 => [0xFEAB, 0xFEAC],
        0x0631 => [0xFEAD, 0xFEAE], 0x0632 => [0xFEAF, 0xFEB0], 0x0633 => [0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4], 0x0634 => [0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8],
        0x0635 => [0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC], 0x0636 => [0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0], 0x0637 => [0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4],
        0x0638 => [0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8], 0x0639 => [0xFEC9, 0xFECA, 0xFECB, 0xFECC], 0x063A => [0xFECD, 0xFECE, 0xFECF, 0xFED0],
        0x0641 => [0xFED1, 0xFED2, 0xFED3, 0xFED4], 0x0642 => [0xFED5, 0xFED6, 0xFED7, 0xFED8], 0x0643 => [0xFED9, 0xFEDA, 0xFEDB, 0xFEDC],
        0x0644 => [0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0], 0x0645 => [0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4], 0x0646 => [0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8],
        0x0647 => [0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC], 0x0648 => [0xFEED, 0xFEEE], 0x0649 => [0xFEEF, 0xFEF0], 0x064A => [0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4],
        0x0640 => [0x0640, 0x0640, 0x0640, 0x0640], 0x0671 => [0xFB50, 0xFB51], 0x06CC => [0xFBFC, 0xFBFD, 0xFBFE, 0xFBFF],
        0x067E => [0xFB56, 0xFB57, 0xFB58, 0xFB59], 0x0686 => [0xFB7A, 0xFB7B, 0xFB7C, 0xFB7D], 0x0698 => [0xFB8A, 0xFB8B],
        0x06AF => [0xFB92, 0xFB93, 0xFB94, 0xFB95], 0x06A9 => [0xFB8E, 0xFB8F, 0xFB90, 0xFB91],
    ];
    private static $lamAlef = [0x0622 => [0xFEF5, 0xFEF6], 0x0623 => [0xFEF7, 0xFEF8], 0x0625 => [0xFEF9, 0xFEFA], 0x0627 => [0xFEFB, 0xFEFC]];
    private static $mirror = [0x28 => 0x29, 0x29 => 0x28, 0x5B => 0x5D, 0x5D => 0x5B, 0x7B => 0x7D, 0x7D => 0x7B, 0x3C => 0x3E, 0x3E => 0x3C, 0xAB => 0xBB, 0xBB => 0xAB];

    public static function cps($s)
    {
        $chars = preg_split('//u', (string) $s, -1, PREG_SPLIT_NO_EMPTY);
        if ($chars === false) return [];
        $out = [];
        foreach ($chars as $c) $out[] = mb_ord($c, 'UTF-8');
        return $out;
    }

    public static function hasArabic($s)
    {
        return (bool) preg_match('/[\x{0600}-\x{06FF}]/u', (string) $s);
    }

    public static function isHaraka($cp)
    {
        return ($cp >= 0x0610 && $cp <= 0x061A) || ($cp >= 0x064B && $cp <= 0x065F) || $cp === 0x0670 || ($cp >= 0x06D6 && $cp <= 0x06ED);
    }

    private static function dual($cp)
    {
        return isset(self::$forms[$cp]) && count(self::$forms[$cp]) === 4;
    }

    private static function joins($cp)
    {
        return isset(self::$forms[$cp]) && count(self::$forms[$cp]) >= 2;
    }

    public static function shape(array $cps)
    {
        $n = count($cps);
        $out = [];
        for ($i = 0; $i < $n; $i++) {
            $cp = $cps[$i];
            if (self::isHaraka($cp)) {
                $out[] = $cp;
                continue;
            }
            $prev = null;
            for ($j = $i - 1; $j >= 0; $j--) {
                if (self::isHaraka($cps[$j])) continue;
                $prev = $cps[$j];
                break;
            }
            $next = null;
            $nextIdx = null;
            for ($j = $i + 1; $j < $n; $j++) {
                if (self::isHaraka($cps[$j])) continue;
                $next = $cps[$j];
                $nextIdx = $j;
                break;
            }
            if ($cp === 0x0644 && $next !== null && isset(self::$lamAlef[$next])) {
                $lig = self::$lamAlef[$next];
                $out[] = ($prev !== null && self::dual($prev)) ? $lig[1] : $lig[0];
                $i = $nextIdx;
                continue;
            }
            if (!isset(self::$forms[$cp])) {
                $out[] = $cp;
                continue;
            }
            $f = self::$forms[$cp];
            $cPrev = $prev !== null && self::dual($prev);
            $cNext = $next !== null && self::joins($next);
            $code = $f[0];
            if ($cPrev && $cNext && isset($f[3])) $code = $f[3];
            elseif ($cPrev && isset($f[1])) $code = $f[1];
            elseif ($cNext && isset($f[2])) $code = $f[2];
            $out[] = $code;
        }
        return $out;
    }

    private static function dir($cp)
    {
        if (($cp >= 0x30 && $cp <= 0x39) || ($cp >= 0x0660 && $cp <= 0x0669) || ($cp >= 0x06F0 && $cp <= 0x06F9)) return 'l';
        if (($cp >= 0x0600 && $cp <= 0x06FF) || ($cp >= 0x0750 && $cp <= 0x077F) || ($cp >= 0x08A0 && $cp <= 0x08FF) || ($cp >= 0xFB50 && $cp <= 0xFDFF) || ($cp >= 0xFE70 && $cp <= 0xFEFF)) return 'r';
        if (($cp >= 0x41 && $cp <= 0x5A) || ($cp >= 0x61 && $cp <= 0x7A) || ($cp >= 0xC0 && $cp <= 0x24F)) return 'l';
        return 'n';
    }

    /** Shapes and reorders logical text into visual left-to-right glyph order. */
    public static function visual(array $logical, $forceRtl = true)
    {
        $shaped = self::shape($logical);
        $runs = [];
        $paraDir = $forceRtl ? 'r' : 'l';
        $first = true;
        foreach ($shaped as $cp) {
            $d = self::dir($cp);
            if ($d !== 'n' && $first) {
                $paraDir = $d;
                $first = false;
            }
            $eff = $d === 'n' ? ($runs ? $runs[count($runs) - 1]['d'] : $paraDir) : $d;
            if ($runs && $runs[count($runs) - 1]['d'] === $eff) $runs[count($runs) - 1]['t'][] = $cp;
            else $runs[] = ['d' => $eff, 't' => [$cp]];
        }
        if ($paraDir === 'r') $runs = array_reverse($runs);
        $out = [];
        foreach ($runs as $run) {
            if ($run['d'] === 'r') {
                foreach (array_reverse($run['t']) as $cp) $out[] = isset(self::$mirror[$cp]) ? self::$mirror[$cp] : $cp;
            } else {
                foreach ($run['t'] as $cp) $out[] = $cp;
            }
        }
        return $out;
    }
}

final class LunaTtf
{
    public $bytes;
    public $unitsPerEm = 1000;
    public $ascent = 900;
    public $descent = -200;
    public $capHeight = 700;
    public $bbox = [-200, -300, 1200, 1000];
    public $cmap = [];
    public $adv = [];
    public $numGlyphs = 0;

    private static function u16($b, $o)
    {
        return (ord($b[$o]) << 8) | ord($b[$o + 1]);
    }

    private static function s16($b, $o)
    {
        $v = self::u16($b, $o);
        return $v >= 0x8000 ? $v - 0x10000 : $v;
    }

    private static function u32($b, $o)
    {
        return (ord($b[$o]) << 24) | (ord($b[$o + 1]) << 16) | (ord($b[$o + 2]) << 8) | ord($b[$o + 3]);
    }

    public static function load($bytes)
    {
        $f = new self();
        $f->bytes = $bytes;
        $numTables = self::u16($bytes, 4);
        $tables = [];
        for ($i = 0; $i < $numTables; $i++) {
            $o = 12 + $i * 16;
            $tables[substr($bytes, $o, 4)] = [self::u32($bytes, $o + 8), self::u32($bytes, $o + 12)];
        }
        if (isset($tables['head'])) {
            $o = $tables['head'][0];
            $f->unitsPerEm = self::u16($bytes, $o + 18) ?: 1000;
            $f->bbox = [self::s16($bytes, $o + 36), self::s16($bytes, $o + 38), self::s16($bytes, $o + 40), self::s16($bytes, $o + 42)];
        }
        $numH = 0;
        if (isset($tables['hhea'])) {
            $o = $tables['hhea'][0];
            $f->ascent = self::s16($bytes, $o + 4);
            $f->descent = self::s16($bytes, $o + 6);
            $numH = self::u16($bytes, $o + 34);
        }
        if (isset($tables['maxp'])) $f->numGlyphs = self::u16($bytes, $tables['maxp'][0] + 4);
        if (isset($tables['OS/2'])) {
            $o = $tables['OS/2'][0];
            $ta = self::s16($bytes, $o + 68);
            $td = self::s16($bytes, $o + 70);
            if ($ta) {
                $f->ascent = $ta;
                $f->descent = $td;
            }
            if (self::u16($bytes, $o) >= 2 && $tables['OS/2'][1] >= 90) $f->capHeight = self::s16($bytes, $o + 88);
        }
        if (isset($tables['hmtx']) && $numH > 0) {
            $o = $tables['hmtx'][0];
            $last = 0;
            for ($g = 0; $g < $numH; $g++) {
                $last = self::u16($bytes, $o + $g * 4);
                $f->adv[$g] = $last;
            }
            for ($g = $numH; $g < $f->numGlyphs; $g++) $f->adv[$g] = $last;
        }
        if (isset($tables['cmap'])) $f->parseCmap($tables['cmap'][0]);
        return $f;
    }

    private function parseCmap($base)
    {
        $b = $this->bytes;
        $n = self::u16($b, $base + 2);
        $best = null;
        $bestScore = -1;
        for ($i = 0; $i < $n; $i++) {
            $o = $base + 4 + $i * 8;
            $pid = self::u16($b, $o);
            $eid = self::u16($b, $o + 2);
            $off = self::u32($b, $o + 4);
            $fmt = self::u16($b, $base + $off);
            $score = -1;
            if ($pid === 3 && $eid === 10 && $fmt === 12) $score = 5;
            elseif ($pid === 3 && $eid === 1 && $fmt === 4) $score = 4;
            elseif ($pid === 0 && $fmt === 12) $score = 3;
            elseif ($pid === 0 && $fmt === 4) $score = 2;
            elseif ($fmt === 4 || $fmt === 12) $score = 1;
            if ($score > $bestScore) {
                $bestScore = $score;
                $best = [$base + $off, $fmt];
            }
        }
        if (!$best) return;
        list($o, $fmt) = $best;
        $len = strlen($b);
        if ($fmt === 4) {
            $segX2 = self::u16($b, $o + 6);
            $seg = $segX2 >> 1;
            $endP = $o + 14;
            $startP = $endP + $segX2 + 2;
            $deltaP = $startP + $segX2;
            $rangeP = $deltaP + $segX2;
            for ($s = 0; $s < $seg; $s++) {
                $end = self::u16($b, $endP + $s * 2);
                $start = self::u16($b, $startP + $s * 2);
                $delta = self::u16($b, $deltaP + $s * 2);
                $ro = self::u16($b, $rangeP + $s * 2);
                if ($start > $end || $end - $start > 20000) continue;
                for ($c = $start; $c <= $end && $c !== 0xFFFF; $c++) {
                    if ($ro === 0) {
                        $g = ($c + $delta) & 0xFFFF;
                    } else {
                        $gp = $rangeP + $s * 2 + $ro + ($c - $start) * 2;
                        if ($gp + 1 >= $len) continue;
                        $g = self::u16($b, $gp);
                        if ($g !== 0) $g = ($g + $delta) & 0xFFFF;
                    }
                    if ($g !== 0) $this->cmap[$c] = $g;
                }
            }
        } else {
            $ng = self::u32($b, $o + 12);
            for ($i = 0; $i < $ng; $i++) {
                $p = $o + 16 + $i * 12;
                if ($p + 12 > $len) break;
                $sc = self::u32($b, $p);
                $ec = self::u32($b, $p + 4);
                $sg = self::u32($b, $p + 8);
                if ($ec < $sc || $ec - $sc > 20000) continue;
                for ($c = $sc; $c <= $ec; $c++) $this->cmap[$c] = $sg + ($c - $sc);
            }
        }
    }

    public function gid($cp)
    {
        return isset($this->cmap[$cp]) ? $this->cmap[$cp] : 0;
    }

    /** Advance width in 1/1000 text-space units. */
    public function width($gid)
    {
        $adv = isset($this->adv[$gid]) ? $this->adv[$gid] : (isset($this->adv[0]) ? $this->adv[0] : 500);
        return $adv * 1000 / $this->unitsPerEm;
    }
}

final class LunaPdf
{
    const W = 419.53;
    const H = 595.28;
    const M = 42;
    const TITLE = '0.478 0.145 0.329';
    const BODY = '0.13 0.10 0.14';
    const MUTED = '0.60 0.44 0.53';

    private $objs = [];
    private $font;
    private $used = [];
    private $gidToCp = [];
    private $pages = [];
    private $buf = '';
    private $xobjs = [];
    private $y = 0;
    private $started = false;
    private $rtl = true;
    private $imgCache = [];

    public static function fontBytes()
    {
        $candidates = [dirname(__DIR__) . '/assets/fonts/Amiri-Regular.ttf', LunaStore::$dir . '/fonts/Amiri-Regular.ttf'];
        foreach ($candidates as $p) {
            if (is_file($p) && filesize($p) > 10000) return file_get_contents($p);
        }
        $res = LunaHttp::binary('https://raw.githubusercontent.com/google/fonts/main/ofl/amiri/Amiri-Regular.ttf');
        if ($res['ok'] && strlen($res['data']) > 10000) {
            @file_put_contents(LunaStore::$dir . '/fonts/Amiri-Regular.ttf', $res['data']);
            return $res['data'];
        }
        return null;
    }

    public static function build(array $book, array $chapters, array $images)
    {
        $bytes = self::fontBytes();
        if ($bytes === null) throw new RuntimeException('font-missing');
        $p = new self();
        $p->font = LunaTtf::load($bytes);
        return $p->render($book, $chapters, $images);
    }

    private function reserve()
    {
        $this->objs[] = null;
        return count($this->objs);
    }

    private function set($id, $content)
    {
        $this->objs[$id - 1] = $content;
    }

    private function stream($dict, $data)
    {
        $c = gzcompress($data, 6);
        return '<< ' . $dict . ' /Filter /FlateDecode /Length ' . strlen($c) . " >>\nstream\n" . $c . "\nendstream";
    }

    private function cw()
    {
        return self::W - 2 * self::M;
    }

    private function newPage()
    {
        if ($this->started) $this->pages[] = ['c' => $this->buf, 'x' => $this->xobjs];
        $this->buf = '';
        $this->xobjs = [];
        $this->y = self::H - self::M;
        $this->started = true;
    }

    private function ensure($h)
    {
        if ($this->y - $h < self::M + 12) $this->newPage();
    }

    private function measure(array $cps, $size)
    {
        $w = 0;
        foreach ($cps as $cp) {
            $g = $this->font->gid($cp);
            if ($g === 0) continue;
            $w += $this->font->width($g) * $size / 1000;
        }
        return $w;
    }

    private function encode(array $cps, $size, &$width)
    {
        $hex = '';
        $width = 0;
        foreach ($cps as $cp) {
            $g = $this->font->gid($cp);
            if ($g === 0) continue; // glyphs the font lacks (emoji…) are skipped, never replaced
            $this->used[$g] = true;
            if (!isset($this->gidToCp[$g])) $this->gidToCp[$g] = $cp;
            $hex .= sprintf('%04X', $g);
            $width += $this->font->width($g) * $size / 1000;
        }
        return $hex;
    }

    private function line($text, $size, $bold = false, $color = self::BODY, $align = 'auto')
    {
        $text = trim((string) $text);
        if ($text === '') return;
        $rtl = $this->rtl && LunaArabic::hasArabic($text);
        $cps = LunaArabic::visual(LunaArabic::cps($text), $rtl);
        $this->ensure($size + 4);
        $width = 0;
        $hex = $this->encode($cps, $size, $width);
        if ($hex === '') return;
        if ($align === 'center') $x = max(self::M, (self::W - $width) / 2);
        elseif ($align === 'left' || (!$rtl && $align === 'auto')) $x = self::M;
        else $x = max(self::M, self::W - self::M - $width);
        $this->buf .= sprintf("BT %s rg %s RG /F1 %.2F Tf %s %.2F %.2F Td <%s> Tj%s ET\n", $color, $color, $size, $bold ? '2 Tr 0.35 w' : '0 Tr', $x, $this->y - $size, $hex, $bold ? ' 0 Tr' : '');
        $this->y -= $size + 4;
    }

    private function paragraph($text)
    {
        $size = 11.5;
        $lh = 18;
        $maxW = $this->cw();
        $rtl = $this->rtl && LunaArabic::hasArabic($text);
        $words = preg_split('/\s+/u', trim((string) $text));
        if (!$words) return;
        $spaceW = $this->measure([0x20], $size);
        $lines = [];
        $cur = [];
        $curW = 0;
        foreach ($words as $w) {
            if ($w === '') continue;
            $ww = $this->measure(LunaArabic::visual(LunaArabic::cps($w), $rtl), $size);
            if ($ww > $maxW) {
                if ($cur) {
                    $lines[] = $cur;
                    $cur = [];
                    $curW = 0;
                }
                $chunk = [];
                $chunkW = 0;
                foreach (LunaArabic::cps($w) as $cp) {
                    $cwid = $this->measure(LunaArabic::visual([$cp], $rtl), $size);
                    if ($chunkW + $cwid > $maxW && $chunk) {
                        $lines[] = [self::str($chunk)];
                        $chunk = [];
                        $chunkW = 0;
                    }
                    $chunk[] = $cp;
                    $chunkW += $cwid;
                }
                if ($chunk) {
                    $cur = [self::str($chunk)];
                    $curW = $chunkW;
                }
                continue;
            }
            $add = $cur ? $spaceW + $ww : $ww;
            if ($curW + $add > $maxW && $cur) {
                $lines[] = $cur;
                $cur = [$w];
                $curW = $ww;
            } else {
                $cur[] = $w;
                $curW += $add;
            }
        }
        if ($cur) $lines[] = $cur;
        foreach ($lines as $ln) {
            $this->ensure($lh);
            $this->line(implode(' ', $ln), $size, false, self::BODY, 'auto');
            $this->y -= $lh - ($size + 4);
        }
        $this->y -= 6;
    }

    private static function str(array $cps)
    {
        $s = '';
        foreach ($cps as $cp) $s .= mb_chr($cp, 'UTF-8');
        return $s;
    }

    private static function pngDirect($b)
    {
        if (substr($b, 0, 8) !== "\x89PNG\r\n\x1a\n") return null;
        $w = unpack('N', substr($b, 16, 4))[1];
        $h = unpack('N', substr($b, 20, 4))[1];
        $depth = ord($b[24]);
        $ctype = ord($b[25]);
        $interlace = ord($b[28]);
        if ($depth !== 8 || $interlace !== 0 || !in_array($ctype, [0, 2], true)) return null;
        $pos = 8;
        $idat = '';
        $len = strlen($b);
        while ($pos + 8 <= $len) {
            $clen = unpack('N', substr($b, $pos, 4))[1];
            $type = substr($b, $pos + 4, 4);
            if ($type === 'IDAT') $idat .= substr($b, $pos + 8, $clen);
            if ($type === 'IEND') break;
            $pos += 12 + $clen;
        }
        if ($idat === '') return null;
        $colors = $ctype === 2 ? 3 : 1;
        $cs = $ctype === 2 ? '/DeviceRGB' : '/DeviceGray';
        return ['w' => $w, 'h' => $h, 'obj' => "<< /Type /XObject /Subtype /Image /Width $w /Height $h /ColorSpace $cs /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors $colors /BitsPerComponent 8 /Columns $w >> /Length " . strlen($idat) . " >>\nstream\n" . $idat . "\nendstream"];
    }

    private static function imageObject($bytes, $mime, $depth = 0)
    {
        if ($mime === 'image/jpeg') {
            $d = LunaExport::jpegInfo($bytes);
            if (!$d || !$d['w'] || !$d['h']) return null;
            $cs = $d['c'] === 1 ? '/DeviceGray' : ($d['c'] === 4 ? '/DeviceCMYK' : '/DeviceRGB');
            $extra = $d['c'] === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
            return ['w' => $d['w'], 'h' => $d['h'], 'obj' => "<< /Type /XObject /Subtype /Image /Width {$d['w']} /Height {$d['h']} /ColorSpace $cs /BitsPerComponent 8 /Filter /DCTDecode$extra /Length " . strlen($bytes) . " >>\nstream\n" . $bytes . "\nendstream"];
        }
        if ($mime === 'image/png') {
            $direct = self::pngDirect($bytes);
            if ($direct) return $direct;
        }
        if ($depth === 0 && function_exists('imagecreatefromstring')) {
            $im = @imagecreatefromstring($bytes);
            if ($im) {
                $w = imagesx($im);
                $h = imagesy($im);
                $canvas = imagecreatetruecolor($w, $h);
                $white = imagecolorallocate($canvas, 255, 255, 255);
                imagefill($canvas, 0, 0, $white);
                imagealphablending($canvas, true);
                imagecopy($canvas, $im, 0, 0, 0, 0, $w, $h);
                ob_start();
                imagejpeg($canvas, null, 90);
                $jpg = ob_get_clean();
                imagedestroy($im);
                imagedestroy($canvas);
                if ($jpg) return self::imageObject($jpg, 'image/jpeg', 1);
            }
        }
        return null;
    }

    private function image($bytes, $mime, $key)
    {
        if (array_key_exists($key, $this->imgCache)) return $this->imgCache[$key];
        $info = self::imageObject($bytes, $mime);
        if (!$info) {
            $this->imgCache[$key] = null;
            return null;
        }
        $id = $this->reserve();
        $this->set($id, $info['obj']);
        $this->imgCache[$key] = ['id' => $id, 'w' => $info['w'], 'h' => $info['h']];
        return $this->imgCache[$key];
    }

    private function drawImage(array $img, $w, $h)
    {
        $this->ensure($h + 12);
        $x = self::M + ($this->cw() - $w) / 2;
        $y = $this->y - $h;
        $name = 'Im' . $img['id'];
        $this->xobjs[$name] = $img['id'];
        $this->buf .= sprintf("q %.2F 0 0 %.2F %.2F %.2F cm /%s Do Q\n", $w, $h, $x, $y, $name);
        $this->y -= $h + 14;
    }

    private static function utf16($s)
    {
        return '<FEFF' . strtoupper(bin2hex(mb_convert_encoding((string) $s, 'UTF-16BE', 'UTF-8'))) . '>';
    }

    private function render(array $book, array $chapters, array $images)
    {
        for ($i = 0; $i < 8; $i++) $this->reserve(); // 1 catalog, 2 pages, 3 font, 4 cidfont, 5 descriptor, 6 fontfile, 7 info, 8 tounicode
        $this->rtl = !in_array(substr((string) $book['languageCode'], 0, 2), ['fr', 'en'], true);
        $this->newPage();

        if (!empty($book['cover'])) {
            $img = $this->image($book['cover']['bytes'], $book['cover']['mime'], '__cover__');
            if ($img) {
                $sc = min(($this->cw() - 40) / $img['w'], (self::H - 220) / $img['h'], 1);
                $this->drawImage($img, $img['w'] * $sc, $img['h'] * $sc);
                $this->y -= 12;
            }
        }
        $this->line($book['title'], 19, true, self::TITLE, 'center');
        $this->y -= 4;
        if ($book['author'] !== '') $this->line($book['author'], 11, false, self::MUTED, 'center');
        $this->line($book['sourceUrl'], 8, false, self::MUTED, 'center');
        $this->y -= 8;
        if ($book['description'] !== '') {
            $this->line('الوصف', 12, true, self::TITLE);
            $this->paragraph($book['description']);
        }
        if (!empty($book['unavailable'])) {
            $this->line('فصول لم تُقرأ تلقائيًا', 11, true, self::MUTED);
            foreach ($book['unavailable'] as $u) $this->line($u['idx'] . '. ' . $u['title'], 9, false, self::MUTED);
        }

        foreach ($chapters as $ch) {
            $this->newPage();
            $this->line($ch['idx'] . '. ' . $ch['title'], 15, true, self::TITLE, 'center');
            $this->y -= 10;
            foreach ($ch['blocks'] as $b) {
                if ($b['type'] === 'p') {
                    if (trim($b['text']) !== '') $this->paragraph($b['text']);
                } elseif ($b['type'] === 'h') {
                    $this->y -= 4;
                    $this->line($b['text'], 12.5, true, self::TITLE);
                    $this->y -= 4;
                } elseif (isset($images[$b['src']])) {
                    $im = $this->image($images[$b['src']]['bytes'], $images[$b['src']]['mime'], $b['src']);
                    if ($im) {
                        $sc = min($this->cw() / $im['w'], 420 / $im['h'], 1);
                        $this->drawImage($im, $im['w'] * $sc, $im['h'] * $sc);
                    }
                }
            }
        }
        $this->pages[] = ['c' => $this->buf, 'x' => $this->xobjs];

        // page numbers
        foreach ($this->pages as $i => &$pg) {
            if ($i === 0) continue;
            $label = LunaArabic::cps((string) ($i + 1));
            $w = 0;
            $hex = $this->encode($label, 9, $w);
            $pg['c'] .= sprintf("BT %s rg /F1 9 Tf %.2F %.2F Td <%s> Tj ET\n", self::MUTED, (self::W - $w) / 2, self::M / 2, $hex);
        }
        unset($pg);

        $kids = [];
        foreach ($this->pages as $pg) {
            $cid = $this->reserve();
            $this->set($cid, $this->stream('', $pg['c']));
            $pid = $this->reserve();
            $xo = '';
            foreach ($pg['x'] as $name => $oid) $xo .= "/$name $oid 0 R ";
            $this->set($pid, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' . self::W . ' ' . self::H . '] /Resources << /Font << /F1 3 0 R >> /XObject << ' . $xo . '>> /ProcSet [/PDF /Text /ImageB /ImageC] >> /Contents ' . $cid . ' 0 R >>');
            $kids[] = $pid . ' 0 R';
        }
        $this->set(2, '<< /Type /Pages /Kids [' . implode(' ', $kids) . '] /Count ' . count($kids) . ' >>');
        $this->set(1, '<< /Type /Catalog /Pages 2 0 R /Lang (' . ($this->rtl ? 'ar' : 'en') . ') >>');

        $f = $this->font;
        $scale = 1000 / $f->unitsPerEm;
        ksort($this->used);
        $W = '';
        $bf = '';
        $count = 0;
        foreach (array_keys($this->used) as $g) {
            $W .= $g . ' [' . round($f->width($g), 1) . '] ';
            $cp = $this->gidToCp[$g];
            $u = $cp > 0xFFFF ? sprintf('%04X%04X', 0xD800 + (($cp - 0x10000) >> 10), 0xDC00 + (($cp - 0x10000) & 0x3FF)) : sprintf('%04X', $cp);
            $bf .= sprintf("<%04X> <%s>\n", $g, $u);
            $count++;
        }
        $bbox = array_map(function ($v) use ($scale) {
            return (int) round($v * $scale);
        }, $f->bbox);
        $this->set(6, $this->stream('/Length1 ' . strlen($f->bytes), $f->bytes));
        $this->set(5, '<< /Type /FontDescriptor /FontName /Amiri /Flags 4 /FontBBox [' . implode(' ', $bbox) . '] /ItalicAngle 0 /Ascent ' . (int) round($f->ascent * $scale) . ' /Descent ' . (int) round($f->descent * $scale) . ' /CapHeight ' . (int) round($f->capHeight * $scale) . ' /StemV 80 /FontFile2 6 0 R >>');
        $this->set(4, '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Amiri /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /DW 1000 /W [ ' . $W . '] /CIDToGIDMap /Identity >>');
        $cmap = "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n";
        $chunks = array_chunk(array_filter(explode("\n", trim($bf))), 100);
        foreach ($chunks as $chunk) $cmap .= count($chunk) . " beginbfchar\n" . implode("\n", $chunk) . "\nendbfchar\n";
        $cmap .= "endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n";
        $this->set(8, $this->stream('', $cmap));
        $this->set(3, '<< /Type /Font /Subtype /Type0 /BaseFont /Amiri /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 8 0 R >>');
        $this->set(7, '<< /Title ' . self::utf16($book['title']) . ' /Author ' . self::utf16($book['author']) . ' /Subject ' . self::utf16(mb_substr($book['description'], 0, 300)) . ' /Producer (Luna Chan) /Creator (Luna Chan) /CreationDate (D:' . date('YmdHis') . ') >>');

        $out = "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n";
        $offsets = [];
        foreach ($this->objs as $i => $content) {
            $offsets[$i + 1] = strlen($out);
            $out .= ($i + 1) . " 0 obj\n" . $content . "\nendobj\n";
        }
        $xref = strlen($out);
        $n = count($this->objs) + 1;
        $out .= "xref\n0 $n\n0000000000 65535 f \n";
        for ($i = 1; $i < $n; $i++) $out .= sprintf("%010d 00000 n \n", $offsets[$i]);
        $out .= "trailer\n<< /Size $n /Root 1 0 R /Info 7 0 R >>\nstartxref\n$xref\n%%EOF\n";
        return $out;
    }
}
