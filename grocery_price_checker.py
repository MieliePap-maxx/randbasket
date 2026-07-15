from __future__ import annotations

import html
import json
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote_plus
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
DATA_DIR = ROOT / "data"
ITEMS_FILE = DATA_DIR / "items.json"
SETTINGS_FILE = DATA_DIR / "settings.json"
HISTORY_FILE = DATA_DIR / "history.json"
HOST = "127.0.0.1"
PORT = 8765


DEFAULT_ITEMS = [
    {"id": "milk-2l", "name": "Milk 2L", "query": "milk 2l", "quantity": 1, "category": "Dairy"},
    {"id": "eggs-18", "name": "Eggs 18 pack", "query": "eggs 18", "quantity": 1, "category": "Staples"},
    {"id": "bread", "name": "Brown bread", "query": "brown bread", "quantity": 1, "category": "Bakery"},
    {"id": "chicken", "name": "Chicken fillets 1kg", "query": "chicken fillets 1kg", "quantity": 1, "category": "Meat"},
]

DEFAULT_SETTINGS = {
    "location": "South Africa",
    "ebucksCashbackPercent": 0,
    "maxResultsPerStore": 6,
    "preferredStore": "pick-n-pay",
    "stores": {
        "pick-n-pay": True,
        "checkers": True,
        "shoprite": True,
        "woolworths": True,
        "food-lovers-market": True,
    },
}


@dataclass(frozen=True)
class Store:
    id: str
    name: str
    search_url: str
    notes: str


STORES = [
    Store(
        "pick-n-pay",
        "Pick n Pay",
        "https://www.pnp.co.za/pnpstorefront/pnp/en/search/?text={query}",
        "FNB/eBucks value is applied after the shelf price.",
    ),
    Store(
        "checkers",
        "Checkers",
        "https://www.checkers.co.za/search?query={query}",
        "Online prices can depend on delivery area.",
    ),
    Store(
        "shoprite",
        "Shoprite",
        "https://www.shoprite.co.za/search?query={query}",
        "Online prices can depend on delivery area.",
    ),
    Store(
        "woolworths",
        "Woolworths",
        "https://www.woolworths.co.za/cat?Ntt={query}",
        "Food results may vary by store and fulfilment method.",
    ),
    Store(
        "food-lovers-market",
        "Food Lover's Market",
        "https://foodloversmarket.co.za/?s={query}",
        "Often publishes specials rather than a complete live catalogue.",
    ),
]


def ensure_files() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    if not ITEMS_FILE.exists():
        write_json(ITEMS_FILE, DEFAULT_ITEMS)
    if not SETTINGS_FILE.exists():
        write_json(SETTINGS_FILE, DEFAULT_SETTINGS)
    if not HISTORY_FILE.exists():
        write_json(HISTORY_FILE, [])


def read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return fallback


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=True), encoding="utf-8")


def money(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        amount = float(value)
        return amount / 100 if amount > 10000 else amount
    text = html.unescape(str(value))
    text = text.replace("&nbsp;", " ").replace(",", ".")
    match = re.search(r"(?:R|ZAR)?\s*([0-9]+(?:\.[0-9]{1,2})?)", text, re.I)
    if not match:
        return None
    return float(match.group(1))


def clean_text(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:180]


def clean_page_text(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def similarity(query: str, name: str) -> float:
    q_words = {w for w in re.findall(r"[a-z0-9]+", query.lower()) if len(w) > 1}
    n_words = {w for w in re.findall(r"[a-z0-9]+", name.lower()) if len(w) > 1}
    if not q_words or not n_words:
        return 0
    overlap = len(q_words & n_words)
    return overlap / max(len(q_words), 1)


def fetch(url: str) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 GroceryPriceChecker/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-ZA,en;q=0.8",
        },
    )
    with urlopen(request, timeout=25) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def walk_json(value: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(value, dict):
        name = value.get("name") or value.get("title") or value.get("displayName") or value.get("productName")
        price = (
            value.get("price")
            or value.get("sellingPrice")
            or value.get("currentPrice")
            or value.get("displayPrice")
            or value.get("wasPrice")
        )
        if isinstance(price, dict):
            price = price.get("value") or price.get("amount") or price.get("formattedValue")
        amount = money(price)
        if name and amount:
            found.append(
                {
                    "name": clean_text(name),
                    "price": amount,
                    "url": value.get("url") or value.get("pdpUrl") or value.get("productUrl"),
                }
            )
        for child in value.values():
            found.extend(walk_json(child))
    elif isinstance(value, list):
        for child in value:
            found.extend(walk_json(child))
    return found


def extract_json_blocks(page: str) -> list[Any]:
    blocks: list[Any] = []
    scripts = re.findall(r"<script[^>]*type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>", page, re.I | re.S)
    next_data = re.findall(r"<script[^>]*id=[\"']__NEXT_DATA__[\"'][^>]*>(.*?)</script>", page, re.I | re.S)
    for raw in [*scripts, *next_data]:
        try:
            blocks.append(json.loads(html.unescape(raw.strip())))
        except json.JSONDecodeError:
            continue
    return blocks


def extract_generic_products(page: str) -> list[dict[str, Any]]:
    text = clean_page_text(page)
    products: list[dict[str, Any]] = []
    for match in re.finditer(r"(.{0,90}?)(R\s*[0-9]+(?:[\.,][0-9]{2})?)(.{0,70})", text, re.I):
        before, raw_price, after = match.groups()
        label = clean_text(f"{before} {after}")
        amount = money(raw_price)
        if amount and label:
            products.append({"name": label, "price": amount, "url": None})
    return products


def dedupe_products(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, float]] = set()
    unique: list[dict[str, Any]] = []
    for product in products:
        name = clean_text(product.get("name"))
        price = money(product.get("price"))
        if not name or price is None:
            continue
        if is_junk_product_name(name):
            continue
        key = (name.lower(), round(price, 2))
        if key in seen:
            continue
        seen.add(key)
        unique.append({"name": name, "price": round(price, 2), "url": product.get("url")})
    return unique


