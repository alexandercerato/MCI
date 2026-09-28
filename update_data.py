#!/usr/bin/env python3
"""12-hour public-source updater for Middle Corridor Monitor.

Principles:
- public, attributable sources only;
- discover new articles through GDELT (no API key), then fetch originals;
- overwrite only when a conservative parser finds plausible values;
- otherwise retain the previous verified fixing;
- append a new MCI history point only when the weighted basket changes.
"""
from __future__ import annotations
import json, re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data.json"
UA = {"User-Agent": "MiddleCorridorMonitor/0.1 public-research-dashboard"}
TIMEOUT = 20
ALLOWED = {"georgiatoday.ge","report.az","astanatimes.com","mcmultimodal.com","www.mcmultimodal.com","railways.kz","middlecorridor.com","www.middlecorridor.com","timesca.com","www.timesca.com","thediplomat.com","www.gateway-logistics.kz","gateway-logistics.kz"}


def fetch_text(url: str) -> str:
    r = requests.get(url, headers=UA, timeout=TIMEOUT)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    return " ".join(soup.stripped_strings)


def nums(s: str) -> int:
    return int(s.replace(",", "").replace(" ", ""))


def gdelt(query: str, maxrecords: int = 50) -> list[dict]:
    params = {"query": query, "mode": "artlist", "maxrecords": maxrecords, "format": "json", "sort": "datedesc"}
    url = "https://api.gdeltproject.org/api/v2/doc/doc?" + urlencode(params)
    r = requests.get(url, headers=UA, timeout=TIMEOUT)
    r.raise_for_status()
    out = []
    for a in r.json().get("articles", []):
        domain = (a.get("domain") or "").lower()
        if domain in ALLOWED:
            out.append(a)
    return out


def candidate_urls(seed: list[str], query: str) -> list[tuple[str,str]]:
    rows=[(u, "") for u in seed]
    try:
        rows += [(a.get("url",""), a.get("seendate", "")) for a in gdelt(query) if a.get("url")]
    except Exception:
        pass
    seen=set(); dedup=[]
    for u,dt in rows:
        if u and u not in seen:
            seen.add(u); dedup.append((u,dt))
    return dedup


def first_range(text: str, patterns: list[str]):
    for pat in patterns:
        m = re.search(pat, text, flags=re.I|re.S)
        if m:
            lo,hi=nums(m.group(1)),nums(m.group(2))
            if 3000 <= lo <= hi <= 15000: return lo,hi
    return None


def update_freight(d: dict) -> bool:
    seed=["https://georgiatoday.ge/tcrc-middle-corridor-shipping-costs-rise-as-china-europe-trade-shifts-routes/"]
    urls=candidate_urls(seed, '"Middle Corridor" freight rate Xi\'an Alat container')
    patterns={
      "MC1":[r"Xi.?an.{0,350}(?:Alyat|Alat).{0,350}?\$?([0-9,]{4,})\s*[–—-]\s*\$?([0-9,]{4,})"],
      "MC2":[r"Xi.?an.{0,350}Tbilisi.{0,350}?\$?([0-9,]{4,})\s*[–—-]\s*\$?([0-9,]{4,})"],
      "MC3":[r"(?:Ambarli|Mersin).{0,350}?\$?([0-9,]{4,})\s*[–—-]\s*\$?([0-9,]{4,})"]
    }
    best={}; best_seen={}
    for url, seen in urls[:25]:
        try: text=fetch_text(url)
        except Exception: continue
        for code,pats in patterns.items():
            hit=first_range(text,pats)
            if hit and (code not in best_seen or seen >= best_seen[code]):
                best[code]=(hit,url); best_seen[code]=seen
    if not best: return False
    changed=False
    for c in d["index"]["components"]:
        if c["code"] in best:
            (lo,hi),url=best[c["code"]]
            mid=round((lo+hi)/2)
            if (c.get("low"),c.get("high")) != (lo,hi): changed=True
            c.update(low=lo,high=hi,mid=mid,source_url=url)
    if changed:
        basket=round(sum(c["mid"]*c["weight"] for c in d["index"]["components"]))
        base=d["index"].get("base_usd_feu") or d["index"]["history"][0]["usd_feu"]
        prev=d["index"].get("current_usd_feu",basket)
        d["index"]["base_usd_feu"]=base
        d["index"]["current_usd_feu"]=basket
        d["index"]["current_index"]=round(100*basket/base,1)
        d["index"]["change_mom_pct"]=round(100*(basket/prev-1),1) if prev else None
        d["index"]["change_since_base_pct"]=round(100*(basket/base-1),1)
        fixing=datetime.now(timezone.utc).strftime("%d %b %Y")
        d["index"]["current_period"]=fixing
        d["index"]["history"].append({"period":fixing,"usd_feu":basket,"index":d["index"]["current_index"],"coverage":"3-lane basket"})
    return changed


