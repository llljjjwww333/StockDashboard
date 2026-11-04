import io
import unittest
from unittest.mock import patch
from app.services.stock_data_service import StockDataService

class OrderBookTests(unittest.TestCase):
    def test_five_levels_use_real_quote_fields_and_share_units(self):
        fields = ["0"] * 54
        values = {2: "510300", 3: "4.092", 4: "4.081", 5: "4.088", 6: "123", 30: "20261103161436", 33: "4.101", 34: "4.079", 37: "123", 38: "1.2"}
        for level in range(5):
            values[9 + level * 2] = str(4.091 - level * .001)
            values[10 + level * 2] = str(10 + level)
            values[19 + level * 2] = str(4.092 + level * .001)
            values[20 + level * 2] = str(20 + level)
        for index, value in values.items(): fields[index] = value
        body = ('v_sh510300="' + '~'.join(fields) + '";').encode('gbk')
        with patch('urllib.request.urlopen', return_value=io.BytesIO(body)):
            result = StockDataService()._fetch_batch_quotes(['510300'])['510300']
        self.assertEqual(result.price, 4.092)
        self.assertEqual(result.previous_close, 4.081)
        self.assertEqual(result.open_price, 4.088)
        self.assertEqual(result.high_price, 4.101)
        self.assertEqual(result.low_price, 4.079)
        self.assertEqual(result.change, .011)
        self.assertEqual(len(result.order_book.bids), 5)
        self.assertEqual(len(result.order_book.asks), 5)
        self.assertEqual(result.order_book.bids[0].price, 4.091)
        self.assertEqual(result.order_book.bids[0].volume, 1000)
        self.assertEqual(result.order_book.asks[4].level, 5)
        self.assertEqual(result.order_book.asks[4].volume, 2400)

    def test_etf_and_penny_quotes_keep_their_tick_precision(self):
        service = StockDataService()
        fund = service._build_stock_update(ticker='159915', price=2.123, volume=100, previous_close=2.12)
        penny = service._build_stock_update(ticker='PENNY', price=.1234, volume=100, previous_close=.12)
        self.assertEqual(fund.price, 2.123)
        self.assertEqual(fund.change, .003)
        self.assertEqual(penny.price, .1234)