def is_junk_product_name(name: str) -> bool:
    text = name.lower()
    junk_tokens = (
        "font-weight",
        "font-display",
        "woff",
        "src:url",
        "format(",
        "_media",
        "categoryurl",
        "categoryname",
        "navigation",
        "showinmobile",
        "_content_type_uid",
        "sub_cats",
        ".png",
        ".jpg",
        ".webp",
        "appbanner",
        "captcha",
        "cookie",
        "function(",
        "stylesheet",
        "scriptloader",
        "window.",
        "document.",
        "webpack",
        "buildid",
    )
    return any(token in text for token in junk_tokens) or bool(re.search(r"[{}\\]{2,}", text))


def scan_store(store: Store, item: dict[str, Any], settings: dict[str, Any]) -> dict[str, Any]:
    query = item.get("query") or item.get("name") or ""
    url = store.search_url.format(query=quote_plus(query))
    started = time.time()
    try:
        page = fetch(url)
        products: list[dict[str, Any]] = []
        for block in extract_json_blocks(page):
            products.extend(walk_json(block))
        products.extend(extract_generic_products(page))
        products = dedupe_products(products)
        products.sort(key=lambda p: (-similarity(query, p["name"]), p["price"]))
        limit = int(settings.get("maxResultsPerStore") or 6)
        best = products[0] if products else None
        status = "ok" if best else "no-price-found"
        return {
            "storeId": store.id,
            "storeName": store.name,
            "status": status,
            "queryUrl": url,
            "price": best["price"] if best else None,
            "productName": best["name"] if best else None,
            "productUrl": best.get("url") if best else None,
            "candidates": products[:limit],
            "elapsedMs": round((time.time() - started) * 1000),
            "message": "" if best else "The page loaded, but no usable product price was found.",
        }
    except HTTPError as exc:
        return {
            "storeId": store.id,
            "storeName": store.name,
            "status": "blocked",
            "queryUrl": url,
            "price": None,
            "productName": None,
            "productUrl": None,
            "candidates": [],
            "elapsedMs": round((time.time() - started) * 1000),
            "message": f"HTTP {exc.code}: the retailer did not return a readable page.",
        }
    except (URLError, TimeoutError, OSError) as exc:
        return {
            "storeId": store.id,
            "storeName": store.name,
            "status": "error",
            "queryUrl": url,
            "price": None,
            "productName": None,
            "productUrl": None,
            "candidates": [],
            "elapsedMs": round((time.time() - started) * 1000),
            "message": str(exc),
        }


