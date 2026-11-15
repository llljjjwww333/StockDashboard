"""Public crypto news feeds with per-source refresh and stable article identities."""
import asyncio
import hashlib
import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path

from app.schemas.stock import FinanceNewsItem, FinanceNewsResponse, FinanceNewsSource

UTC = timezone.utc
FEEDS = [
    ('PANews', 'zh', 'https://www.panewslab.com/rss.xml?lang=zh&type=NORMAL%2CNEWS'),
    ('ChainCatcher', 'zh', 'https://www.chaincatcher.com/rss.xml'),
    ('CoinDesk', 'en', 'https://www.coindesk.com/arc/outboundfeeds/rss/'),
    ('Cointelegraph', 'en', 'https://cointelegraph.com/rss'),
]
COINS = {'BTC': ['比特币', 'bitcoin'], 'ETH': ['以太坊', 'ethereum', 'ether'], 'SOL': ['solana'],
         'BNB': [], 'XRP': ['ripple'], 'DOGE': ['狗狗币', 'dogecoin'], 'ADA': ['cardano'],
         'AVAX': ['avalanche'], 'LINK': ['chainlink'], 'SUI': [], 'TON': ['toncoin'], 'TRX': ['tron'],
         'DOT': ['polkadot'], 'LTC': ['莱特币', 'litecoin'], 'BCH': ['bitcoin cash'], 'PEPE': [],
         'UNI': ['uniswap'], 'AAVE': [], 'ARB': ['arbitrum'], 'OP': ['optimism'], 'HYPE': ['hyperliquid']}
TOPICS = [('安全', r'黑客|攻击|漏洞|被盗|盗取|hack|exploit|breach'),
          ('监管', r'监管|法案|政策|证监|法院|SEC\b|regulat|legislat|lawsuit'),
          ('ETF / 机构', r'\betf\b|贝莱德|机构|blackrock|fidelity|institution|strategy inc'),
          ('交易所', r'交易所|上币|下架|上线|币安|binance|coinbase|kraken|okx|listing|delist'),
          ('DeFi / 链上', r'\bdefi\b|链上|质押|借贷|staking|on.chain|lending|\bdex\b'),
          ('融资', r'融资|投资轮|种子轮|fundrais|seed round|series [a-d]|venture')]


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style'}:
            self.hidden += 1
        elif tag in {'p', 'br', 'div', 'li'}:
            self.parts.append(' ')

    def handle_endtag(self, tag):
        if tag in {'script', 'style'}:
            self.hidden = max(0, self.hidden - 1)
        elif tag in {'p', 'div', 'li'}:
            self.parts.append(' ')

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def plain(value):
    parser = PlainText()
    parser.feed(value or '')
    return re.sub(r'\s+', ' ', ''.join(parser.parts)).strip()


def canonical_url(value):
    try:
        url = urllib.parse.urlsplit(value.strip())
        if url.scheme not in {'http', 'https'} or not url.hostname or url.username or url.password:
            return None
        query = [(k, v) for k, v in urllib.parse.parse_qsl(url.query) if not k.lower().startswith('utm_') and k.lower() not in {'ref', 'source'}]
        return urllib.parse.urlunsplit((url.scheme, url.netloc.lower(), url.path, urllib.parse.urlencode(query), ''))
    except ValueError:
        return None


def annotate(title, summary):
    text = title + ' ' + summary
    tickers = [coin + 'USDT' for coin, aliases in COINS.items()
               if re.search(r'(?<![A-Za-z0-9])' + coin + r'(?:USDT)?(?![A-Za-z0-9])', text, re.I)
               or any(re.search(r'(?<![A-Za-z])' + re.escape(alias) + r'(?![A-Za-z])', text, re.I) for alias in aliases)]
    topic = next((name for name, pattern in TOPICS if re.search(pattern, text, re.I)), '市场')
    return tickers[:6], topic


