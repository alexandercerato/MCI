import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../caspian-data.js';
const {normalizeDataDocked,positionTime,classify,mergePosition,zoneFor,areas,distanceKm,ports}=globalThis.MCI_CASPIAN_DATA;
const now=Date.parse('2026-10-23T08:00:00Z');
const vessel={mmsi:'123456789',name:'Test vessel',latitude:'43.64',longitude:'51.17',speed:'81',course:'202',heading:'511'};
test('area discoveries convert AIS speed tenths and retain unknown position time',()=>{
  const row=normalizeDataDocked(vessel,{now});
  assert.equal(row.sog,8.1);assert.equal(row.heading,null);assert.equal(row.zone,'Aktau');
  assert.equal(row.last_seen,null);assert.equal(classify(row,now),'unverified');
  assert.equal(row.observed_at,'2026-10-23T08:00:00.000Z');
});
test('single-vessel speed is in knots and source time determines recency',()=>{
  const row=normalizeDataDocked({...vessel,speed:'8.1',positionReceived:'Oct 23, 2026 07:55 UTC',updateTime:'Oct 23, 2026 08:00 UTC'},{kind:'location',now});
  assert.equal(row.sog,8.1);assert.equal(row.last_seen,'2026-10-23T07:55:00.000Z');assert.equal(classify(row,now),'recent');
  const old=normalizeDataDocked({...vessel,positionReceived:'Oct 14, 2026 07:55 UTC',updateTime:'Oct 23, 2026 08:00 UTC'},{now});
  assert.equal(classify(old,now),'historical');
});
test('missing values, invalid identities and out-of-Caspian coordinates are rejected',()=>{
  for(const patch of [{mmsi:'0'},{latitude:null},{latitude:''},{latitude:'0',longitude:'0'},{longitude:181}])assert.equal(normalizeDataDocked({...vessel,...patch},{now}),null);
  assert.equal(normalizeDataDocked(vessel,{now,expectedMmsi:'987654321'}),null);
  assert.equal(normalizeDataDocked({...vessel,speed:null,course:''},{now}).sog,null);
});
test('only explicit valid time zones and real calendar dates establish AIS time',()=>{
  for(const time of ['2026-02-31T00:00:00Z','Feb 31, 2026 00:00 UTC','2026-10-23 07:00','2026-10-24T00:00:00Z','2026-10-23T25:00:00Z'])assert.equal(positionTime(time,now),null);
  assert.equal(positionTime('2026-10-23T10:55:00+03:00',now),'2026-10-23T07:55:00.000Z');
  assert.equal(classify({last_seen:'2026-10-23T07:20:00Z'},now),'last_known');
});
test('older or undated discoveries cannot overwrite a newer timed position',()=>{
  const recent={mmsi:'123456789',last_seen:'2026-10-23T07:55:00Z'};
  assert.equal(mergePosition(recent,{last_seen:null}),recent);
  assert.equal(mergePosition(recent,{last_seen:'2026-10-22T07:55:00Z'}),recent);
});
test('Baku and Alat are distinct zones and two bounded gateway searches cover all four reference ports',()=>{
  assert.equal(zoneFor(40.30,49.92),'Baku');assert.equal(zoneFor(39.95,49.39),'Alat');
  assert.equal(zoneFor(41.5,50.5),null);
  for(const port of ports)assert.ok(areas.some(area=>distanceKm(port,area)<=area.radiusKm));
  assert.ok(areas.every(a=>a.radiusKm<=50&&Number.isInteger(a.lat*10)&&Number.isInteger(a.lon*10)));
});
