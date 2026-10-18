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

    def test_article_metadata_separates_publication_from_assessment_month(self):
        html = '<h1>October 2026 latest news</h1><script type="application/ld+json">'+json.dumps({"@type":"NewsArticle", "datePublished":"2026-09-30T15:30:09+04:00", "articleBody":"September 2026. Ambarli and Mersin $7,200–$8,000."})+'</script>'
        text, published = updater.article_snapshot(html)
        self.assertEqual(updater.period_from_text(text), '2026-09')
        self.assertEqual(published,'2026-09-30T11:30:09Z')
    def test_baku_refresh_preserves_rounded_reporting_status(self):
        updater.refresh_baku(self.data)
        self.assertEqual(self.data['baku']['throughput_teu'],100000)
        self.assertIn('approximately',self.data['baku']['throughput_status'])
        self.assertIn('not live berth occupancy',self.data['baku']['note'])

    def test_2026_tariff_references_do_not_move_the_full_route_index(self):
        before=copy.deepcopy(self.data['headline']['latest_mcfi_core'])
        updater.refresh_tariff_references(self.data)
        sb=self.data['structural_benchmarks']
        self.assertEqual([r['value_usd'] for r in sb['integrated_official_reference']['routes']],[2498,2998,3861])
        self.assertIn('2026/2-en.pdf',sb['segments'][0]['source_url'])
        self.assertEqual(sb['integrated_official_reference']['maritime_component_valid_until'],'2026-03-31')
        self.assertEqual(before,self.data['headline']['latest_mcfi_core'])

    def test_kuryk_throughput_is_dated_tonnage_not_teu_or_live_traffic(self):
        before=copy.deepcopy(self.data['mcfi_monthly'])
        updater.refresh_kuryk(self.data)
        once=copy.deepcopy(self.data)
        updater.refresh_kuryk(self.data)
        self.assertEqual(once,self.data)
        self.assertEqual(self.data['kuryk']['throughput_tonnes'],884800)
        self.assertEqual(self.data['kuryk']['throughput_period'],'2026-01 to 2026-06')
        self.assertIn('not container TEU',self.data['kuryk']['note'])
        self.assertEqual(before,self.data['mcfi_monthly'])

    def test_coverage_gaps_do_not_include_observed_full_route_months(self):
        updater.rebuild_freight_series(self.data)
        updater.reconcile_coverage_gaps(self.data)
        periods={gap['period'] for gap in self.data['coverage_gaps']}
        self.assertNotIn('2026-08',periods)
        self.assertNotIn('2026-09',periods)
        self.assertIn('2025-07',periods)
        self.assertIn('2025-02',periods)
        self.assertIn('2024-01 to 2024-11',periods)

if __name__=='__main__':unittest.main()
