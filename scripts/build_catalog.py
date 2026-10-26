#!/usr/bin/env python3
"""Build public/data/catalog.json from the local product CSV or FEED_URL."""
import csv
import io
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCAL_CSV = ROOT / "data" / "products.csv"
OUT_DIR = ROOT / "public" / "data"
REQUIRED = ["id", "shop", "category", "title", "price_toman", "color_name",
            "color_hex", "sizes", "style", "gender", "url"]
CATEGORIES = {
    "top": {"tee", "shirt", "blouse"},
    "bottom": {"straight", "wide", "jeans", "skirt"},
    "outer": {"short", "long", "jacket", "coat"},
    "dress": {"dress", "onepiece"},
    "shoes": {"sneaker", "boot", "flat", "heel"},
    "bag": {"handbag", "shoulder", "tote", "backpack"},
}
GENDERS = {"women", "men", "unisex"}
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

def load_csv_text():
    feed = os.environ.get("FEED_URL", "").strip()
    if feed:
        try:
            req = urllib.request.Request(feed, headers={"User-Agent": "tryon-mvp-build"})
            with urllib.request.urlopen(req, timeout=30) as response:
                return response.read().decode("utf-8-sig")
        except Exception as error:
            print(f"WARNING: FEED_URL failed; using local CSV: {error}", file=sys.stderr)
    return LOCAL_CSV.read_text(encoding="utf-8-sig")

def parse(text):
    reader = csv.DictReader(io.StringIO(text))
    missing = [name for name in REQUIRED if name not in (reader.fieldnames or [])]
    if missing:
        raise ValueError(f"Missing CSV columns: {missing}")
    items, seen, errors = [], set(), []
    for line, row in enumerate(reader, start=2):
        try:
            product_id = row["id"].strip()
            category = row["category"].strip()
            style = row["style"].strip()
            if not product_id or product_id in seen:
                raise ValueError("ID is empty or duplicated")
            if category not in CATEGORIES:
                raise ValueError(f"Invalid category: {category}")
            if style not in CATEGORIES[category]:
                raise ValueError(f"Invalid style '{style}' for category '{category}'")
            if row["gender"].strip() not in GENDERS:
                raise ValueError(f"Invalid gender: {row['gender']}")
            if not HEX.fullmatch(row["color_hex"].strip()):
                raise ValueError(f"Invalid color_hex: {row['color_hex']}")
            price = int(row["price_toman"])
            if price <= 0:
                raise ValueError("Price must be positive")
            sizes = row["sizes"].split()
            if not sizes:
                raise ValueError("Sizes cannot be empty")
        except (ValueError, TypeError) as error:
            errors.append(f"Line {line}: {error}")
            continue
        seen.add(product_id)
        items.append({
            "id": product_id, "shop": row["shop"].strip(), "category": category,
            "title": row["title"].strip(), "price": price,
            "color_name": row["color_name"].strip(), "color_hex": row["color_hex"].strip().lower(),
            "sizes": sizes, "style": style, "gender": row["gender"].strip(),
            "url": row["url"].strip(), "image": (row.get("image") or "").strip()
        })
    if errors:
        raise ValueError("Invalid catalog rows:\n" + "\n".join(errors))
    if not items:
        raise ValueError("Catalog is empty")
    return items

def main():
    items = parse(load_csv_text())
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "count": len(items), "items": items}
    (OUT_DIR / "catalog.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(items)} products to public/data/catalog.json")

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
