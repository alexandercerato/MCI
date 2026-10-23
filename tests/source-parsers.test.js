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

import {articleSnapshot,parseMarketRanges} from '../source-parsers.js';
const decode=s=>s.replace(/<[^>]*>/g,' ').replace(/&ndash;/g,'–');
const month=s=>s.match(/October 2026/)?'2026-10':s.match(/September 2026/)?'2026-09':null;
test('article metadata isolates the assessment from navigation and related news',()=>{
 const html='<h1>October 2026 unrelated headline</h1><script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',datePublished:'2026-09-30T15:30:09+04:00',articleBody:'<p>September 2026. Ambarli and Mersin $7,200&ndash;$8,000.</p>'})+'</script>';
 const article=articleSnapshot(html,decode),r=parseMarketRanges(article.text,month);
 assert.equal(article.published_at,'2026-09-30T11:30:09.000Z');
 assert.equal(r.turkey.period,'2026-09');assert.equal(r.turkey.midpoint_usd,7600);assert.equal(r.baku,null);
});
test('partial route range cannot turn into a full-route assessment',()=>{
 const r=parseMarketRanges('October 2026. Alat or Absheron $6,750–$7,200.',month);
 assert.equal(r.turkey,null);assert.equal(r.baku.midpoint_usd,6975);
});
test('invalid and undated market ranges are rejected',()=>{
 assert.throws(()=>parseMarketRanges('Ambarli and Mersin $7,200–$8,000.',month),/month/);
 assert.throws(()=>parseMarketRanges('October 2026 Ambarli and Mersin $8,000–$7,200.',month),/range/);
});

test('23 October bulletin reconciles berth, anchorage and approach lists',()=>{
 const text=fs.readFileSync(new URL('./fixtures/kuryk-2026-10-23.txt',import.meta.url),'utf8');
 const r=parseKurykText(text,split);
 assert.equal(r.traffic_date,'23.10.2026');
 assert.equal(r.berthed.reduce((sum,row)=>sum+row.vessel_names.length,0),5);
 assert.equal(r.berthed.length,3);
 assert.equal(r.anchored.length,2);
 assert.equal(r.approaching.length,3);
});