def parse_feed(body, source, language, now=None):
    now = now or datetime.now(UTC)
    root = ET.fromstring(body)
    items = []
    for row in root.findall('.//item')[:120]:
        try:
            title = plain(row.findtext('title', ''))[:512]
            link = canonical_url(row.findtext('link', ''))
            published = parsedate_to_datetime(row.findtext('pubDate', ''))
            if not title or not link or not published.tzinfo or published > now + timedelta(minutes=5):
                continue
            if published < now - timedelta(days=30):
                continue
            summary = plain(row.findtext('description', ''))[:600]
            tickers, topic = annotate(title, summary)
            items.append(FinanceNewsItem(id=hashlib.sha256(link.encode()).hexdigest()[:24], title=title,
                summary=summary, published_at=published.astimezone(UTC).isoformat(), source=source,
                url=link, market='CRYPTO', language=language, tickers=tickers, topic=topic))
        except (TypeError, ValueError, OverflowError):
            continue
    return items


class CryptoNews:
    def __init__(self, fetch=None, cache_path=None):
        self.fetch = fetch or self.fetch_feed
        self.path = Path(cache_path) if cache_path else None
        self.sources = {}
        self.snapshot = None
        self.updated = 0
        self.lock = asyncio.Lock()
        if self.path:
            try:
                data = json.loads(self.path.read_text(encoding='utf-8'))
                for name, row in data.items():
                    if any(feed[0] == name for feed in FEEDS) and time.time() - row['time'] < 21600:
                        self.sources[name] = (row['time'], [FinanceNewsItem(**item) for item in row['items']])
            except (OSError, ValueError, TypeError, KeyError):
                pass

    @staticmethod
    def fetch_feed(url):
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (ZPBoard News)', 'Accept': 'application/rss+xml, application/xml, text/xml'})
        with urllib.request.urlopen(request, timeout=8) as response:
            return response.read(2_000_000)

    async def source(self, name, language, url):
        status = 'live'
        try:
            body = await asyncio.to_thread(self.fetch, url)
            items = parse_feed(body, name, language)
            if not items:
                raise ValueError('empty feed')
            captured = time.time()
            self.sources[name] = (captured, items)
        except Exception:
            cached = self.sources.get(name)
            if not cached or time.time() - cached[0] > 21600:
                return [], FinanceNewsSource(name=name, language=language, status='unavailable', item_count=0)
            captured, items = cached
            status = 'cached'
        return items, FinanceNewsSource(name=name, language=language, status=status, item_count=len(items), updated_at=datetime.fromtimestamp(captured, UTC).isoformat())

    async def get(self, limit=200):
        async with self.lock:
            if not self.snapshot or time.time() - self.updated >= 60:
                results = await asyncio.gather(*(self.source(*feed) for feed in FEEDS))
                by_url, titles = {}, set()
                for item in sorted((item for rows, _ in results for item in rows), key=lambda row: row.published_at, reverse=True):
                    title = re.sub(r'[\W_]+', '', unicodedata.normalize('NFKC', item.title).casefold())
                    if item.url not in by_url and title not in titles:
                        by_url[item.url] = item
                        titles.add(title)
                if not by_url:
                    raise ValueError('资讯连接暂不可用')
                states = [state for _, state in results]
                self.snapshot = FinanceNewsResponse(market='CRYPTO', updated_at=max(s.updated_at for s in states if s.updated_at),
                    keywords=['BTC', 'ETH', '监管', 'ETF', 'DeFi'], items=list(by_url.values()), sources=states,
                    stale=all(state.status != 'live' for state in states))
                self.updated = time.time()
                if self.path:
                    try:
                        self.path.parent.mkdir(parents=True, exist_ok=True)
                        temporary = self.path.with_suffix('.tmp')
                        temporary.write_text(json.dumps({name: {'time': captured, 'items': [item.model_dump() for item in rows]} for name, (captured, rows) in self.sources.items()}, ensure_ascii=False), encoding='utf-8')
                        temporary.replace(self.path)
                    except OSError:
                        pass
        return self.snapshot.model_copy(update={'items': self.snapshot.items[:limit]})


crypto_news = CryptoNews(cache_path=Path(__file__).resolve().parents[2] / '.cache' / 'crypto_news.json')
