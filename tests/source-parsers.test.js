import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseKurykText,wideSafeCard} from '../source-parsers.js';
const split=s=>s.split(/[,;]+/).map(x=>x.trim()).filter(Boolean);
const fixture=fs.readFileSync(new URL('./fixtures/kuryk-2026-10-17.txt',import.meta.url),'utf8');
test('official Kuryk sections keep anchorage separate from berths and approaches',()=>{
 const r=parseKurykText(fixture,split);
 assert.equal(r.traffic_date,'17.10.2026');
 assert.equal(r.berthed.reduce((n,x)=>n+x.vessel_names.length,0),5);
 assert.equal(r.anchored.length,1);
 assert.equal(r.approaching.length,4);
 assert.ok(r.anchored[0].vessel_name.includes('Нахичевань'));
 assert.ok(!r.berthed.at(-1).operation.includes('anchorage'));
});
test('Kuryk old layout without anchorage remains compatible',()=>{
 const old=fixture.replace(/Vessels at anchorage[\s\S]*?(?=Approaching vessels)/,'');
 assert.equal(parseKurykText(old,split).anchored.length,0);
});
test('unrelated listing price is never a WideSafe card',()=>{
 assert.equal(wideSafeCard("Industry News October 2026 Xi'an $5000",()=> '2026-10'),null);
});
test('undated WideSafe card is rejected',()=>{
 assert.throws(()=>wideSafeCard("FCL SOC 40HQ Rates to Baku Xi'an $5000",()=>null),/month/);
});
