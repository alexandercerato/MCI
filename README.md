# Middle Corridor Freight Monitor v0.11.1

This release keeps the compact dark finance-terminal design of v0.10 and adds two operational features without changing the MCFI methodology:

1. **MCFI historical chart (2024 → present)** — monthly MCFI-40 values rendered from `data.json`. Consecutive observed months are connected normally; gaps remain visible and are connected with a dashed segment rather than interpolated. The current calendar month is marked separately. The chart redraws whenever the market dataset refreshes.
2. **Caspian Live** — optional live AIS layer for the Aktau–Kuryk–Alat/Baku sector using AISStream through a private backend. No vessels are simulated when the backend is not connected.

## MCFI-40

The standard shipment remains one loaded 40' HC, general dry cargo, westbound from Xi'an through Altynkol, Aktau and Alat/Baku. The index is a fixed 50/50 basket of Xi'an→Baku and Xi'an→Mersin/Ambarli monthly market assessments.

The chart does **not** interpolate missing MCFI months. A value is plotted only when the fixed two-route basket can be calculated from the underlying market observations.

## Market-data refresh

The browser reloads `data.json` every five minutes. The included GitHub Action runs `scripts/update_data.py` on the same cadence and refreshes supported public provider snapshots. Provider snapshots do not overwrite the MCFI-40 series.

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
- `scripts/update_data.py` — public-provider market refresh
