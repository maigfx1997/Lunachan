# 🌙 نشر «لونا تشان» على الاستضافات المجانية

للمشروع نسختان تعملان بنفس الواجهة والمزايا:

| النسخة | متى تُستخدم | ما تحتاجه |
| --- | --- | --- |
| **نسخة PHP المستقلّة** (`index.php` + مجلد `php/`) | استضافات PHP فقط مثل **aeonfree** وأي استضافة مشتركة | PHP 7.4+ مع cURL و DOM و mbstring و zlib (كلها متوفرة في aeonfree) — **بدون Node وبدون قاعدة بيانات** |
| نسخة Next.js (`src/`) | استضافات Node (Render, Railway, VPS…) | Node 20 + PostgreSQL |

---

## أ) استضافة PHP مجانية (aeonfree وما شابهها) — الأسهل

### 1) الملفات التي ترفعينها إلى `htdocs`

```
index.php            نقطة الدخول (الموجّه + API + الواجهة)
.htaccess            تمرير المسارات إلى index.php وحماية الملفات
php/                 المحرّك: Http.php  Dom.php  Scraper.php  Store.php  Export.php  Pdf.php  App.php  ui.php  .htaccess
assets/fonts/        Amiri-Regular.ttf و Amiri-Bold.ttf (خط PDF العربي — مهم)
```

لا ترفعي `node_modules` ولا `.next` ولا `src` — لا حاجة لها في نسخة PHP.

### 2) لا إعدادات مطلوبة

- يُنشأ مجلد `data/` تلقائيًا لتخزين الروايات (محمي بـ `.htaccess`).
- الغلاف يُحفظ بملفه الأصلي، والفصول تُحفظ كملفات JSON.
- إن لم يُرفع مجلد `assets/fonts` يحاول الموقع تنزيل خط Amiri مرة واحدة إلى `data/fonts/`.

### 3) الفحص

- `https://موقعك/index.php?r=health` → `{"ok":true,"engine":"php"}`
- `https://موقعك/index.php?r=diag` → إصدار PHP، الإضافات، قابلية الكتابة، وجود الخط.

### 4) لماذا ظهرت صفحة «400 Bad Request — The plain HTTP request was sent to HTTPS port» سابقًا؟

النسخة القديمة من `index.php` كانت تحاول تمرير الطلبات إلى خدمة Node وتقرأ المنفذ من متغير
`SERVER_PORT` الخاص بـ Apache (وهو 443 على HTTPS) فوصلت الطلبات إلى منفذ HTTPS للخادم نفسه.
النسخة الحالية تعمل بمحرّك PHP مباشرة، ولا تمرّر إلى Node إلا إن كتبتِ `LUNA_NODE_URL`
صراحةً في `luna.env` **وردّت** خدمة Node على `/api/health` بـ `{"ok":true}`.

### 5) ملاحظات على الاستضافات المجانية

- السحب يتم من متصفح الزائرة فصلًا فصلًا (طلب صغير لكل فصل) فلا تنتهي مهلة 30 ثانية.
- التصدير مع الصور له ميزانية زمنية داخلية؛ الصور التي لم يُمكن تنزيلها في الوقت تُهمل ولا تُختلق.
- لا تسجيل دخول، لا إعلانات، ولا أي نص مُختلق.

---

## ب) استضافة Node (Next.js + PostgreSQL)

```bash
npm install
npx drizzle-kit push
npm run build
node scripts/aeonfree-start.js   # أو npm start — يقرأ المنفذ من PORT/SERVER_PORT
```

المتغيرات: `DATABASE_URL` (PostgreSQL) و `NODE_ENV=production`. فحص الصحة: `/api/health`.

### تشغيل النسختين معًا (اختياري)

إن كانت خدمة Node تعمل على نفس السيرفر، أنشئي `luna.env` بجانب `index.php`:

```
LUNA_NODE_URL=http://127.0.0.1:3000
```

عندها يمرّر `index.php` كل الطلبات إلى Next.js، وإن توقفت الخدمة يعود تلقائيًا إلى محرّك PHP.
