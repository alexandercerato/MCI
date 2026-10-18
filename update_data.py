#!/usr/bin/env python3
"""Refresh public Middle Corridor market snapshots used as GitHub Pages fallback.

The live website reads current pricing from the Railway backend every five minutes.
This script keeps data.json aligned when a new public market observation appears.
It writes only when values actually change, so the scheduled workflow does not
create empty commits every five minutes.
"""
from pathlib import Path
from datetime import datetime, timezone
import copy
import csv
import json
import re
from statistics import median
import sys
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data.json"

ANEWS_BUSINESS = "https://anews.az/en/all/"
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


def article_snapshot(html):
    soup = BeautifulSoup(html, "html.parser")
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            value = json.loads(script.string or script.get_text())
            nodes = value if isinstance(value, list) else value.get("@graph", [value])
            for node in nodes:
                types = node.get("@type", [])
                if isinstance(types, str): types = [types]
                if not set(types).intersection(("NewsArticle", "Article")) or not node.get("articleBody"):
                    continue
                stamp = node.get("datePublished")
                published = None
                if stamp:
                    date = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
                    if date.tzinfo and date <= datetime.now(timezone.utc):
                        published = date.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
                return text_of(node["articleBody"]), published
        except (ValueError, TypeError, AttributeError):
            continue
    text = soup.get_text(" ", strip=True)
    heading = soup.find("h1")
    if heading: text = text[text.find(heading.get_text(" ", strip=True)):]
    return text.split("Similar news")[0], None


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


def refresh_market(data):
    source_url = discover_anews_pricing_url()
    article, published_at = article_snapshot(get(source_url).text)
    period = period_from_text(article)
    if not period or period > datetime.now(timezone.utc).strftime("%Y-%m"):
        raise ValueError("valid market period not found")

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
    if not baku and not turkey:
        raise ValueError("No comparable route market range found")

    if baku:
        b_low, b_high = money(baku.group(1)), money(baku.group(2))
        if not 0 < b_low <= b_high:
            raise ValueError("Invalid Baku range")
        b_mid = (b_low + b_high) / 2
        if period >= data["headline"]["latest_baku_market"]["period"]:
            data["headline"]["latest_baku_market"].update({
                "period": period, "value_usd": b_mid,
                "range": f"${b_low:,}–${b_high:,}",
                "source_name": "Argus, reported by Anews", "source_url": source_url, "published_at": published_at,
            })
            data["structural_benchmarks"]["market_defaults"]["latest_comparable_assessment"] = {
                "route": "Xi’an (China) → Baku/Alat (Azerbaijan)", "period": period,
                "low_usd": b_low, "high_usd": b_high, "midpoint_usd": b_mid,
                "container": "40HC", "source_name": "Argus, reported by Anews",
                "source_url": source_url, "note": "Partial-route market reference, outside the headline index.",
            }
        upsert_observation(data, {
            "date": period, "period": period, "route": "Xi’an → Alat/Absheron (Baku)",
            "origin": "Xi’an", "destination": "Baku", "mode": "Middle Corridor multimodal",
            "container": "40HC", "ownership": "unspecified", "low_usd": b_low,
            "high_usd": b_high, "midpoint_usd": b_mid, "scope": "Partial-route market assessment",
            "primary_eligible": False, "grade": "A-", "source_name": "Argus / market participants",
            "source_url": source_url, "notes": "Partial-route comparison only.",
            "evidence_type": "market assessment", "published_at": published_at,
        })

    if turkey:
        t_low, t_high = money(turkey.group(1)), money(turkey.group(2))
        if not 0 < t_low <= t_high:
            raise ValueError("Invalid Türkiye range")
        t_mid = (t_low + t_high) / 2
        if period >= data["headline"]["latest_turkey_market"]["period"]:
            data["headline"]["latest_turkey_market"].update({
                "period": period, "value_usd": t_mid,
                "range": f"${t_low:,}–${t_high:,}",
                "source_name": "Argus, reported by Anews", "source_url": source_url, "published_at": published_at,
            })
        upsert_observation(data, {
            "date": period, "period": period, "route": "Xi’an → Mersin/Ambarli",
            "origin": "Xi’an", "destination": "Turkey", "mode": "Middle Corridor multimodal",
            "container": "40HC", "ownership": "unspecified", "low_usd": t_low,
            "high_usd": t_high, "midpoint_usd": t_mid, "scope": "Full-corridor market assessment",
            "primary_eligible": True, "grade": "A-", "source_name": "Argus / market participants",
            "source_url": source_url, "notes": "Full Xi’an–Türkiye assessment; not added to Baku freight.",
            "evidence_type": "market assessment", "published_at": published_at,
        })


