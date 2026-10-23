import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createDataDockedProvider,createFileBudget} from '../datadocked.js';
const now=Date.parse('2026-10-23T08:00:00Z');
const row={mmsi:'123456789',name:'Test vessel',latitude:'43.64',longitude:'51.17',speed:'81'};
const response=(body,status=200)=>({ok:status===200,status,headers:{get:()=>null},json:async()=>body});
function setup(overrides={}){
  let calls=[],spent=0;
  const config={apiKey:'fixture-key-not-a-credential',enabled:true,publicDisplayAllowed:true,clock:()=>now,
    budget:{reserve(cost){spent+=cost;}},maxLocationLookups:1,
    fetchImpl:async(url,options)=>{calls.push({url,options});return response(url.includes('get-vessel-location?')?{detail:{...row,speed:'8.1',positionReceived:'Oct 23, 2026 07:55 UTC'}}:{vessels:[row]});},...overrides};
  return {client:createDataDockedProvider(config),calls,spent:()=>spent};
}
test('default, disabled, unlicensed and keyless configurations make zero requests',async()=>{
  for(const overrides of [{enabled:false},{publicDisplayAllowed:false},{apiKey:''}]){
    const env=setup(overrides);await env.client.refresh();assert.equal(env.calls.length,0);assert.equal(env.spent(),0);
  }
  assert.equal((await createDataDockedProvider().refresh()).status,'disabled');
});
test('two gateway scans deduplicate vessels, then a timed lookup establishes recency',async()=>{
  const env=setup();const result=await env.client.refresh();
  assert.equal(env.calls.length,3);assert.equal(env.spent(),21);assert.equal(result.vessels.length,1);
  assert.equal(result.vessels[0].last_seen,'2026-10-23T07:55:00.000Z');assert.equal(result.vessels[0].sog,8.1);
  assert.ok(env.calls.every(c=>c.options.headers['x-api-key']==='fixture-key-not-a-credential'&&!c.url.includes('fixture-key')));
  assert.equal(result.status,'connected');assert.ok(!JSON.stringify(result).includes('fixture-key'));
});
test('polling is shared and repeated browser reads do not spend more credits',async()=>{
  const env=setup();await Promise.all([env.client.refresh(),env.client.refresh()]);
  for(let i=0;i<10;i++){env.client.snapshot();await env.client.refresh();}
  assert.equal(env.calls.length,3);
});
test('credit exhaustion stops before dispatch and leaves partial success dated',async()=>{
  let remaining=10;
  const env=setup({budget:{reserve(cost){if(cost>remaining)throw new Error('budget_exhausted');remaining-=cost;}}});
  const result=await env.client.refresh();assert.equal(env.calls.length,1);assert.equal(result.status,'budget_exhausted');
  assert.equal(result.areas.length,2);assert.ok(result.areas[0].fetched_at);assert.equal(result.areas[1].error,'budget_exhausted');
  assert.equal(result.vessels[0].last_seen,null);
});
test('authentication and rate-limit failures do not retry or leak provider content',async()=>{
  for(const code of [401,403,429]){
    let calls=0;const env=setup({fetchImpl:async()=>{calls++;return response({message:'fixture-key-not-a-credential'},code);}});
    const result=await env.client.refresh();await env.client.refresh();assert.equal(calls,1);
    assert.equal(result.status,code===429?'rate_limited':'authentication_failed');assert.ok(!JSON.stringify(result).includes('fixture-key'));
  }
});
test('network errors are sanitized and absent budgets cannot call the provider',async()=>{
  const env=setup({fetchImpl:async()=>{throw new Error('fixture-key-not-a-credential');}});
  assert.equal((await env.client.refresh()).status,'network_error');
  const none=setup({budget:null});assert.equal((await none.client.refresh()).status,'budget_not_configured');assert.equal(none.calls.length,0);
});
test('durable ledger survives restart, resets only on a new UTC day and rejects corruption',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mci-budget-')),file=path.join(directory,'ledger.json');
  try{
    assert.throws(()=>createFileBudget(file,20,()=>now).reserve(10),/budget_setup_required/);
    fs.writeFileSync(file,JSON.stringify({date:'2026-10-23',spent:0}));
    createFileBudget(file,20,()=>now).reserve(10);createFileBudget(file,20,()=>now).reserve(10);
    assert.throws(()=>createFileBudget(file,20,()=>now).reserve(1),/budget_exhausted/);
    createFileBudget(file,20,()=>now+86400000).reserve(10);assert.equal(JSON.parse(fs.readFileSync(file)).spent,10);
    fs.writeFileSync(file,JSON.stringify({date:'2026-02-31',spent:0}));
    assert.throws(()=>createFileBudget(file,20,()=>now).reserve(10),/budget_invalid/);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
