# MCI — Middle Corridor Index

Static GitHub Pages dashboard for an experimental Middle Corridor / TITR freight benchmark.

## What is included

- **MCI Experimental** headline benchmark in USD/FEU and index points.
- Provisional westbound basket: MC1 Xi’an–Alat (40%), MC2 Xi’an–Tbilisi (30%), MC3 Xi’an–Türkiye (30%).
- Traffic, directionality, block-train, transit and Caspian indicators.
- Transparent methodology and source links.
- Daily public-source refresh via GitHub Actions.

## Automatic daily updates

`.github/workflows/update-data.yml` runs once per day at 05:17 UTC and can also be run manually from the Actions tab.

The Python updater:
1. checks the current source pages;
2. uses the public GDELT document API to discover newer articles from a strict source allow-list;
3. only accepts values that match conservative patterns and plausible numerical ranges;
4. keeps the last verified value when a source is unavailable or its markup changes;
5. appends a new MCI fixing only when the verified freight basket changes.

This means **daily refresh ≠ daily price movement**. If there is no new public market observation, the MCI remains unchanged.

## Publish on GitHub Pages

1. Create a GitHub repository and upload the contents of this folder to the repository root.
2. In **Settings → Pages**, choose **Deploy from a branch**.
3. Select `main` and `/ (root)`.
4. In **Settings → Actions → General → Workflow permissions**, allow **Read and write permissions** so the daily job can commit `data.json`.
5. Open the **Actions** tab and run “Update Middle Corridor data” once manually to test it.

No API key is required for the included updater.

## Important methodological limitation

Version 0.1 is an **experimental public-data benchmark**, not a regulated market index and not an executable carrier quote. The current three-lane weights are provisional. A production-grade benchmark should add recurring panel quotes / transaction observations, rules for quote age, outlier treatment, minimum observations, directional sub-indices and independent governance.

## Files

- `index.html` — dashboard
- `styles.css` — visual system
- `app.js` — rendering and chart logic
- `data.json` — verified snapshot consumed by the page
- `scripts/update_data.py` — daily updater
- `.github/workflows/update-data.yml` — scheduled automation
- `requirements.txt` — updater dependencies
