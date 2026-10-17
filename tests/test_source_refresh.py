import copy
import json
import unittest
from unittest.mock import patch
import update_data as updater

class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.data=json.loads(updater.DATA.read_text())
    def test_redesigned_listing_preserves_historical_price_and_date(self):
        before=copy.deepcopy(self.data['headline']['latest_provider_snapshot'])
        with patch.object(updater,'get') as get:
            get.return_value.text='<h1>Industry News October 2026</h1> Xi’an $1234'
            updater.refresh_provider(self.data)
        after=self.data['headline']['latest_provider_snapshot']
        self.assertEqual(after['value_usd'],before['value_usd'])
        self.assertEqual(after['period'],before['period'])
        self.assertEqual(after['source_status'],'not_published')
    def test_dated_card_updates_own_month_only(self):
        with patch.object(updater,'get') as get:
            get.return_value.text="FCL SOC 40HQ Rates to Baku October 2026 Xi'an $5,100"
            updater.refresh_provider(self.data)
        self.assertEqual(self.data['headline']['latest_provider_snapshot']['period'],'2026-10')
        self.assertEqual(self.data['headline']['latest_provider_snapshot']['value_usd'],5100)
    def test_capacity_refresh_is_idempotent_and_preserves_freight_index(self):
        before=copy.deepcopy(self.data['mcfi_monthly'])
        updater.refresh_aktau(self.data)
        once=copy.deepcopy(self.data)
        updater.refresh_aktau(self.data)
        self.assertEqual(once,self.data)
        self.assertEqual(self.data['aktau']['container_hub_teu'],140000)
        self.assertEqual(self.data['aktau']['container_hub_planned_teu'],240000)
        self.assertEqual(self.data['mcfi_monthly'],before)

if __name__=='__main__':unittest.main()
