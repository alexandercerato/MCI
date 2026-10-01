#!/usr/bin/env python3
"""Refresh public Middle Corridor market snapshots used as GitHub Pages fallback.

The live website reads current pricing from the Railway backend every five minutes.
This script keeps data.json aligned when a new public market observation appears.
It writes only when values actually change, so the scheduled workflow does not
create empty commits every five minutes.
"""
from pathlib import Path
import copy
import json
import re
import sys
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data.json"

ANEWS_BUSINESS = "https://anews.az/en/ekonomika/"
ANEWS_FALLBACK = "https://anews.az/en/ekonomika/527577/caspian-container-shipping-rates-rise-in-september/"
WIDESAFE_NEWS = "https://www.widesafe.com/news_en"

MONTHS = {
    "january":"01","february":"02","march":"03","april":"04","may":"05","june":"06",
    "july":"07","august":"08","september":"09","october":"10","november":"11","december":"12",
}

HEADERS = {"User-Agent": "MiddleCorridorFreightMonitor/1.0 (+public research monitor)"}


def get(url: str) -> requests.Response:
    r = requests.get(url, timeout=25, headers=HEADERS)
    r.raise_for_status()
    return r


def text_of(html: str) -> str:
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True)


def money(value: str) -> int:
    return int(re.sub(r"[^0-9]", "", value))


def period_from_text(text: str):
    m = re.search(
        r"\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b",
        text,
        re.I,
    )
    if not m:
        return None
    return f"{m.group(2)}-{MONTHS[m.group(1).lower()]}"


def discover_anews_pricing_url() -> str:
    try:
        html = get(ANEWS_BUSINESS).text
        candidates = []
        for href, ident, slug in re.findall(
            r'href=["\']([^"\']*/en/ekonomika/(\d+)/([^"\']+))["\']',
            html,
            re.I,
        ):
            s = slug.lower()
            if ("caspian" in s and "container" in s) or "container-shipping-rates" in s:
                candidates.append((int(ident), urljoin(ANEWS_BUSINESS, href)))
        if candidates:
            return sorted(candidates, reverse=True)[0][1]
    except Exception as exc:
        print(f"Anews discovery fallback: {exc}", file=sys.stderr)
    return ANEWS_FALLBACK


def upsert_month(data, row):
    rows = data.setdefault("mcfi_monthly", [])
    for i, current in enumerate(rows):
        if current.get("period") == row["period"]:
            rows[i] = {**current, **row}
            break
    else:
        rows.append(row)
    rows.sort(key=lambda x: x.get("period", ""))


def upsert_observation(data, row):
    rows = data.setdefault("historical_observations", [])
    for i, current in enumerate(rows):
        if (
            current.get("period") == row["period"]
            and current.get("route") == row["route"]
            and current.get("evidence_type") == "market assessment"
        ):
            rows[i] = {**current, **row}
            break
    else:
        rows.append(row)
    rows.sort(key=lambda x: str(x.get("period") or x.get("date") or ""))


def recompute_year_summary(data, year: str):
    vals = [
        float(x["mcfi_usd"])
        for x in data.get("mcfi_monthly", [])
        if str(x.get("period", "")).startswith(year + "-")
        and isinstance(x.get("mcfi_usd"), (int, float))
    ]
    if not vals:
        return
    for row in data.get("year_summary", []):
        if str(row.get("year")) == year:
            row["complete_months"] = len(vals)
            row["months_elapsed"] = max(row.get("months_elapsed", 0), len(vals))
            row["average_usd"] = round(sum(vals) / len(vals))
            row["low_usd"] = round(min(vals))
            row["high_usd"] = round(max(vals))
            return


