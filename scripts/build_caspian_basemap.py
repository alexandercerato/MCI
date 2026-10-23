"""Build a local regional basemap from pinned public-domain Natural Earth data.

Development-only dependencies: requests, shapely. No tile service or API key.
"""
import hashlib
import json
from pathlib import Path
import requests
from shapely.geometry import box, mapping, shape

REVISION = 'ca96624a56bd078437bca8184e78163e5039ad19'
SOURCE = f'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{REVISION}/geojson/ne_10m_admin_0_countries.geojson'
ROOT = Path(__file__).resolve().parents[1]


def build(payload):
    extent = box(30, 30, 72, 56)
    rim = box(44, 35, 57, 49)
    features = []
    for feature in json.loads(payload)['features']:
        geometry = shape(feature['geometry'])
        if not geometry.intersects(extent):
            continue
        clipped = geometry.intersection(extent).simplify(0.004, preserve_topology=True)
        if clipped.is_empty:
            continue
        name = feature['properties'].get('NAME_EN') or feature['properties']['NAME']
        props = {'name': name}
        if name in {'Russia', 'Kazakhstan', 'Azerbaijan', 'Iran', 'Turkmenistan'}:
            point = geometry.intersection(rim).representative_point()
            props.update(label_lon=round(point.x, 4), label_lat=round(point.y, 4))
        features.append({'type': 'Feature', 'properties': props, 'geometry': mapping(clipped)})
    output = {'type': 'FeatureCollection', 'source': SOURCE, 'source_revision': REVISION,
              'source_sha256': hashlib.sha256(payload).hexdigest(),
              'licence': 'Public domain · Natural Earth', 'scale': 'Regional reference geography, derived from 1:10m data',
              'features': features}
    # Keep coordinate precision modest and the public asset lightweight.
    def rounded(value):
        if isinstance(value, float):
            return round(value, 5)
        if isinstance(value, (tuple, list)):
            return [rounded(x) for x in value]
        if isinstance(value, dict):
            return {key: rounded(x) for key, x in value.items()}
        return value
    return rounded(output)


if __name__ == '__main__':
    response = requests.get(SOURCE, timeout=40)
    response.raise_for_status()
    result = build(response.content)
    destination = ROOT / 'assets' / 'caspian-basemap.geojson'
    destination.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f'{len(result["features"])} countries · {destination.stat().st_size:,} bytes')
