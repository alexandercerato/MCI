# MCI — Middle Corridor Index · v0.7

Static finance-style dashboard for the Trans-Caspian / Middle Corridor with Aktau as the primary operating node.

## v0.7

- Adds **Aktau Live Port Activity** powered by VesselFinder when an API subscription/key is configured.
- Uses VesselFinder **LiveData** for the subscribed Aktau monitoring area and **PortCalls** for `KZAAU`.
- Publishes only derived aggregates: vessels detected, stopped/anchored count, arrivals/departures over 24h and 7d, and vessel-type mix.
- Keeps raw AIS records and the API key out of the public website.
- AIS activity is operational context and **does not mechanically change the MCI freight index**.
- Browser reloads `data.json` every 5 minutes; GitHub Actions requests a refreshed snapshot on a 5-minute cron. GitHub scheduled runs are best-effort and can be delayed.
- If VesselFinder is unavailable or not configured, the updater preserves the last valid AIS snapshot and marks it stale/not configured rather than inventing data.

## Configuration

1. Purchase/enable an appropriate VesselFinder API plan. `LiveData` requires a predefined subscribed area; ask VesselFinder to configure the Aktau port/approach area.
2. Add repository secret `VESSELFINDER_API_KEY`.
3. Enable GitHub Actions write permission and GitHub Pages.
4. Deploy repository root to Pages.

Aktau UN/LOCODE: `KZAAU`.

## Files

- `index.html`
- `styles.css`
- `app.js`
- `data.json`
- `scripts/update_data.py`
- `.github/workflows/update-data.yml`
- `requirements.txt`

## Licensing note

VesselFinder API/data use remains subject to the purchased plan and VesselFinder Terms. The public dashboard is intentionally designed around aggregate indicators, not redistribution of raw AIS/API content.
