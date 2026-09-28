# MCI — Middle Corridor Index

Static GitHub Pages dashboard for the experimental **Middle Corridor Freight Index (MCI)**.

## What is included

- finance-style dark dashboard;
- MCI in the hero with **Jan 2026 = 100**;
- clickable MCI history chart;
- interactive Leaflet/OpenStreetMap corridor map;
- reference-lane price basket;
- cross-mode pricing panel (Middle Corridor, ocean, rail, air, road);
- TEU, tonnage, train, transit-time and Caspian operating statistics;
- latest-news feed;
- public methodology and source links;
- automatic public-source refresh **every 12 hours** with GitHub Actions.

## Publish on GitHub Pages

1. Upload the contents of this folder to the root of a public GitHub repository.
2. Go to **Settings → Pages**.
3. Under *Build and deployment*, choose **Deploy from a branch**.
4. Select `main` and `/ (root)`.
5. Save.

Your site will normally appear at `https://USERNAME.github.io/REPOSITORY/`.

## Automatic updates

The workflow is in `.github/workflows/update-data.yml` and runs at:

- 05:17 UTC
- 17:17 UTC

It can also be run manually from **Actions → Update Middle Corridor data → Run workflow**.

The updater follows a conservative rule: **12-hour refresh does not mean a synthetic 12-hour fixing**. If no new verified reference-lane quote is found, the prior MCI fixing is retained.

The automation also refreshes the monitored news feed. If a public source is unavailable, the last verified values remain in `data.json`.

## Important methodological note

MCI remains an experimental public-data benchmark, not a regulated Baltic Exchange benchmark and not a binding freight quote. The January 2026 base is provisional; later fixings use the published reference-lane basket described on the site.
