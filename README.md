# Middle Corridor Freight Monitor

## MCFI-40 · full-corridor freight rate

Since 15 October 2026, MCFI-40 is the latest published market freight assessment in **USD per loaded 40HC container**, from Xi’an (China) to Ambarli/Mersin (Türkiye), across Kazakhstan, the Caspian Sea, Azerbaijan and Georgia.

For each observed month, the benchmark uses the midpoint of the full-route market range, or the median of midpoints where multiple comparable assessments exist. Partial Xi’an–Baku rates, provider-specific SOC tariffs and the structural cost model do not enter this calculation. No segment rates are added together.

The historical chart, annual summaries, table and CSV use this same basis. Missing months remain gaps. The assessment month is distinct from the time a feed is checked. The latest available observation is September 2026: **USD 7,600/40HC**, within a reported USD 7,200–8,000 range.

This replaces the previous market/cost ratio (168.3 points). The new dollar values must not be compared numerically with the old point scale. The theoretical Xi’an–Baku cost model remains contextual research only.

Validation: `python -m unittest discover -s tests -v` and `node --check app.js`.

## Route Cost Estimator

The Estimator view covers 25 locations on the main corridor and the Black Sea branch, with 40HC equipment and standard non-hazardous dry cargo up to a model limit of 24 tonnes. This limit is not a legal or physical container loading limit.

- Exact Xi’an–Baku and Xi’an–Ambarli/Mersin market ranges are shown as dated published assessments. The source groups the two Turkish destinations; no unsupported port differential is added.
- Other routes are explicitly low-confidence modelled scenarios. The graph finds a connected illustrative path using positive rail/sea cost weights. Railway geometry is great-circle distance × 1.25. Regional weights use existing historical rail, ferry and integrated-tariff references; those integrated tariffs are not added to overlapping component tariffs.
- Each scenario is calibrated to one available westbound market assessment, prioritising edge overlap, recency and proximity of scope. The midpoint is allocated across disjoint path segments. The normal ±35% scenario allowance is widened for reverse movements, Black Sea extrapolation, weak route overlap and market anchors over 90 days old. These are explicit modelling assumptions, not statistical confidence intervals.
- Commodity selection does not introduce unsupported markups. Refrigerated, dangerous and out-of-gauge cargo, heavy loads and unsuitable local transfers require an operator quote.
- Source scope, container provision, exclusions and assumptions remain visible. The estimator does not alter `data.json`, MCFI-40, its chart or CSV.

`estimator.js` contains the pure engine; `estimator-ui.js` preserves the form state and recalculates from the same `data.json` and successful `/api/pricing` updates used by the website every five minutes. Reviewed, unavailable or older live assessments do not replace newer stored references. A refresh timestamp is distinct from the assessment month.

Run `node tests/test-estimator.cjs` to check all 600 ordered city pairs, allocations, special-cargo guards, live price updates, stale-source fallback and isolation of the index.

## Market-data refresh

The browser reloads `data.json` every five minutes. The included GitHub Action runs `update_data.py` on the same cadence and refreshes supported public provider snapshots. Provider snapshots do not overwrite the MCFI-40 series.

## Caspian map and Data Docked

The Port activity view includes an interactive full-basin map, gateway focus controls, vessel search, source timestamps and separate recent / last-known / historical filters. Baku bay and the Port of Baku at Alat are distinct locations. Port AIS counts are observed reports within 15 nautical miles, not berth occupancy or a census of port traffic. Official Aktau berth occupancy remains a separate, dated bulletin.

Data Docked integration is **prepared but disabled**. No live Data Docked request has been made. The owner selected “licence to be verified”; do not enable requests or public display until the plan, credit allowance and public-display rights are confirmed. See [the setup guide](docs/datadocked.md).

## Caspian backend setup

AISStream requires a private API key. Do not put it in `app.js`, `runtime-config.js`, GitHub Pages, or any other public frontend file.

The root `server.js` contains a Node service that:

- opens the AISStream WebSocket;
- subscribes to the configured Caspian bounding box;
- normalizes vessel positions;
- identifies vessels near Aktau, Kuryk, Alat and Baku;
- classifies underway / eastbound / westbound traffic;
- records completed east↔west Caspian crossings and calculates a rolling median crossing time;
- exposes a public read-only endpoint at `/api/caspian`.

Because the AIS connection is persistent, deploy this backend on a service that can keep a process alive (for example Render, Railway, Fly.io, a VPS, or equivalent), rather than a short-lived serverless function.

### Environment variables

Copy `.env.example` to a private `.env` and set:

```text
AISSTREAM_API_KEY=your_private_key
PORT=8787
ALLOWED_ORIGIN=https://YOUR_GITHUB_PAGES_DOMAIN
DATA_DIR=./data
CASPIAN_BOUNDS=36,46,47.5,55
```

Then run:

```bash
npm install
npm start
```

After deploying the backend, edit `runtime-config.js`:

```js
window.MCFM_CONFIG = {
  aisApiBase: "https://YOUR-AIS-BACKEND"
};
```

The frontend polls `/api/caspian` every 30 seconds. If no backend URL is configured, the Caspian Live panel simply displays an offline/not-connected state.

### Recommended deployment: persistent Node service

A `render.yaml` blueprint is included for a persistent WebSocket backend. The API key is intentionally **not** included anywhere in this package. Add `AISSTREAM_API_KEY` as a secret/environment variable in the hosting dashboard.

For GitHub Pages, keep only the public frontend files in the repository. The included `.gitignore` prevents local `.env` files and runtime crossing data from being committed accidentally.

After the backend is live, set only its public URL in `runtime-config.js`; that file must never contain the AISStream key.

## Files

- `index.html` — dashboard markup
- `styles.css` — finance-terminal styling, chart and AIS panel
- `app.js` — dashboard rendering, MCFI chart and AIS frontend logic
- `data.json` — current market dataset
- `mcfi_history.csv` — MCFI monthly series
- `raw_observations.csv` — wider historical evidence database
- `runtime-config.js` — public runtime endpoint configuration only; never place secrets here
- `server.js` — private AIS collector/API
- `caspian-data.js` — shared geography and position-age rules
- `caspian-map.js` — interactive Caspian map
- `datadocked.js` — gated Data Docked integration and durable credit guard
- `update_data.py` — public-provider market refresh
