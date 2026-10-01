# MCFI Theoretical Cost Model — v0.1

Status: research draft (not yet used by the public website)
As of: 2026-10-01

## 1. Core lane

The MCFI Core compares like with like:

- Shipment: 1 × loaded 40HC, SOC, general dry non-hazardous cargo
- Direction: westbound
- Origin: Xi'an Xinzhu / Xi'an International Port
- Route: Xi'an → Alashankou → Altynkol/Dostyk → Aktau → Alat → Absheron (Baku)
- Destination basis: terminal/station transportation cost before destination unloading unless the market assessment is demonstrated to include it
- Excluded: first/last-mile trucking, customs duties, cargo insurance, inspections, storage/demurrage, dangerous/reefer surcharges, VAT/taxes

The market numerator should be the Xi'an–Absheron (Baku) 40HC monthly market assessment, not a basket mixing Baku and Türkiye.

## 2. Index definition

MCFI(t) = 100 × MarketFreight(t) / TheoreticalModelCost(t)

Interpretation:
- 100 = market freight equals the theoretical structural cost
- 120 = 20% market premium
- 90 = market freight is 10% below the model

No arbitrary calendar month is used as the base.

## 3. Cost equation

TMC(t) = ChinaRail(t) + ChinaOriginHandling(t) + BorderTransshipment(t) + TITRBackbone(t)

### A. ChinaRail

Standard 40-foot rail tariff formula:

ChinaRail_CNY = 532 + 3.357 × tariff_km

Draft distance: 3,151 km (Xi'an/Xinzhu to Alashankou).

Draft result:
ChinaRail_CNY = 11,109.907 CNY

Sources:
- https://swj.huaibei.gov.cn/swzx/tzgg/57529481.html
- https://news.cnr.cn/native/city/20160811/t20160811_522952755.shtml
- https://ec.95306.cn/del-query

Confidence: medium-high.
Note: 95306 states actual shipment charges are determined on the shipment date and its calculator separates freight, handling, container use and international transshipment charges. The standard formula is used as a structural benchmark, not as a claim about a negotiated block-train rate.

### B. ChinaOriginHandling

Draft standardized loaded-40ft railway handling charge:
292.5 CNY/container.

Source benchmark:
- current China Railway group procurement/tariff examples consistently use 292.5 CNY for a loaded 40ft container.

Confidence: medium.
Action required: replace with an exact Xi'an/Xinzhu published handling charge when retrievable.

### C. BorderTransshipment

Draft standardized international transshipment charge:
225 CNY / loaded 40ft.

Source:
- https://mohe.gov.cn/mohe/c101577/202309/c13_260730.shtml

The source identifies 225 CNY as the domestic-standard 40ft loaded-container transshipment charge at a rail border terminal. It is used as a national-standard proxy, not as an Alashankou-specific quotation.

Confidence: medium-low.
Action required: replace with current Alashankou-specific tariff when retrievable.

### D. TITRBackbone

Latest public KTZ Express integrated tariff found for:
Altynkol exp. → Absheron, loaded 40ft = 2,610 USD.

It includes:
- loaded rail tariffs in Kazakhstan and Azerbaijan (and Georgia where applicable)
- Aktau wagon placement/removal and railway-track charges
- port charges in Aktau and Baku
- Aktau → Baku/Alat sea freight
- transit customs declaration
- dispatching support
- forwarder's fee

It excludes handling at destination stations.

Source:
- https://www.ktze.kz/en/services/calculators?tab=0

Published validity: through 2026-03-31.
The KTZ site still displays the rate as of 2026-10-01, but no later public replacement was located.

Confidence: high as a published tariff; medium for current-period calibration because the stated validity has expired.

## 4. Cross-checks

### Kazakhstan rail
TITR separately publishes Dostyk → Aktau at 1,250 USD for a loaded 40ft container, 3,095 km, 114 hours, with rolling-stock use included for containers from China.

Source:
- https://middlecorridor.com/images/tariffs/6.pdf

This is NOT added to the 2,610 USD KTZ integrated tariff, because that would double count the Kazakhstan rail segment.

### Altynkol → Baku/Alat
The official TITR 2025 integrated feeder tariff was 2,348 USD for a loaded 40ft container, Altynkol → Aktau → Baku/Alat, 3,654 km, 5 days.

Source:
- https://middlecorridor.com/images/tariffs/1.pdf

This is a cross-check and an alternative Baku/Alat lane benchmark; it is not added to the KTZ 2,610 USD Absheron tariff.

### Baku port
The Port of Baku public tariff lists transit handling for a loaded 40ft container at 100 USD direct / 120 USD full operation.

Source:
- https://portofbaku.com/storage/files/7/Tarifler.pdf

This is useful for later decomposition of the integrated TITR block. Do not add it on top of the KTZ integrated rate unless it is proven excluded.

## 5. FX convention

For a current snapshot, convert CNY components to USD using an official daily or monthly-average CNY/USD cross rate.

On 2026-10-01, National Bank of Kazakhstan official rates:
- USD/KZT = 440.86
- CNY/KZT = 65.76

Thus:
CNY/USD = 65.76 / 440.86 = 0.149163

Source:
- https://nationalbank.kz/en/exchangerates/ezhednevnye-oficialnye-rynochnye-kursy-valyut

For historical monthly MCFI values, use monthly-average FX rather than today's FX.

## 6. v0.1 snapshot calculation

Using:
- China rail: 11,109.907 CNY
- Xi'an handling proxy: 292.5 CNY
- border transshipment proxy: 225 CNY
- CNY/USD: 0.149163
- Altynkol → Absheron integrated TITR block: 2,610 USD

China block = 11,627.407 CNY = approximately 1,734.38 USD

TMC v0.1 = 1,734.38 + 2,610 = approximately 4,344.38 USD / loaded 40HC

This is a prototype theoretical benchmark, not yet a publishable production value because:
1. the 2,610 USD KTZ rate is the latest public rate located but is formally valid only through 31 March 2026;
2. Xi'an handling is a standardized national rail benchmark rather than an exact Xi'an terminal tariff;
3. the 225 CNY border value is a national-standard proxy and needs Alashankou confirmation.

## 7. Market comparison example

The September 2026 reported Xi'an → Alat/Absheron range is 6,750–7,200 USD/40HC, midpoint 6,975 USD.

At the v0.1 theoretical cost of 4,344.38 USD:

Prototype MCFI = 100 × 6,975 / 4,344.38 ≈ 160.6

Interpretation: the observed midpoint would be about 60.6% above the v0.1 structural benchmark.

Do not publish this number yet; it is a validation output while the three open inputs above are being resolved.

## 8. Next research steps

1. Retrieve exact current Xi'an/Xinzhu loaded-40HC origin handling tariff.
2. Retrieve exact current Alashankou 40HC international transshipment tariff.
3. Find a post-31.03.2026 KTZ/TITR Altynkol → Absheron integrated tariff or obtain a direct rate confirmation.
4. Once those are resolved, back-cast the theoretical model month-by-month using effective tariff periods and monthly FX.
5. Only then replace the current January-2026-based index on the public site.
