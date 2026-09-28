#!/usr/bin/env python3
"""Five-minute public-source updater for Middle Corridor Monitor.

Design goals
------------
* The GitHub workflow wakes every five minutes.
* Fast-moving public benchmarks (Drewry / headline feed / official Aktau pages)
  are checked on every run.
* All monitored source classes are checked on every scheduled run. Candidate
  discovery is deliberately capped so the five-minute cadence remains light.
* The script writes ``data.json`` only when a verified datapoint actually
  changes. No synthetic interpolation and no artificial MCI movement.
* The last verified value is retained whenever a source cannot be reached.
"""
from __future__ import annotations

import copy
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data.json"
UA = {"User-Agent": "MiddleCorridorMonitor/0.5 public-research-dashboard"}
TIMEOUT = 15
ALLOWED = {
    "georgiatoday.ge", "report.az", "astanatimes.com", "mcmultimodal.com",
    "www.mcmultimodal.com", "railways.kz", "middlecorridor.com",
    "www.middlecorridor.com", "timesca.com", "www.timesca.com",
    "thediplomat.com", "www.gateway-logistics.kz", "gateway-logistics.kz",
    "portaktau.kz", "www.portaktau.kz", "gov.kz", "www.gov.kz",
    "primeminister.kz", "www.primeminister.kz", "drewry.co.uk",
    "www.drewry.co.uk"
}


def fetch_text(url: str) -> str:
    r = requests.get(url, headers=UA, timeout=TIMEOUT)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    return " ".join(soup.stripped_strings)


def nums(s: str) -> int:
    return int(s.replace(",", "").replace(" ", ""))


def gdelt(query: str, maxrecords: int = 30) -> list[dict]:
    params = {
        "query": query,
        "mode": "artlist",
        "maxrecords": maxrecords,
        "format": "json",
        "sort": "datedesc",
    }
    url = "https://api.gdeltproject.org/api/v2/doc/doc?" + urlencode(params)
    r = requests.get(url, headers=UA, timeout=TIMEOUT)
    r.raise_for_status()
    out = []
    for a in r.json().get("articles", []):
        domain = (a.get("domain") or "").lower()
        if domain in ALLOWED:
            out.append(a)
    return out


def candidate_urls(seed: list[str], query: str, discovery_limit: int = 6) -> list[tuple[str, str]]:
    rows = [(u, "") for u in seed if u]
    try:
        rows += [
            (a.get("url", ""), a.get("seendate", ""))
            for a in gdelt(query)
            if a.get("url")
        ][:discovery_limit]
    except Exception:
        pass
    seen, dedup = set(), []
    for u, dt in rows:
        if u and u not in seen:
            seen.add(u)
            dedup.append((u, dt))
    return dedup


def first_range(text: str, patterns: list[str]):
    for pat in patterns:
        m = re.search(pat, text, flags=re.I | re.S)
        if m:
            lo, hi = nums(m.group(1)), nums(m.group(2))
            if 3000 <= lo <= hi <= 15000:
                return lo, hi
    return None


def update_freight(d: dict) -> bool:
    seed = [
        "https://georgiatoday.ge/tcrc-middle-corridor-shipping-costs-rise-as-china-europe-trade-shifts-routes/"
    ]
    urls = candidate_urls(seed, '"Middle Corridor" freight rate Xi\'an Alat container')
    patterns = {
        "MC1": [r"Xi.?an.{0,350}(?:Alyat|Alat).{0,350}?\$?([0-9,]{4,})\s*[–—-]\s*\$?([0-9,]{4,})"],
        "MC2": [r"Xi.?an.{0,350}Tbilisi.{0,350}?\$?([0-9,]{4,})\s*[–—-]\s*\$?([0-9,]{4,})"],
        "MC3": [r"(?:Ambarli|Mersin|Turkey|Türkiye).{0,350}?\$?([0-9,]{4,})\s*[–—-]\s*\$?([0-9,]{4,})"],
    }
    best, best_seen = {}, {}
    for url, seen in urls[:8]:
        try:
            text = fetch_text(url)
        except Exception:
            continue
        for code, pats in patterns.items():
            hit = first_range(text, pats)
            if hit and (code not in best_seen or seen >= best_seen[code]):
                best[code] = (hit, url)
                best_seen[code] = seen
    if not best:
        return False

    changed = False
    for c in d["index"]["components"]:
        if c["code"] in best:
            (lo, hi), url = best[c["code"]]
            mid = round((lo + hi) / 2)
            if (c.get("low"), c.get("high")) != (lo, hi):
                changed = True
            c.update(low=lo, high=hi, mid=mid, source_url=url)

    if changed:
        basket = round(sum(c["mid"] * c["weight"] for c in d["index"]["components"]))
        base = d["index"].get("base_usd_feu") or d["index"]["history"][0]["usd_feu"]
        prev = d["index"].get("current_usd_feu", basket)
        d["index"]["base_usd_feu"] = base
        d["index"]["current_usd_feu"] = basket
        d["index"]["current_index"] = round(100 * basket / base, 1)
        d["index"]["change_mom_pct"] = round(100 * (basket / prev - 1), 1) if prev else None
        d["index"]["change_since_base_pct"] = round(100 * (basket / base - 1), 1)
        fixing = datetime.now(timezone.utc).strftime("%d %b %Y")
        d["index"]["current_period"] = fixing
        if not d["index"]["history"] or d["index"]["history"][-1].get("usd_feu") != basket:
            d["index"]["history"].append({
                "period": fixing,
                "usd_feu": basket,
                "index": d["index"]["current_index"],
                "coverage": "3-lane basket",
            })
        # Keep the pricing terminal in sync with the index.
        for row in d.get("transport_prices", []):
            if row.get("code") == "MCI":
                row.update(
                    display=f"${basket:,.0f}",
                    mid=basket,
                    period=fixing,
                    source="MCI calculation / monitored reference lanes",
                )
    return changed


