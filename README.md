# Middle Corridor Freight Monitor v0.17.0

## MCFI-40 · full-corridor freight rate

Since 15 October 2026, MCFI-40 is the latest published market freight assessment in **USD per loaded 40HC container**, from Xi’an (China) to Ambarli/Mersin (Türkiye), across Kazakhstan, the Caspian Sea, Azerbaijan and Georgia.

For each observed month, the benchmark uses the midpoint of the full-route market range, or the median of midpoints where multiple comparable assessments exist. Partial Xi’an–Baku rates, provider-specific SOC tariffs and the structural cost model do not enter this calculation. No segment rates are added together.

The historical chart, annual summaries, table and CSV use this same basis. Missing months remain gaps. The assessment month is distinct from the time a feed is checked. The latest available observation is September 2026: **USD 7,600/40HC**, within a reported USD 7,200–8,000 range.

This replaces the previous market/cost ratio (168.3 points). The new dollar values must not be compared numerically with the old point scale. The theoretical Xi’an–Baku cost model remains contextual research only.

Validation: `python -m unittest discover -s tests -v` and `node --check app.js`.

## Market-data refresh

The browser reloads `data.json` every five minutes. The included GitHub Action runs `update_data.py` on the same cadence and refreshes supported public provider snapshots. Provider snapshots do not overwrite the MCFI-40 series.

## Caspian Live setup

AISStream requires a private API key. Do not put it in `app.js`, `runtime-config.js`, GitHub Pages, or any other public frontend file.

The `backend/` folder contains a small Node service that:

- opens the AISStream WebSocket;
- subscribes only to a central-Caspian bounding box;
- normalizes vessel positions;
- identifies vessels near Aktau, Kuryk, Alat and Baku;
- classifies underway / eastbound / westbound traffic;
- records completed east↔west Caspian crossings and calculates a rolling median crossing time;
- exposes a public read-only endpoint at `/api/caspian`.

Because the AIS connection is persistent, deploy this backend on a service that can keep a process alive (for example Render, Railway, Fly.io, a VPS, or equivalent), rather than a short-lived serverless function.

### Environment variables

Copy `backend/.env.example` and set:

```text
AISSTREAM_API_KEY=your_private_key
PORT=8787
ALLOWED_ORIGIN=https://YOUR_GITHUB_PAGES_DOMAIN
DATA_DIR=./data
CASPIAN_BOUNDS=39.0,48.0,45.2,53.0
```

Then run:

```bash
cd backend
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
- `backend/` — private AISStream collector/API
- `update_data.py` — public-provider market refresh
