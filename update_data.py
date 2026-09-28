#!/usr/bin/env python3
"""Refresh supported public provider tariffs for the market monitor.
MCFI Core continues to use the fixed two-route monthly market assessment.
"""
from pathlib import Path
import json, re, sys
from datetime import datetime, timezone
import requests
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data.json'
URL='https://widesafe.com/news_en'

def main():
    data=json.loads(DATA.read_text(encoding='utf-8'))
    try:
        r=requests.get(URL,timeout=25,headers={'User-Agent':'MiddleCorridorFreightMonitor/0.9 (+public research monitor)'})
        r.raise_for_status()
        text=BeautifulSoup(r.text,'html.parser').get_text(' ',strip=True)
        m=re.search(r"Xi[’'\-]?an\s*\(Middle China\).*?\$\s*([0-9][0-9,]*)",text,re.I)
        if not m:
            raise ValueError('Xi’an→Baku public rate not found')
        price=int(m.group(1).replace(',',''))
        # Only refresh the single-provider context card. Never overwrite MCFI Core.
        data['headline']['latest_provider_snapshot'].update({
            'value_usd':price,
            'route':'Xi’an → Baku',
            'container_basis':'SOC 40HQ',
            'status':'published provider tariff',
            'checked_at_utc':datetime.now(timezone.utc).isoformat(timespec='seconds')
        })
        data['meta']['last_provider_check_utc']=datetime.now(timezone.utc).isoformat(timespec='seconds')
        DATA.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
        print(f'Updated WideSafe snapshot: ${price:,}')
    except Exception as e:
        print(f'Provider refresh skipped; retained last valid data: {e}',file=sys.stderr)
        return 0
    return 0
if __name__=='__main__': raise SystemExit(main())