def update_volume(d: dict) -> bool:
    seed = [d["corridor"].get("source_url", "")]
    urls = candidate_urls(seed, '"Middle Corridor" TEU block trains ADY Express')
    newest = None
    for url, seen in urls[:8]:
        try:
            text = fetch_text(url)
        except Exception:
            continue
        total = re.search(r"total of\s+([0-9,]+)\s+TEU", text, re.I)
        if not total:
            continue
        prev = re.search(r"(?:stood at|compared with)\s+([0-9,]+)\s+TEU", text, re.I)
        ew = re.search(r"([0-9,]+)\s+TEU was transported east to west", text, re.I)
        we = re.search(r"([0-9,]+)\s+TEU moved west to east", text, re.I)
        trains = re.search(r"([0-9,]+) container block trains", text, re.I)
        cand = {
            "seen": seen,
            "url": url,
            "total": nums(total.group(1)),
            "prev": nums(prev.group(1)) if prev else None,
            "ew": nums(ew.group(1)) if ew else None,
            "we": nums(we.group(1)) if we else None,
            "trains": nums(trains.group(1)) if trains else None,
        }
        if newest is None or cand["seen"] >= newest["seen"]:
            newest = cand
    if not newest:
        return False

    c = d["corridor"]
    old = copy.deepcopy(c)
    c["teu_ytd"] = newest["total"]
    c["source_url"] = newest["url"]
    if newest["prev"]:
        c["teu_previous"] = newest["prev"]
    if newest["ew"]:
        c["westbound_teu"] = newest["ew"]
    if newest["we"]:
        c["eastbound_teu"] = newest["we"]
    if newest["trains"]:
        c["block_trains"] = newest["trains"]
    if c.get("teu_previous"):
        c["yoy_pct"] = round(100 * (c["teu_ytd"] / c["teu_previous"] - 1), 1)
    if c.get("westbound_teu") and c.get("eastbound_teu"):
        c["westbound_share_pct"] = round(
            100 * c["westbound_teu"] / (c["westbound_teu"] + c["eastbound_teu"]), 1
        )
    return old != c


def update_caspian(d: dict) -> bool:
    seed = [d["caspian"].get("source_url", "")]
    urls = candidate_urls(seed, 'Middle Corridor Aktau Alat TEU Kazmortransflot')
    for url, _seen in urls[:8]:
        try:
            text = fetch_text(url)
        except Exception:
            continue
        m = re.search(r"transported\s+([0-9,]+).*?TEUs.*?compared.*?([0-9,]+)\s+TEUs", text, re.I | re.S)
        if m:
            cur, prev = nums(m.group(1)), nums(m.group(2))
            old = copy.deepcopy(d["caspian"])
            d["caspian"].update(
                aktau_alat_teu=cur,
                previous_year_teu=prev,
                yoy_pct=round(100 * (cur / prev - 1)),
                source_url=url,
            )
            return old != d["caspian"]
    return False


def update_ocean(d: dict) -> bool:
    """Refresh the liquid ocean comparator from Drewry's public weekly WCI page."""
    url = "https://www.drewry.co.uk/maritime-research-opinion-browser/world-container-index-assessed-by-drewry"
    try:
        text = fetch_text(url)
    except Exception:
        return False

    # Current copy typically reads: "rates ... $3,485 per 40ft container from Shanghai to Rotterdam"
    patterns = [
        r"Shanghai\s*(?:to|–|-)\s*Rotterdam.{0,160}?\$\s*([0-9,]{3,6})",
        r"\$\s*([0-9,]{3,6})\s+per\s+40ft\s+container\s+from\s+Shanghai\s+to\s+Rotterdam",
        r"rates.{0,120}?\$\s*([0-9,]{3,6}).{0,80}?from\s+Shanghai\s+to\s+Rotterdam",
    ]
    value = None
    for pat in patterns:
        m = re.search(pat, text, re.I | re.S)
        if m:
            v = nums(m.group(1))
            if 500 <= v <= 20000:
                value = v
                break
    if value is None:
        return False

    date_match = re.search(r"(?:Thursday,\s*)?(\d{1,2}\s+[A-Z][a-z]{2}\s+20\d{2})", text)
    period = date_match.group(1) if date_match else datetime.now(timezone.utc).strftime("%d %b %Y")

    row = next((r for r in d.get("transport_prices", []) if r.get("code") == "OCEAN-EU"), None)
    if row is None:
        return False
    old = copy.deepcopy(row)
    row.update(
        display=f"${value:,.0f}",
        mid=value,
        period=period,
        source="Drewry WCI",
        source_url=url,
    )
    return old != row