def update_volume(d: dict) -> bool:
    seed=[d["corridor"].get("source_url","")]
    urls=candidate_urls(seed, '"Middle Corridor" TEU block trains ADY Express')
    newest=None
    for url,seen in urls[:25]:
        try: text=fetch_text(url)
        except Exception: continue
        total=re.search(r"total of\s+([0-9,]+)\s+TEU",text,re.I)
        if not total: continue
        prev=re.search(r"(?:stood at|compared with)\s+([0-9,]+)\s+TEU",text,re.I)
        ew=re.search(r"([0-9,]+)\s+TEU was transported east to west",text,re.I)
        we=re.search(r"([0-9,]+)\s+TEU moved west to east",text,re.I)
        trains=re.search(r"([0-9,]+) container block trains",text,re.I)
        cand={"seen":seen,"url":url,"total":nums(total.group(1)),"prev":nums(prev.group(1)) if prev else None,"ew":nums(ew.group(1)) if ew else None,"we":nums(we.group(1)) if we else None,"trains":nums(trains.group(1)) if trains else None}
        if newest is None or cand["seen"] >= newest["seen"]: newest=cand
    if not newest: return False
    c=d["corridor"]; old=c.get("teu_ytd")
    c["teu_ytd"]=newest["total"]; c["source_url"]=newest["url"]
    if newest["prev"]: c["teu_previous"]=newest["prev"]
    if newest["ew"]: c["westbound_teu"]=newest["ew"]
    if newest["we"]: c["eastbound_teu"]=newest["we"]
    if newest["trains"]: c["block_trains"]=newest["trains"]
    if c.get("teu_previous"): c["yoy_pct"]=round(100*(c["teu_ytd"]/c["teu_previous"]-1),1)
    if c.get("westbound_teu") and c.get("eastbound_teu"):
        c["westbound_share_pct"]=round(100*c["westbound_teu"]/(c["westbound_teu"]+c["eastbound_teu"]),1)
    return old != c["teu_ytd"]


def update_caspian(d: dict) -> bool:
    seed=[d["caspian"].get("source_url","")]
    urls=candidate_urls(seed, 'Middle Corridor Aktau Alat TEU Kazmortransflot')
    for url,seen in urls[:20]:
        try: text=fetch_text(url)
        except Exception: continue
        m=re.search(r"transported\s+([0-9,]+).*?TEUs.*?compared.*?([0-9,]+)\s+TEUs",text,re.I|re.S)
        if m:
            cur,prev=nums(m.group(1)),nums(m.group(2)); old=d["caspian"].get("aktau_alat_teu")
            d["caspian"].update(aktau_alat_teu=cur,previous_year_teu=prev,yoy_pct=round(100*(cur/prev-1)),source_url=url)
            return old != cur
    return False



def update_news(d: dict) -> bool:
    """Refresh the headline feed from whitelisted public sources.

    GDELT is used only for discovery. We store title/date/source/url and keep
    concise neutral summaries already present when an article is known.
    """
    try:
        articles = gdelt('\"Middle Corridor\" OR \"Trans-Caspian International Transport Route\"', maxrecords=60)
    except Exception:
        return False
    old = {n.get('url'): n for n in d.get('news', [])}
    rows = []
    seen = set()
    for a in articles:
        url = a.get('url') or ''
        if not url or url in seen:
            continue
        seen.add(url)
        title = (a.get('title') or '').strip()
        if not title:
            continue
        domain = (a.get('domain') or '').replace('www.','')
        source = domain.split('.')[0].replace('-', ' ').title()
        raw = a.get('seendate') or ''
        date = raw
        try:
            if len(raw) >= 8:
                date = datetime.strptime(raw[:8], '%Y%m%d').strftime('%d %b %Y')
        except Exception:
            pass
        prior = old.get(url, {})
        summary = prior.get('summary') or 'Recent Middle Corridor / Trans-Caspian development from the monitored public-source set.'
        rows.append({'date':date,'source':prior.get('source') or source,'title':title,'summary':summary,'url':url})
        if len(rows) >= 6:
            break
    if not rows:
        return False
    changed = [x.get('url') for x in rows] != [x.get('url') for x in d.get('news', [])]
    d['news'] = rows
    return changed


def main():
    d=json.loads(DATA_PATH.read_text(encoding="utf-8"))
    results={}
    for name,fn in [("freight",update_freight),("volume",update_volume),("caspian",update_caspian),("news",update_news)]:
        try: results[name]=fn(d)
        except Exception as e: results[name]=f"kept previous: {type(e).__name__}"
    d["meta"]["generated_at"]=datetime.now(timezone.utc).isoformat(timespec="seconds")
    d["meta"]["update_results"]=results
    DATA_PATH.write_text(json.dumps(d,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(results))

if __name__=="__main__": main()
