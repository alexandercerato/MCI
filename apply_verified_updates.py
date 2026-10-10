#!/usr/bin/env python3
"""Reconcile verified public structural updates without fabricating monthly prices."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
data_file = ROOT / "data.json"
data = json.loads(data_file.read_text(encoding="utf-8"))
baku = json.loads((ROOT / "baku-throughput-2026.json").read_text(encoding="utf-8"))

data["baku"] = {
    "throughput_period": baku["period"],
    "throughput_teu": baku["throughput_teu"],
    "throughput_yoy_pct": baku["year_on_year_growth_percent"],
    "throughput_status": baku["status"],
    "throughput_source_url": baku["source"],
    "annual_container_capacity_teu": baku["current_annual_container_capacity_teu"],
    "planned_capacity_teu": baku["planned_capacity_teu"],
    "phase_two_target_teu": baku["phase_two_capacity_target_teu"],
    "capacity_source_url": baku["capacity_source"],
    "note": "Preliminary throughput is not a live berth-occupancy percentage."
}
data["meta"]["version"] = "0.16.2"
data["meta"]["as_of"] = max(data["meta"].get("as_of", ""), "2026-10-10")
data["coverage_gaps"] = [
    x for x in data.get("coverage_gaps", [])
    if not (x.get("period") == "2026-09" and "Awaiting monthly assessment" in x.get("status", ""))
]
for x in data.get("year_summary", []):
    if "no normalized structural index" in x.get("note", ""):
        x["note"] = "Average of observed market-basket USD values; index points use period-specific structural cost anchors."
history = data.setdefault("fundamental_cost_history", [])
existing = {x["period"] for x in history}
for row in sorted(data.get("mcfi_monthly", []), key=lambda x: x["period"]):
    if row["period"] in existing or row.get("mcfi_index") is None or row.get("fundamental_cost_usd") is None:
        continue
    previous = next((x for x in reversed(history) if x["period"] < row["period"]), None)
    if not previous:
        continue
    history.append({
        "period": row["period"],
        "china_rail_usd": previous["china_rail_usd"],
        "border_admin_usd": previous["border_admin_usd"],
        "central_titr_usd": previous["central_titr_usd"],
        "fundamental_cost_usd": row["fundamental_cost_usd"],
        "anchor_status": row.get("fundamental_anchor_status", "carry_forward"),
        "anchor_label": "Last published KTZ Express anchor carried forward",
        "mcfi_index": row["mcfi_index"]
    })
    existing.add(row["period"])
history.sort(key=lambda x: x["period"])
result = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
if data_file.read_text(encoding="utf-8") != result:
    data_file.write_text(result, encoding="utf-8")
    print("Reconciled verified public data and structural history.")
else:
    print("No structural-data changes.")