def refresh_market(data):
    source_url = discover_anews_pricing_url()
    article = text_of(get(source_url).text)
    period = period_from_text(article)
    if not period:
        raise ValueError("market period not found")

    baku = re.search(
        r"Alat\s+or\s+Absheron.{0,350}?\$\s*([0-9,]+)\s*[–—-]\s*\$\s*([0-9,]+)",
        article,
        re.I | re.S,
    )
    turkey = re.search(
        r"Ambarli\s+and\s+Mersin.{0,350}?\$\s*([0-9,]+)\s*[–—-]\s*\$\s*([0-9,]+)",
        article,
        re.I | re.S,
    )
    if not baku:
        raise ValueError("Baku/Alat market range not found")

    b_low, b_high = money(baku.group(1)), money(baku.group(2))
    b_mid = round((b_low + b_high) / 2)

    data["headline"]["latest_baku_market"].update({
        "period": period,
        "value_usd": b_mid,
        "range": f"${b_low:,}–${b_high:,}",
        "confidence": "medium-high; reported as Argus market assessment",
        "source_name": "Argus, reported by Anews",
        "source_url": source_url,
    })
    data["headline"]["latest_mcfi_core"].update({
        "period": period,
        "value_usd": b_mid,
        "value_index": round(b_mid / float(data["model"]["theoretical_reference_usd"]) * 100, 1),
    })
    data["structural_benchmarks"]["market_defaults"]["latest_comparable_assessment"] = {
        "route": "Xi’an (China) → Baku/Alat (Azerbaijan)",
        "period": period,
        "low_usd": b_low,
        "high_usd": b_high,
        "midpoint_usd": b_mid,
        "container": "40HC",
        "source_name": "Argus, reported by Anews",
        "source_url": source_url,
        "note": "Latest publicly located market assessment.",
    }

    t_low = t_high = t_mid = None
    if turkey:
        t_low, t_high = money(turkey.group(1)), money(turkey.group(2))
        t_mid = round((t_low + t_high) / 2)
        data["headline"]["latest_turkey_market"].update({
            "period": period,
            "value_usd": t_mid,
            "range": f"${t_low:,}–${t_high:,}",
            "confidence": "medium-high; reported as Argus market assessment",
            "source_name": "Argus, reported by Anews",
            "source_url": source_url,
        })

    fundamental = float(data["model"]["theoretical_reference_usd"])
    if t_mid is not None:
        basket = round((b_mid + t_mid) / 2)
        upsert_month(data, {
            "period": period,
            "mcfi_usd": basket,
            "baku_midpoint_usd": b_mid,
            "turkey_midpoint_usd": t_mid,
            "type": "observed",
            "observed_routes": 2,
            "confidence": "medium-high",
            "basis": "Latest public market update reports both core route ranges.",
            "source_url": source_url,
            "premium_vs_model_pct": round((basket / fundamental - 1) * 100, 1),
            "mcfi_index": round(basket / fundamental * 100, 1),
            "fundamental_cost_usd": round(fundamental),
            "fundamental_anchor_status": "carry_forward",
        })

    upsert_observation(data, {
        "date": period, "period": period,
        "route": "Xi’an → Alat/Absheron (Baku)",
        "origin": "Xi’an", "destination": "Baku",
        "mode": "Middle Corridor multimodal", "container": "40HC",
        "ownership": "unspecified", "low_usd": b_low, "high_usd": b_high,
        "midpoint_usd": b_mid, "scope": "Core market assessment",
        "primary_eligible": True, "grade": "A-",
        "source_name": "Argus / market participants", "source_url": source_url,
        "notes": "Latest public market assessment.", "evidence_type": "market assessment",
    })

    if t_mid is not None:
        upsert_observation(data, {
            "date": period, "period": period,
            "route": "Xi’an → Mersin/Ambarli",
            "origin": "Xi’an", "destination": "Turkey",
            "mode": "Middle Corridor multimodal", "container": "40HC",
            "ownership": "unspecified", "low_usd": t_low, "high_usd": t_high,
            "midpoint_usd": t_mid, "scope": "Core market assessment",
            "primary_eligible": True, "grade": "A-",
            "source_name": "Argus / market participants", "source_url": source_url,
            "notes": "Latest public market assessment.", "evidence_type": "market assessment",
        })

    recompute_year_summary(data, period[:4])


def refresh_provider(data):
    text = text_of(get(WIDESAFE_NEWS).text)
    block_match = re.search(r"FCL\s+SOC\s+40HQ\s+Rates\s+to\s+Baku.{0,7000}", text, re.I | re.S)
    block = block_match.group(0) if block_match else text
    m = re.search(r"Xi[’'\-]?an(?:\s*\(Middle China\))?.{0,120}?\$\s*([0-9][0-9,]*)", block, re.I | re.S)
    if not m:
        raise ValueError("WideSafe Xi'an → Baku SOC 40HQ rate not found")
    price = money(m.group(1))
    data["headline"]["latest_provider_snapshot"].update({
        "value_usd": price,
        "route": "Xi’an (China) → Baku/Absheron (Azerbaijan)",
        "container_basis": "SOC 40HQ",
        "status": "published provider tariff",
        "source_name": "WideSafe",
        "source_url": WIDESAFE_NEWS,
    })


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    original = copy.deepcopy(data)
    errors = []

    try:
        refresh_market(data)
    except Exception as exc:
        errors.append(f"market refresh skipped: {exc}")

    try:
        refresh_provider(data)
    except Exception as exc:
        errors.append(f"provider refresh skipped: {exc}")

    if data != original:
        DATA.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("Updated data.json from current public sources.")
    else:
        print("No market-data changes detected.")

    for err in errors:
        print(err, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
