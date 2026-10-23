# Data Docked integration · not activated

The owner requested Aktau, Kuryk, Baku/Alat and wider Caspian vessel visibility, and selected **licence to be verified**. No production key, paid request, licence acceptance or public Data Docked data is part of this change. Existing public feeds and official port bulletins continue independently.

## Confirm before activation

1. Check the account's plan, credits, satellite entitlement and written permission for public display. The standard Data Docked terms restrict redistribution and public display; an API key alone does not establish permission for this public site.
2. Agree a daily credit ceiling and update cadence. Two 50 km searches discover ships near the four gateways: a shared Aktau/Kuryk area and a shared Baku/Alat area. Each search currently costs 10 credits. Up to five single-vessel timestamp lookups add at most five credits per cycle with the default configuration. At one cycle per hour, the maximum is 600 credits per day, before the configured ceiling stops requests. This is an estimate from the published standard rates, not an account-specific quote.
3. Verify actual Caspian coverage with a limited private test. A map covering the sea does not guarantee AIS coverage everywhere. Area queries have a 50 km maximum radius. Known MMSIs can subsequently be queried across the basin; satellite availability depends on the account.

## Secure deployment configuration

Use only the existing backend service's secret/environment settings. Never place the API key in GitHub Pages, frontend JavaScript, URLs, committed files, screenshots or chat.

| Variable | Default / purpose |
|---|---|
| `DATADOCKED_ENABLED` | `false`; keeps the integration inactive |
| `DATADOCKED_PUBLIC_DISPLAY_ALLOWED` | `false`; set only after public-display permission is confirmed |
| `DATADOCKED_API_KEY` | Private backend key; sent in `x-api-key` header |
| `DATADOCKED_DAILY_CREDIT_LIMIT` | `0`; explicit positive whole-number ceiling required |
| `DATADOCKED_BUDGET_FILE` | Path on persistent storage, required to preserve spending across deploys |
| `DATADOCKED_REFRESH_MINUTES` | `60`; minimum 60 minutes in this first integration |
| `DATADOCKED_MAX_LOCATION_LOOKUPS` | `5`; bounded to 0–25 single-vessel lookups per cycle |

The budget ledger must be deliberately initialized on persistent storage with `date` (current UTC date, `YYYY-MM-DD`) and `spent` (credits already reserved that day). Missing/corrupt ledgers disable requests. Use a single backend replica; the file ledger is not a distributed quota system. It reserves credits before every request, including failed requests, to avoid optimistic retries. A new UTC day resets the daily allowance; redeploying with the same ledger does not. The current Railway MCI service has no persistent volume, so this must be addressed before enabling the credit budget. Do not silently initialize an empty ledger on each deploy.

The adapter polls centrally; browser visitors only read cached `/api/caspian` snapshots. Requests never originate from the frontend. Authentication failures stop further requests until the process/key is changed. Rate limits do not trigger an immediate retry. Errors expose status codes, never provider response bodies or credentials.

## Data semantics

- Area results have no documented AIS timestamp. They remain **time unverified**, even after a successful retrieval. Area speed is converted from tenths of knots.
- Single-vessel lookups use `positionReceived`, not `updateTime` or retrieval time. Their speed is already in knots. UTC and explicit-offset timestamps are validated; future/invalid dates never establish recency.
- More recent timed positions from existing providers take precedence over older or undated discoveries. MMSIs are deduplicated across providers.
- The default map shows positions received within 30 minutes. Older and undated reports require an explicit filter change and retain their labels. No synthetic positions, interpolated crossings or guessed berth-occupancy percentages are published.
- AIS statistics do not change MCFI-40, its freight assessments, chart, estimator calibration or price history.

## Validation and references

`node --test tests/caspian-data.test.js tests/datadocked.test.js` uses synthetic responses and no network access. Live credentials, real responses and observed local coverage still need validation after the account setup is confirmed.

- https://docs.datadocked.com/api-reference/introduction
- https://docs.datadocked.com/api-reference/vessel/get-vessels-by-area
- https://docs.datadocked.com/api-reference/vessel/get-vessel-location
- https://datadocked.com/terms · sections 4.1–4.5

The regional basemap is a local, simplified extract of public-domain Natural Earth 1:10m country/coastline geometry. Its source revision and hash are embedded in `assets/caspian-basemap.geojson`; `scripts/build_caspian_basemap.py` reproduces it. It uses no third-party tile service, tracking data or extra API key. It is regional reference geography, not berth-level surveying.

Railway publication on 23 October returned “Deploys have been paused temporarily”. Backend changes saved in GitHub are not running until a new deployment reaches terminal `SUCCESS` and `/api/health` reports version `0.13.0` and the expected source revision.