def is_full_route_assessment(row):
    origin = str(row.get("origin", "")).replace("’", "'").lower()
    return (
        origin == "xi'an"
        and row.get("destination") in ("Turkey", "Türkiye")
        and row.get("container") == "40HC"
        and row.get("evidence_type") == "market assessment"
        and re.fullmatch(r"20\d{2}-\d{2}", str(row.get("period", ""))) is not None
        and isinstance(row.get("low_usd"), (int, float))
        and isinstance(row.get("high_usd"), (int, float))
        and 0 < row["low_usd"] <= row["high_usd"]
    )


def rebuild_freight_series(data):
    """Derive every published value from full-route assessments, never segment sums."""
    groups = {}
    for row in data.get("historical_observations", []):
        eligible = is_full_route_assessment(row)
        row["primary_eligible"] = eligible
        if eligible:
            groups.setdefault(row["period"], []).append(row)
    rows = []
    for period, observations in sorted(groups.items()):
        # Deduplicate repeated records from the same publication.
        unique = {(r.get("source_url"), r["low_usd"], r["high_usd"]): r for r in observations}
        obs = list(unique.values())
        value = median((r["low_usd"] + r["high_usd"]) / 2 for r in obs)
        rows.append({
            "period": period, "mcfi_usd": value,
            "low_usd": min(r["low_usd"] for r in obs),
            "high_usd": max(r["high_usd"] for r in obs),
            "route": "Xi’an (China) → Mersin/Ambarli (Türkiye)",
            "container": "40HC", "unit": "USD per 40HC", "type": "observed",
            "assessment_count": len(obs), "observed_routes": 1,
            "confidence": "Published market assessments; not executable quotes",
            "basis": "Median of full-route assessment midpoints; no partial-route averaging or cost-model division.",
            "source_url": obs[-1]["source_url"],
            "source_urls": list(dict.fromkeys(r["source_url"] for r in obs)),
            "published_at": max((r["published_at"] for r in obs if r.get("published_at")), default=None),
        })
    for row in rows:
        if not row.get("published_at"): row.pop("published_at", None)
    data["mcfi_monthly"] = rows
    if rows:
        latest = rows[-1]
        data["headline"]["latest_mcfi_core"] = {
            "period": latest["period"], "value_usd": latest["mcfi_usd"],
            "low_usd": latest["low_usd"], "high_usd": latest["high_usd"],
            "unit": "USD per 40HC", "coverage": latest["route"],
            "confidence": latest["confidence"], "source_url": latest["source_url"], "published_at": latest.get("published_at"),
        }
    else:
        data["headline"]["latest_mcfi_core"] = {"period": None, "value_usd": None}
    data["year_summary"] = []
    for year in sorted({r["period"][:4] for r in rows}):
        vals = [r["mcfi_usd"] for r in rows if r["period"].startswith(year)]
        data["year_summary"].append({"year": int(year), "complete_months": len(vals),
            "average_usd": round(sum(vals) / len(vals)), "low_usd": min(vals), "high_usd": max(vals)})


def refresh_aktau(data):
    """Apply the checked structural snapshot on every scheduled refresh."""
    snapshot = json.loads((ROOT / "aktau-operations-2026.json").read_text(encoding="utf-8"))
    data["aktau"].update({
        "container_hub_teu": snapshot["capacity_operational_teu_per_year"],
        "container_hub_planned_teu": snapshot["capacity_planned_teu_per_year"],
        "capacity_note": snapshot["capacity_note"],
        "capacity_source_url": snapshot["sources"]["capacity"],
        "throughput_period": snapshot["period"],
        "throughput_teu": snapshot["throughput_teu"],
        "throughput_yoy_pct": snapshot["year_on_year_growth_percent"],
        "throughput_source_url": "https://t.me/PR_KTZh/5754",
    })


def refresh_baku(data):
    snapshot = json.loads((ROOT / "baku-throughput-2026.json").read_text(encoding="utf-8"))
    data.setdefault("baku", {}).update({
        "throughput_period": snapshot["period"], "throughput_teu": snapshot["throughput_teu"],
        "throughput_yoy_pct": snapshot["year_on_year_growth_percent"],
        "throughput_status": snapshot["status"], "throughput_source_url": snapshot["source"],
        "annual_container_capacity_teu": snapshot["current_annual_container_capacity_teu"],
        "planned_capacity_teu": snapshot["planned_capacity_teu"],
        "phase_two_target_teu": snapshot["phase_two_capacity_target_teu"],
        "capacity_source_url": snapshot["capacity_source"],
        "note": "Reported cumulative throughput is not live berth occupancy; future capacity is not operational capacity."
    })



