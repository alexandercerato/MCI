import copy
import csv
import io
import json
from datetime import datetime, timezone
from statistics import median
import unittest
from pathlib import Path
from unittest.mock import patch

import update_data as updater


class FreightIndexTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((Path(__file__).resolve().parents[1] / 'data.json').read_text())

    def test_published_value_and_export_use_full_route_dollars(self):
        updater.rebuild_freight_series(self.data)
        eligible=[r for r in self.data['historical_observations'] if updater.is_full_route_assessment(r)]
        last_period=max(r['period'] for r in eligible)
        observed={(r['source_url'],r['low_usd'],r['high_usd']):r for r in eligible if r['period']==last_period}
        expected=median((r['low_usd']+r['high_usd'])/2 for r in observed.values())
        self.assertEqual(self.data['headline']['latest_mcfi_core']['value_usd'], expected)
        self.assertEqual(self.data['headline']['latest_mcfi_core']['period'], last_period)
        export = list(csv.DictReader(io.StringIO((updater.ROOT / 'mcfi_history.csv').read_text(encoding='utf-8-sig'))))
        self.assertEqual(float(export[-1]['mcfi_usd']), expected)
        self.assertNotIn('mcfi_index', export[-1])
        self.assertEqual(len(export), len(self.data['mcfi_monthly']))

    def test_partial_routes_provider_quotes_and_costs_cannot_move_index(self):
        baseline = copy.deepcopy(self.data['mcfi_monthly'])
        self.data['model']['theoretical_reference_usd'] = 1
        for row in self.data['historical_observations']:
            if row['destination'] == 'Baku' or row['evidence_type'] != 'market assessment':
                row.update(low_usd=100000, high_usd=200000, midpoint_usd=150000)
        updater.rebuild_freight_series(self.data)
        self.assertEqual(self.data['mcfi_monthly'], baseline)
        self.assertNotIn('2025-07', [x['period'] for x in baseline])

    def test_multiple_assessments_use_median_and_deduplicate_sources(self):
        observations = self.data['historical_observations']
        existing = next(r for r in observations if r['period'] == self.data['headline']['latest_mcfi_core']['period'] and updater.is_full_route_assessment(r))
        expected=median(((existing['low_usd']+existing['high_usd'])/2,9200,8100))
        observations.extend([copy.deepcopy(existing), {**existing, 'low_usd': 9000, 'high_usd': 9400, 'source_url': 'https://example.com/assessment-2'}, {**existing, 'low_usd': 8000, 'high_usd': 8200, 'source_url': 'https://example.com/assessment-3'}])
        updater.rebuild_freight_series(self.data)
        latest = self.data['mcfi_monthly'][-1]
        self.assertEqual(latest['assessment_count'], 3)
        self.assertEqual(latest['mcfi_usd'], expected)

    def test_turkey_only_update_does_not_require_baku_quote(self):
        period,clock_date=self.next_period()
        article = f'<p>{clock_date.strftime("%B %Y")}. Ambarli and Mersin $8,000–$8,400.</p>'
        with patch.object(updater, 'datetime') as clock, patch.object(updater, 'discover_anews_pricing_url', return_value='https://example.com/new'), patch.object(updater, 'get') as fetch:
            clock.now.return_value=clock_date
            fetch.return_value.text = article
            updater.refresh_market(self.data)
        updater.rebuild_freight_series(self.data)
        self.assertEqual(self.data['headline']['latest_mcfi_core']['value_usd'], 8200)
        self.assertEqual(self.data['headline']['latest_mcfi_core']['period'], period)
        self.assertLess(self.data['headline']['latest_baku_market']['period'], period)

    def test_new_partial_quote_leaves_latest_full_route_date_unchanged(self):
        before=copy.deepcopy(self.data['headline']['latest_mcfi_core'])
        period,clock_date=self.next_period()
        article = f'<p>{clock_date.strftime("%B %Y")}. Alat or Absheron $7,500–$8,500.</p>'
        with patch.object(updater, 'datetime') as clock, patch.object(updater, 'discover_anews_pricing_url', return_value='https://example.com/partial'), patch.object(updater, 'get') as fetch:
            clock.now.return_value=clock_date
            fetch.return_value.text = article
            updater.refresh_market(self.data)
        updater.rebuild_freight_series(self.data)
        self.assertEqual(self.data['headline']['latest_mcfi_core'],before)

    def next_period(self):
        year,month=map(int,self.data['headline']['latest_mcfi_core']['period'].split('-'))
        month+=1
        if month==13:year,month=year+1,1
        date=datetime(year,month,28,tzinfo=timezone.utc)
        return date.strftime('%Y-%m'),date

    def test_rebuild_is_idempotent(self):
        before = copy.deepcopy(self.data)
        updater.rebuild_freight_series(self.data)
        self.assertEqual(self.data, before)


if __name__ == '__main__':
    unittest.main()