def update_aktau(d: dict) -> bool:
    """Refresh conservative Aktau facts from official pages only."""
    a = d.setdefault("aktau", {})
    old = copy.deepcopy(a)
    try:
        text = fetch_text("https://portaktau.kz/en/infrastructure-2/")
        m = re.search(r"Number of berths[^0-9]{0,60}([0-9]{1,2})", text, re.I)
        if m:
            a["berths"] = int(m.group(1))
        m = re.search(r"capacity[^0-9]{0,80}([0-9]+(?:[.,][0-9]+)?)\s*million\s*tons", text, re.I)
        if m:
            a["capacity_mt"] = float(m.group(1).replace(",", "."))
        m = re.search(r"Open storage area[^0-9]{0,60}([0-9 ,]+)\s*m", text, re.I)
        if m:
            a["open_storage_m2"] = nums(m.group(1))
        a["source_url"] = "https://portaktau.kz/en/infrastructure-2/"
    except Exception:
        pass

    try:
        text = fetch_text("https://portaktau.kz/en/tarify/")
        # The page can contain either 'changes as of' or dated price-list labels.
        dates = re.findall(r"(?:changes as of|as of|dated)\s+(\d{2}[./]\d{2}[./]\d{4})", text, re.I)
        if dates:
            def parse_date(s: str):
                s = s.replace("/", ".")
                return datetime.strptime(s, "%d.%m.%Y")
            latest = max(dates, key=parse_date)
            a["tariff_schedule_date"] = parse_date(latest).strftime("%d %b %Y")
        a["tariff_source_url"] = "https://portaktau.kz/en/tarify/"
    except Exception:
        pass
    return old != a


def update_news(d: dict) -> bool:
    """Refresh the headline feed from the whitelisted public-source set."""
    try:
        articles = gdelt(
            '("Middle Corridor" OR "Trans-Caspian International Transport Route" OR "Aktau Port")',
            maxrecords=60,
        )
    except Exception:
        return False

    old_by_url = {n.get("url"): n for n in d.get("news", [])}
    rows, seen = [], set()
    for a in articles:
        url = a.get("url") or ""
        if not url or url in seen:
            continue
        seen.add(url)
        title = (a.get("title") or "").strip()
        if not title:
            continue
        domain = (a.get("domain") or "").replace("www.", "")
        source = domain.split(".")[0].replace("-", " ").title()
        raw = a.get("seendate") or ""
        date = raw
        try:
            if len(raw) >= 8:
                date = datetime.strptime(raw[:8], "%Y%m%d").strftime("%d %b %Y")
        except Exception:
            pass
        prior = old_by_url.get(url, {})
        summary = prior.get("summary") or "Recent Middle Corridor / Trans-Caspian development from the monitored public-source set."
        rows.append({
            "date": date,
            "source": prior.get("source") or source,
            "title": title,
            "summary": summary,
            "url": url,
        })
        if len(rows) >= 6:
            break
    if not rows:
        return False
    old_urls = [x.get("url") for x in d.get("news", [])]
    new_urls = [x.get("url") for x in rows]
    if new_urls != old_urls:
        d["news"] = rows
        return True
    return False


def canonical_payload(d: dict) -> str:
    """Compare substantive data only; volatile check metadata is ignored."""
    x = copy.deepcopy(d)
    meta = x.setdefault("meta", {})
    meta.pop("generated_at", None)
    meta.pop("update_results", None)
    return json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def main():
    original = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    d = copy.deepcopy(original)
    results: dict[str, object] = {}

    jobs = [
        ("ocean", update_ocean),
        ("aktau", update_aktau),
        ("freight", update_freight),
        ("volume", update_volume),
        ("caspian", update_caspian),
        ("news", update_news),
    ]
    for name, fn in jobs:
        try:
            results[name] = fn(d)
        except Exception as e:
            results[name] = f"kept previous: {type(e).__name__}"

    changed = canonical_payload(d) != canonical_payload(original)
    if changed:
        d.setdefault("meta", {})["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        d["meta"]["status"] = "public-data beta · Aktau focus · auto-verified"
        d["meta"]["refresh_cadence"] = "5 minutes"
        d["meta"]["update_results"] = results
        DATA_PATH.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"changed": True, "results": results}))
    else:
        print(json.dumps({"changed": False, "results": results}))


if __name__ == "__main__":
    main()
