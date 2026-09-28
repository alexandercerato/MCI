# Middle Corridor Freight Monitor v0.9

## MCFI-40 Core

MCFI-40 Core is **not** based on January 2026 or any other historical base month. It is a fixed ex-ante theoretical shipment:

- one loaded 40' HC / 40HQ;
- general dry, non-hazardous cargo;
- westbound from Xi'an;
- core routing via Altynkol → Aktau → Alat/Baku;
- fixed 50/50 basket of Xi'an→Baku and Xi'an→Mersin/Ambarli.

For every month, each route is valued at the midpoint of its comparable monthly market range. The index in USD/40HC is the equal-weighted average of those two route assessments.

**No interpolation.** If either core route is missing, no MCFI value is published for that month. Provider rate cards and other route tariffs remain visible in `raw_observations.csv` but cannot fill a market-assessment gap.

## Historical coverage

`data.json` includes recoverable evidence from 2024, 2025 and 2026. Complete core observations are stored in `mcfi_monthly`; non-comparable or partial observations are stored in `historical_observations`; known missing periods are listed in `coverage_gaps`.

## Automatic refresh

The browser reloads `data.json` every five minutes. The included GitHub Action also runs every five minutes and checks the public WideSafe page for the latest **single-provider** Xi'an→Baku snapshot. That snapshot is context only: the updater is intentionally unable to manufacture or overwrite MCFI Core values.

GitHub scheduled workflows are best-effort and can run late. For genuine automated MCFI updates, add a licensed or stable market-assessment feed for both core lanes and only publish when both observations are present.

## Files

- `index.html` — dashboard
- `data.json` — model + history + evidence
- `mcfi_history.csv` — complete MCFI observations
- `raw_observations.csv` — audit trail
- `scripts/update_data.py` — safe provider-snapshot updater
- `.github/workflows/update.yml` — GitHub Actions schedule
