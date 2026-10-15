const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'..');const ctx={module:{exports:{}}};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root,'estimator.js'),'utf8'),ctx);const engine=ctx.module.exports;
const data=JSON.parse(fs.readFileSync(path.join(root,'data.json'),'utf8'));
const now=new Date('2026-10-15T12:00:00Z');
const shipment={from:'xian',to:'istanbul',cargo:'general',weight:20,container:'40HC'};
const run=(params={},live=null,d=data,date=now)=>engine.estimate({...shipment,...params},d,live,date);
const turkey=run();assert.equal(turkey.kind,'assessment');assert.equal(turkey.low,data.headline.latest_mcfi_core.low_usd);assert.equal(turkey.high,data.headline.latest_mcfi_core.high_usd);
assert.equal(run({to:'mersin'}).low,turkey.low);assert.match(run({to:'mersin'}).warnings.join(' '),/groups Ambarli and Mersin/);
const partial=run({from:'aktau',to:'tbilisi'});assert.equal(partial.kind,'model');assert.equal(partial.confidence,'Low · modelled estimate');
assert.equal(partial.components.reduce((s,c)=>s+c.value,0),partial.mid);
assert.equal(run({from:'poti',to:'constanta'}).kind,'model');assert.match(run({from:'poti',to:'constanta'}).warnings.join(' '),/Black Sea/);
assert.equal(run({from:'istanbul',to:'xian'}).kind,'model');assert.match(run({from:'istanbul',to:'xian'}).warnings.join(' '),/Eastbound/);
for(const cargo of ['reefer','dangerous','oversize'])assert.equal(run({cargo}).kind,'unavailable');
for(const weight of [0,-1,NaN,Infinity])assert.equal(run({weight}).kind,'invalid');
assert.equal(run({weight:25}).kind,'unavailable');assert.equal(run({container:'20GP'}).kind,'unavailable');
assert.equal(run({to:'xian'}).kind,'invalid');assert.equal(run({from:'unknown'}).kind,'invalid');
assert.equal(run({from:'aktau',to:'kuryk'}).kind,'unavailable');
for(const cargo of ['machinery','textiles','food','electronics']){const r=run({cargo});assert.equal(r.low,turkey.low);assert.equal(r.high,turkey.high);}
const freshPeriod='2090-01'; // Controlled future test date makes this independent of later dataset refreshes.
const live={status:'live',review_required:false,market:{turkey_assessment:{period:freshPeriod,low_usd:10000,high_usd:11000,container:'40HC',source_url:'https://example.com/new'}}};
assert.equal(run({},live).low,10000);
const modelBefore=run({from:'tbilisi',to:'istanbul'});const modelAfter=run({from:'tbilisi',to:'istanbul'},live);assert.notEqual(modelAfter.mid,modelBefore.mid);
assert.equal(run({}, {...live,review_required:true}).low,turkey.low);
assert.equal(run({}, {...live,status:'offline'}).low,turkey.low);
assert.equal(run({}, {...live,market:{turkey_assessment:{...live.market.turkey_assessment,period:'2000-01'}}}).low,turkey.low);
assert.equal(run({}, {...live,market:{turkey_assessment:{...live.market.turkey_assessment,container:'20GP'}}}).low,turkey.low);
assert.equal(run({}, {...live,market:{turkey_assessment:{...live.market.turkey_assessment,low_usd:0}}}).low,turkey.low);
const missing=structuredClone(data);missing.historical_observations=[];missing.headline={};missing.structural_benchmarks.market_defaults={};
assert.equal(run({from:'tbilisi',to:'istanbul'},null,missing).kind,'unavailable');
const before=JSON.stringify(data);let pairs=0,models=0;
for(const a of engine.nodes)for(const b of engine.nodes){if(a.id===b.id)continue;
 const r=run({from:a.id,to:b.id});pairs++;
 if(['assessment','model'].includes(r.kind)){
   assert(Number.isFinite(r.low)&&r.low>0&&r.high>=r.low);assert.equal(r.route[0].id,a.id);assert.equal(r.route.at(-1).id,b.id);
   assert.equal(new Set(r.route.map(n=>n.id)).size,r.route.length);
   if(r.kind==='model'){models++;assert.equal(r.components.reduce((s,c)=>s+c.value,0),r.mid);}
 }
}
assert.equal(JSON.stringify(data),before,'Estimator must not alter the MCFI dataset');
assert(run({from:'aktau',to:'tbilisi'},null,data,new Date('2027-01-01')).high>=partial.high);
console.log(`PASS: ${pairs} ordered city pairs, ${models} modelled routes; exact ranges, cargo guards, live refresh, stale/review fallback and index isolation.`);
