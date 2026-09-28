# MCI — Middle Corridor Index · v0.6

Finance-style public-data dashboard for the Trans-Caspian / Middle Corridor, with **Aktau Port as the primary operating node**.

## v0.6 changes

- The MCI remains the lead benchmark (`Jan 2026 = 100`), but the low-information historical chart has been removed. The hero now prioritises the **index level, USD/FEU fixing, base basket, fixing date, lane count and ocean premium**.
- Rebuilt the route as a **self-contained, non-tiled SVG corridor map**: Xi’an → Khorgos → Altynkol → Aktau → Alat → Tbilisi, then Türkiye and Black Sea branches.
- The map carries the current three MCI through-rates plus Aktau capacity, berth count, container-hub capacity, Aktau–Alat volume signal, ferry-load constraint, draft programme and reference transit time.
- Aktau remains the main operating focus: **11.8 Mt/year port capacity, 11 berths, 140k TEU stage-1 container-hub capacity, 240k TEU planned design capacity** and the current dredging / berth-upgrade programme.
- Public-source snapshot was rechecked on **28 Sep 2026**. The MCI itself remains a **Jun 2026 fixing** because no newer public three-lane basket with comparable definitions was found; the dashboard does not manufacture a September fixing.
- Ocean comparison is current to the latest public Drewry WCI observation found: **Shanghai → Rotterdam $3,485/40ft on 24 Sep 2026**.
- GitHub Actions is scheduled every **5 minutes**. The browser also requests a cache-busted `data.json` every five minutes.

## Publish on GitHub Pages

Place these files in the repository root:

- `index.html`
- `styles.css`
- `app.js`
- `data.json`
- `requirements.txt`
- `README.md`
- `scripts/update_data.py`
- `.github/workflows/update-data.yml`

Then use **Settings → Pages → Deploy from a branch → main → /(root)**.

## Data refresh

`.github/workflows/update-data.yml` wakes every five minutes (GitHub's minimum cron interval). Scheduled Actions can be delayed by GitHub, so this is a requested cadence rather than a hard real-time guarantee.

All monitored source classes are checked on every scheduled run, with discovery results capped to keep the process lightweight. A data-file commit occurs **only when a verified datapoint changes**.

A **source check is not the same as a new MCI fixing**. The index changes only when a comparable reference-lane price changes. If a source is unavailable or no newer comparable observation exists, the last verified value is retained.

## Important methodology note

The MCI is experimental. The January 2026 base is provisional. The displayed `MC1/MC2/MC3` prices are through-rates. The route map labels implied step-ups as arithmetic differences between through-rates, not as independently observed segment freight rates.


## Index guide

The homepage now includes a dedicated **What the MCI tracks** section explaining the reference unit, basket construction, index-base logic, fixing rules, inclusions and exclusions. The current MCI and USD/FEU basket values in that explainer are populated directly from `data.json`.
