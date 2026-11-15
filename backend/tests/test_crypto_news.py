import asyncio
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from app.services.crypto_news import CryptoNews, FEEDS, annotate, canonical_url, parse_feed
from app.schemas.analysis import AnalysisChartPoint

def rss(title='BTC涨幅扩大', url='https://example.com/btc?utm_source=feed', date=None):
    date=date or datetime.now(timezone.utc).strftime('%a, %d %b %Y %H:%M:%S %z')
    return f'<rss><channel><item><title><![CDATA[{title}]]></title><link>{url.replace("&", "&amp;")}</link><pubDate>{date}</pubDate><description><![CDATA[<p>Bitcoin &amp; ETH 更新</p><script>hidden()</script><p>价格与链上动态。</p>]]></description></item></channel></rss>'.encode()

class CryptoNewsTests(unittest.IsolatedAsyncioTestCase):
    def test_chart_analysis_retains_fractional_crypto_volume(self):
        point=AnalysisChartPoint(timestamp='2026-11-15T00:00:00Z',open=1,high=2,low=.5,close=1.5,volume=.00001234)
        self.assertEqual(point.volume,.00001234)

    def test_feed_metadata_plain_text_and_stable_article_identity(self):
        rows=parse_feed(rss(), 'PANews', 'zh')
        self.assertEqual(len(rows),1); self.assertEqual(rows[0].language,'zh')
        self.assertEqual(rows[0].url,'https://example.com/btc'); self.assertIn('BTCUSDT',rows[0].tickers); self.assertIn('ETHUSDT',rows[0].tickers)
        self.assertNotIn('script',rows[0].summary); self.assertNotIn('hidden',rows[0].summary); self.assertIn('&',rows[0].summary)
        self.assertEqual(rows[0].id,parse_feed(rss(url='https://example.com/btc?utm_campaign=test'),'CoinDesk','en')[0].id)

    def test_future_old_dates_and_unsafe_links_are_skipped(self):
        now=datetime(2026,11,15,6,tzinfo=timezone.utc)
        for date,url in [('Mon, 16 Nov 2026 06:00:00 +0000','https://example.com/story'),('Thu, 01 Oct 2026 00:00:00 +0000','https://example.com/story'),('Sun, 15 Nov 2026 06:00:00 +0000','javascript:alert(1)')]:
            self.assertEqual(parse_feed(rss(date=date,url=url),'Test','zh',now),[])
        self.assertIsNone(canonical_url('https://user:pass@example.com/story'))
        coins,topic=annotate('SEC reviews Bitcoin ETF filing','')
        self.assertEqual(coins,['BTCUSDT']); self.assertEqual(topic,'监管')
        self.assertEqual(annotate('Canadian markets update','')[0],[])

    async def test_source_refresh_merges_duplicates_and_preserves_chinese_metadata(self):
        calls=[]
        stamp=datetime.now(timezone.utc).strftime('%a, %d %b %Y %H:%M:%S %z')
        def fetch(url):
            calls.append(url);return rss('相同的BTC新闻','https://example.com/same',date=stamp)
        service=CryptoNews(fetch)
        a,b=await asyncio.gather(service.get(1),service.get(200))
        self.assertEqual(len(calls),len(FEEDS)); self.assertEqual(len(a.items),1); self.assertEqual(len(b.items),1)
        self.assertEqual(len(b.sources),4); self.assertTrue(all(s.status=='live' for s in b.sources)); self.assertEqual(b.items[0].language,'zh')

    async def test_failed_source_keeps_its_capture_time_without_hiding_other_live_sources(self):
        def fresh(url):return rss(url.split('/')[2],url.split('?')[0])
        service=CryptoNews(fresh); first=await service.get()
        old=next(s.updated_at for s in first.sources if s.name=='PANews')
        def partial(url):
            if 'panewslab' in url:raise OSError('offline')
            return fresh(url)
        service.fetch=partial;service.updated-=61;second=await service.get()
        source=next(s for s in second.sources if s.name=='PANews')
        self.assertEqual(source.status,'cached');self.assertEqual(source.updated_at,old);self.assertFalse(second.stale)
        self.assertTrue(any(s.status=='live' for s in second.sources))

    async def test_all_source_failure_without_saved_news_returns_an_error(self):
        def fail(url):raise OSError('offline')
        with self.assertRaises(ValueError):await CryptoNews(fail).get()

    async def test_saved_feed_survives_restart_and_expired_sources_are_unavailable(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'news.json'; service=CryptoNews(lambda url:rss(url.split('/')[2],url.split('?')[0]),path)
            await service.get();self.assertTrue(path.exists())
            def fail(url):raise OSError('offline')
            restored=await CryptoNews(fail,path).get();self.assertTrue(restored.stale);self.assertTrue(all(s.status=='cached' for s in restored.sources))
            data=json.loads(path.read_text(encoding='utf-8'))
            for row in data.values():row['time']-=21601
            path.write_text(json.dumps(data),encoding='utf-8')
            with self.assertRaises(ValueError):await CryptoNews(fail,path).get()

if __name__=='__main__':unittest.main()