def refresh_kuryk(data):
    """Use the dated official first-half throughput report, not live berth data."""
    snapshot = json.loads((ROOT / "kuryk-throughput-2026.json").read_text(encoding="utf-8"))
    data["kuryk"] = {
        "throughput_period": snapshot["period"],
        "throughput_tonnes": snapshot["throughput_tonnes"],
        "throughput_status": snapshot["status"],
        "throughput_source_url": snapshot["source_url"],
        "published_at": snapshot["published_at"],
        "note": "First-half cargo tonnage, not container TEU or a real-time vessel count."
    }


def reconcile_coverage_gaps(data):
    """An observed full-route month cannot also be marked as a missing month."""
    observed = {row["period"] for row in data.get("mcfi_monthly", [])}
    data["coverage_gaps"] = [
        gap for gap in data.get("coverage_gaps", [])
        if gap.get("period") not in observed
    ]


def refresh_tariff_references(data):
    snapshot = json.loads((ROOT / "tariff-reference-2026.json").read_text(encoding="utf-8"))
    sb = data["structural_benchmarks"]
    segment = next(row for row in sb["segments"] if row["id"] == "dostyk_aktau")
    segment.update({k: snapshot["dostyk_aktau"][k] for k in ("source_url", "value_usd", "distance_km", "delivery_hours")})
    segment["status"] = "published 2026 reference; booking terms require confirmation"
    sb["integrated_official_reference"] = snapshot["integrated_feeder"]
    for source in data.get("sources", []):
        if source["url"] == "https://middlecorridor.com/images/tariffs/6.pdf":
            source.update(name="TITR 2026 Dostyk–Aktau published rail tariff",url=snapshot["dostyk_aktau"]["source_url"])
        elif source["url"] == "https://middlecorridor.com/images/tariffs/1.pdf":
            source.update(name="TITR 2026 Altynkol–Alat feeder schedule; maritime validity requires confirmation",url=snapshot["integrated_feeder"]["source_url"])


def refresh_provider(data):
    text = text_of(get(WIDESAFE_NEWS).text)
    snapshot = data["headline"]["latest_provider_snapshot"]
    # The redesigned news listing is not a price card. Never associate a price
    # or publication date from another article with the historic route quote.
    block = re.search(r"FCL\s+SOC\s+40HQ\s+Rates\s+to\s+Baku.{0,7000}", text, re.I | re.S)
    if not block:
        snapshot["status"] = "historical tariff; no current public price card"
        snapshot["source_status"] = "not_published"
        return
    period = period_from_text(block.group(0))
    m = re.search(r"Xi[’'\-]?an(?:\s*\(Middle China\))?.{0,120}?\$\s*([0-9][0-9,]*)", block.group(0), re.I | re.S)
    if not m or not period:
        raise ValueError("WideSafe price card requires a route price and explicit assessment month")
    if period < snapshot.get("period", ""):
        return
    snapshot.update({"value_usd": money(m.group(1)), "period": period,
        "source_status": "dated_card", "status": "dated provider tariff; validity not confirmed",
        "route": "Xi’an (China) → Baku/Absheron (Azerbaijan)",
        "container_basis": "SOC 40HQ", "source_name": "WideSafe", "source_url": WIDESAFE_NEWS})


def write_history_csv(data):
    fields = ["period", "mcfi_usd", "low_usd", "high_usd", "route", "container", "unit", "type", "assessment_count", "confidence", "basis", "source_url"]
    with (ROOT / "mcfi_history.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        writer.writerows(data["mcfi_monthly"])


def write_raw_csv(data):
    fields = ["date", "period", "route", "origin", "destination", "container", "ownership", "low_usd", "high_usd", "midpoint_usd", "scope", "primary_eligible", "grade", "evidence_type", "source_name", "source_url", "notes"]
    with (ROOT / "raw_observations.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        writer.writerows(data.get("historical_observations", []))


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

    refresh_aktau(data)
    refresh_baku(data)
    refresh_kuryk(data)
    refresh_tariff_references(data)
    rebuild_freight_series(data)
    reconcile_coverage_gaps(data)

    if data != original:
        DATA.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("Updated data.json from current public sources.")
    else:
        print("No market-data changes detected.")

    write_history_csv(data)
    write_raw_csv(data)

    for err in errors:
        print(err, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
