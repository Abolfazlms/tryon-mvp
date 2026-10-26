#!/usr/bin/env python3
"""ساخت public/data/catalog.json از فایل CSV محصولات.

اجرا:  python3 scripts/build_catalog.py

- پیش‌فرض: data/products.csv
- اگر متغیر محیطی FEED_URL تنظیم شده باشد (مثلاً از GitHub Secret)، فایل CSV
  از آن آدرس دانلود می‌شود. ستون‌ها باید همان ستون‌های data/products.csv باشند.
  اگر دانلود شکست بخورد، از فایل محلی استفاده می‌شود و هشدار چاپ می‌شود.
- اگر داده‌ی نامعتبر باشد، با پیام روشن متوقف می‌شود (تا سایت خراب منتشر نشود).
"""
import csv
import io
import json
import os
import re
import shutil
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCAL_CSV = ROOT / "data" / "products.csv"
CHARTS = ROOT / "data" / "size_charts.json"
OUT_DIR = ROOT / "public" / "data"

REQUIRED = ["id", "shop", "category", "title", "price_toman", "color_name",
            "color_hex", "sizes", "style", "gender", "url"]
CATEGORIES = {"top": {"tee", "shirt"},
              "bottom": {"straight", "wide"},
              "outer": {"short", "long"},
              "shoes": {"sneaker", "boot", "flat"}}
GENDERS = {"women", "men", "unisex"}
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def load_csv_text() -> str:
    feed = os.environ.get("FEED_URL", "").strip()
    if feed:
        try:
            req = urllib.request.Request(feed, headers={"User-Agent": "tryon-mvp-build"})
            with urllib.request.urlopen(req, timeout=30) as r:
                text = r.read().decode("utf-8-sig")
            print(f"catalog: loaded feed from FEED_URL ({len(text)} bytes)")
            return text
        except Exception as e:  # noqa: BLE001
            print(f"WARNING: FEED_URL failed ({e}); falling back to local CSV", file=sys.stderr)
    return LOCAL_CSV.read_text(encoding="utf-8-sig")


def parse(text: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(text))
    missing = [c for c in REQUIRED if c not in (reader.fieldnames or [])]
    if missing:
        sys.exit(f"ERROR: missing CSV columns: {missing}")
    items, seen, errors = [], set(), []
    for n, row in enumerate(reader, start=2):
        pid = row["id"].strip()
        cat = row["category"].strip()
        try:
            if not pid or pid in seen:
                raise ValueError("id خالی یا تکراری")
            if cat not in CATEGORIES:
                raise ValueError(f"category نامعتبر: {cat}")
            if row["style"].strip() not in CATEGORIES[cat]:
                raise ValueError(f"style نامعتبر برای {cat}: {row['style']}")
            if row["gender"].strip() not in GENDERS:
                raise ValueError(f"gender نامعتبر: {row['gender']}")
            if not HEX.match(row["color_hex"].strip()):
                raise ValueError(f"color_hex نامعتبر: {row['color_hex']}")
            price = int(row["price_toman"])
            if price <= 0:
                raise ValueError("قیمت باید مثبت باشد")
            sizes = row["sizes"].split()
            if not sizes:
                raise ValueError("sizes خالی است")
        except ValueError as e:
            errors.append(f"خط {n} ({pid or '?'}): {e}")
            continue
        seen.add(pid)
        items.append({
            "id": pid,
            "shop": row["shop"].strip(),
            "category": cat,
            "title": row["title"].strip(),
            "price": price,
            "color_name": row["color_name"].strip(),
            "color_hex": row["color_hex"].strip().lower(),
            "sizes": sizes,
            "style": row["style"].strip(),
            "gender": row["gender"].strip(),
            "url": row["url"].strip(),
            "image": (row.get("image") or "").strip(),
        })
    if errors:
        sys.exit("ERROR: invalid rows:\n  " + "\n  ".join(errors))
    if not items:
        sys.exit("ERROR: catalog is empty")
    return items


def main() -> None:
    items = parse(load_csv_text())
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    catalog = {
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "count": len(items),
        "items": items,
    }
    (OUT_DIR / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
    shutil.copyfile(CHARTS, OUT_DIR / "size_charts.json")
    print(f"catalog: wrote {len(items)} products -> {OUT_DIR / 'catalog.json'}")


if __name__ == "__main__":
    main()