def apply_value_adjustments(scan: dict[str, Any], settings: dict[str, Any]) -> dict[str, Any]:
    cashback = float(settings.get("ebucksCashbackPercent") or 0)
    quantity = float(scan.get("quantity") or 1)
    for result in scan["results"]:
        price = result.get("price")
        if price is None:
            result["effectivePrice"] = None
            result["lineTotal"] = None
            result["valueAdjustments"] = []
            continue
        adjustments = []
        effective = float(price)
        if result["storeId"] == "pick-n-pay" and cashback > 0:
            discount = effective * (cashback / 100)
            effective -= discount
            adjustments.append({"label": "FNB eBucks", "amount": round(discount, 2)})
        result["effectivePrice"] = round(effective, 2)
        result["lineTotal"] = round(effective * quantity, 2)
        result["valueAdjustments"] = adjustments
    priced = [r for r in scan["results"] if r.get("effectivePrice") is not None]
    best = min(priced, key=lambda r: r["effectivePrice"], default=None)
    scan["bestStoreId"] = best["storeId"] if best else None
    scan["bestStoreName"] = best["storeName"] if best else None
    scan["bestEffectivePrice"] = best["effectivePrice"] if best else None
    return scan


def run_scan() -> dict[str, Any]:
    ensure_files()
    items = read_json(ITEMS_FILE, DEFAULT_ITEMS)
    settings = read_json(SETTINGS_FILE, DEFAULT_SETTINGS)
    enabled = settings.get("stores") or {}
    scans = []
    for item in items:
        item_scan = {
            "itemId": item.get("id"),
            "name": item.get("name"),
            "query": item.get("query") or item.get("name"),
            "quantity": item.get("quantity") or 1,
            "category": item.get("category") or "",
            "results": [],
        }
        for store in STORES:
            if enabled.get(store.id, True):
                item_scan["results"].append(scan_store(store, item, settings))
        scans.append(apply_value_adjustments(item_scan, settings))
    basket_totals: dict[str, dict[str, Any]] = {}
    for store in STORES:
        total = 0.0
        missing = 0
        for scan in scans:
            result = next((r for r in scan["results"] if r["storeId"] == store.id), None)
            if not result or result.get("lineTotal") is None:
                missing += 1
            else:
                total += result["lineTotal"]
        if enabled.get(store.id, True):
            basket_totals[store.id] = {
                "storeId": store.id,
                "storeName": store.name,
                "total": round(total, 2),
                "missing": missing,
            }
    complete_totals = [v for v in basket_totals.values() if v["missing"] == 0]
    best_basket = min(complete_totals, key=lambda v: v["total"], default=None)
    entry = {
        "id": str(uuid.uuid4()),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "settings": settings,
        "items": items,
        "scans": scans,
        "basketTotals": basket_totals,
        "bestBasketStoreId": best_basket["storeId"] if best_basket else None,
    }
    history = read_json(HISTORY_FILE, [])
    history.insert(0, entry)
    write_json(HISTORY_FILE, history[:52])
    return entry


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {fmt % args}")

    def read_body(self) -> Any:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        return json.loads(raw or "{}")

    def send_json(self, data: Any, status: int = 200) -> None:
        payload = json.dumps(data, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        ensure_files()
        if self.path == "/api/state":
            history = read_json(HISTORY_FILE, [])
            self.send_json(
                {
                    "items": read_json(ITEMS_FILE, DEFAULT_ITEMS),
                    "settings": read_json(SETTINGS_FILE, DEFAULT_SETTINGS),
                    "history": history[:12],
                    "stores": [store.__dict__ for store in STORES],
                }
            )
            return
        if self.path == "/api/history":
            self.send_json(read_json(HISTORY_FILE, []))
            return
        super().do_GET()

    def do_POST(self) -> None:
        ensure_files()
        try:
            if self.path == "/api/items":
                body = self.read_body()
                items = body.get("items", [])
                for item in items:
                    item.setdefault("id", str(uuid.uuid4()))
                    item["name"] = clean_text(item.get("name"))
                    item["query"] = clean_text(item.get("query") or item.get("name"))
                    item["category"] = clean_text(item.get("category"))
                    item["quantity"] = float(item.get("quantity") or 1)
                write_json(ITEMS_FILE, items)
                self.send_json({"ok": True, "items": items})
                return
            if self.path == "/api/settings":
                settings = read_json(SETTINGS_FILE, DEFAULT_SETTINGS)
                incoming = self.read_body().get("settings", {})
                settings.update(incoming)
                settings["stores"] = {**DEFAULT_SETTINGS["stores"], **settings.get("stores", {})}
                write_json(SETTINGS_FILE, settings)
                self.send_json({"ok": True, "settings": settings})
                return
            if self.path == "/api/scan":
                self.send_json(run_scan())
                return
            self.send_error(HTTPStatus.NOT_FOUND)
        except Exception as exc:  # Keeps the local app responsive and surfaces the real problem in the UI.
            self.send_json({"ok": False, "error": str(exc)}, status=500)


def main() -> None:
    ensure_files()
    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    print(f"South Africa Grocery Price Checker running at http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")


if __name__ == "__main__":
    main()
