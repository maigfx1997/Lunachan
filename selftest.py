import json, time, urllib.request, urllib.error, concurrent.futures, sys

BASE = "http://127.0.0.1:3111"

def post(path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else b"{}"
    req = urllib.request.Request(BASE + path, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"httpError": e.code, "body": e.read().decode()[:300]}

def get_raw(path, timeout=300):
    req = urllib.request.Request(BASE + path)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, dict(r.headers), r.read()

TARGETS = [
    ("novlar", "https://www.novlar.com/views/novel/details.php?id=6811"),
    ("uranus", "https://uranus-novel.com/ar/novels/130"),
    ("wattpad", "https://www.wattpad.com/story/409108861"),
]

results = {}
for name, url in TARGETS:
    imp = post("/api/import", {"url": url})
    if "book" not in imp:
        print(f"[{name}] IMPORT FAILED: {imp}")
        continue
    book = imp["book"]
    chapters = imp["chapters"]
    print(f"[{name}] id={book['id']} title={book['title']!r} author={book['author']!r} cover={book['hasCover']} coverUrl={'yes' if book['coverUrl'] else 'no'}")
    print(f"[{name}] desc({len(book['description'])} chars): {book['description'][:90]!r}")
    print(f"[{name}] chapters={len(chapters)} first3={[c['title'] for c in chapters[:3]]}")
    idxs = [c["idx"] for c in chapters][:6]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        list(ex.map(lambda i: post(f"/api/books/{book['id']}/chapters/{i}/fetch"), idxs))
    detail = json.loads(urllib.request.urlopen(f"{BASE}/api/books/{book['id']}").read().decode())
    fetched = [c for c in detail["chapters"] if c["status"] == "done"]
    print(f"[{name}] fetched {len(fetched)}/{len(detail['chapters'])} (tested first {len(idxs)})")
    if fetched:
        first = fetched[0]
        ch = json.loads(urllib.request.urlopen(f"{BASE}/api/books/{book['id']}/chapters/{first['idx']}").read().decode())["chapter"]
        kinds = {}
        for b in ch["blocks"]:
            kinds[b["type"]] = kinds.get(b["type"], 0) + 1
        print(f"[{name}] chapter '{first['title'][:40]}' words={ch['wordCount']} blocks={kinds} images={ch['imageCount']}")
        sample = " | ".join(b.get("text", "")[:80] for b in ch["blocks"] if b["type"] == "p")[:260]
        print(f"[{name}] sample: {sample}")
    results[name] = {"id": book["id"], "chapters": len(detail["chapters"])}

print("\n=== exports ===")
for name, info in results.items():
    bid = info["id"]
    for fmt in ["epub", "pdf", "docx", "fb2", "html", "txt", "md", "json"]:
        try:
            status, headers, body = get_raw(f"/api/books/{bid}/export?format={fmt}")
            magic = body[:4]
            print(f"[{name}] {fmt}: {status} {len(body)} bytes magic={magic!r} mime={headers.get('content-type')}")
            if fmt in ("epub", "docx"):
                open(f"/tmp/{name}.{fmt}", "wb").write(body)
            if fmt == "pdf":
                open(f"/tmp/{name}.pdf", "wb").write(body)
        except urllib.error.HTTPError as e:
            print(f"[{name}] {fmt}: HTTP {e.code} {e.read().decode()[:160]}")
        except Exception as e:
            print(f"[{name}] {fmt}: ERROR {e}")
    w = json.loads(urllib.request.urlopen(f"{BASE}/api/books/{bid}/weights").read().decode())
    print(f"[{name}] weights words={w['totals']['words']} images={w['totals']['images']} formats={[(f['format'], f['bytes']) for f in w['formats'][:4]]}")
