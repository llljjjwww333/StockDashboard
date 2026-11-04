import asyncio
from collections import OrderedDict
from datetime import datetime, timezone
from math import isfinite
import re
import time
from unicodedata import normalize
from urllib.parse import urlencode


CN_INDICES = {
    "SH000001": "上证指数",
    "SZ399001": "深证成指",
    "SZ399006": "创业板指",
    "SH000688": "科创50",
    "SH000300": "沪深300",
    "SH000905": "中证500",
    "SH000852": "中证1000",
    "SH000016": "上证50",
    "BJ899050": "北证50",
}
BOARD_PAGE_SIZE = 24


def _number(value):
    try:
        number = float(value)
        return number if isfinite(number) else None
    except (ValueError, TypeError):
        return None


class ChinaBoardFeed:
    def __init__(self, get_json):
        self.get_json = get_json
        self.cache = OrderedDict()
        self.pending = {}
        self.membership_limit = asyncio.Semaphore(4)

    def _fetch(self, category, sort, page, board, catalog=False):
        page_size = 100 if catalog else 12 if board else BOARD_PAGE_SIZE
        params = urlencode({
            "pn": page, "pz": page_size,
            "po": 0 if catalog or sort == "weak" else 1, "np": 1, "fltt": 2, "invt": 2,
            "fid": "f12" if catalog else "f6" if sort == "amount" else "f3",
            "fs": f"b:{board}+f:!50" if board else f"m:90+t:{2 if category == 'industry' else 3}+f:!50",
            "fields": "f2,f3,f5,f6,f8,f10,f12,f14,f104,f105,f106,f128,f136,f140",
        })
        try:
            payload = self.get_json(f"https://push2.eastmoney.com/api/qt/clist/get?{params}", 4)
        except (OSError, ValueError):
            payload = self.get_json(f"https://82.push2.eastmoney.com/api/qt/clist/get?{params}", 4)
        data = payload.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("diff"), list):
            raise ValueError("Eastmoney board data unavailable")
        rows = []
        pattern = r"\d{6}" if board else r"BK\d{4}"
        for item in data["diff"]:
            if not isinstance(item, dict):
                continue
            ticker, name = str(item.get("f12", "")), str(item.get("f14", "")).strip()
            change, price = _number(item.get("f3")), _number(item.get("f2"))
            if not re.fullmatch(pattern, ticker) or not name or change is None or price is None or price <= 0:
                continue
            row = {"ticker": ticker, "name": name, "price": price, "change_percent": change,
                   "amount": _number(item.get("f6")), "volume": int(_number(item.get("f5")) or 0) * 100}
            if board:
                row.update(turnover_rate=_number(item.get("f8")), volume_ratio=_number(item.get("f10")))
            else:
                row.update(advancers=_number(item.get("f104")), decliners=_number(item.get("f105")), flat=_number(item.get("f106")),
                           leader_name=item.get("f128") if re.fullmatch(r"\d{6}", str(item.get("f140", ""))) else None,
                           leader_change=_number(item.get("f136")))
            rows.append(row)
        total = int(_number(data.get("total")) or 0)
        if total > (page - 1) * page_size and not rows:
            raise ValueError("Eastmoney returned no valid board quotes")
        return {"rows": rows, "total": total, "page": page, "page_size": page_size,
                "source": "Eastmoney", "updated_at": datetime.now(timezone.utc).isoformat(), "stale": False}

    def _fetch_memberships(self, secid):
        def rows(spt):
            query = urlencode({"secid": secid, "spt": spt, "fields": "f12,f14", "pn": 1, "pz": 100, "np": 1})
            payload = self.get_json(f"https://push2.eastmoney.com/api/qt/slist/get?{query}", 4)
            data = payload.get("data")
            if not isinstance(data, dict) or not isinstance(data.get("diff"), list):
                raise ValueError("Stock board membership unavailable")
            return [row for row in data["diff"] if isinstance(row, dict)]

        def board_names(records):
            return [str(row.get("f14") or "").strip() for row in records
                    if re.fullmatch(r"BK\d{4}", str(row.get("f12", ""))) and row.get("f14")]

        memberships = board_names(rows(3))
        try:
            industry = next(iter(board_names(rows(1))), None)
        except (OSError, ValueError):
            industry = None
        return {"industry": industry, "boards": list(dict.fromkeys(name for name in memberships if name and name != industry)),
                "source": "Eastmoney", "stale": False}

    async def _load_memberships(self, secid):
        async with self.membership_limit:
            return await asyncio.to_thread(self._fetch_memberships, secid)

    async def _refresh(self, key, load):
        try:
            data = await load()
            self.cache[key] = (time.monotonic(), data)
            self.cache.move_to_end(key)
            if len(self.cache) > 256:
                self.cache.popitem(last=False)
            return data
        finally:
            self.pending.pop(key, None)

    async def _get_cached(self, key, load, ttl, stale_ttl):
        cached = self.cache.get(key)
        age = time.monotonic() - cached[0] if cached else float("inf")
        if age < ttl:
            return cached[1]
        if key not in self.pending:
            self.pending[key] = asyncio.create_task(self._refresh(key, load))
        try:
            return await asyncio.shield(self.pending[key])
        except (OSError, ValueError):
            if cached and age < stale_ttl:
                return {**cached[1], "stale": True}
            raise

    async def get(self, category="industry", sort="strong", page=1, board=None):
        key = (category, sort, page, board)
        return await self._get_cached(key, lambda: asyncio.to_thread(self._fetch, *key), 25, 1800)

    async def _load_catalog(self, category):
        first = await asyncio.to_thread(self._fetch, category, "strong", 1, None, True)
        last = (first["total"] + first["page_size"] - 1) // first["page_size"]
        if last > 20:
            raise ValueError("Unexpected board catalog size")
        pages = await asyncio.gather(*(asyncio.to_thread(self._fetch, category, "strong", page, None, True)
                                       for page in range(2, last + 1)))
        rows = {row["ticker"]: row for data in (first, *pages) for row in data["rows"]}
        return {**first, "rows": list(rows.values())}

    async def search(self, category, sort, page, query):
        catalog = await self._get_cached(("catalog", category), lambda: self._load_catalog(category), 60, 1800)
        query = normalize("NFKC", query).casefold()
        matches = [row for row in catalog["rows"]
                   if query in normalize("NFKC", row["name"]).casefold() or query in row["ticker"].casefold()]
        if sort == "amount":
            matches.sort(key=lambda row: (-(row["amount"] if row["amount"] is not None else -1), row["ticker"]))
        else:
            matches.sort(key=lambda row: ((1 if sort == "weak" else -1) * row["change_percent"], row["ticker"]))
        page = min(page, max(1, (len(matches) + BOARD_PAGE_SIZE - 1) // BOARD_PAGE_SIZE))
        offset = (page - 1) * BOARD_PAGE_SIZE
        return {**catalog, "rows": matches[offset:offset + BOARD_PAGE_SIZE], "total": len(matches),
                "page": page, "page_size": BOARD_PAGE_SIZE}

    async def get_stock_memberships(self, secid):
        return await self._get_cached(("stock", secid), lambda: self._load_memberships(secid), 6 * 3600, 7 * 86400)
