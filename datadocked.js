import './caspian-data.js';
import fs from 'node:fs';
import path from 'node:path';
const {areas,normalizeDataDocked,mergePosition}=globalThis.MCI_CASPIAN_DATA;
const BASE='https://datadocked.com/api/vessels_operations/';

// Fail closed if the ledger is missing/corrupt. Keep it on persistent storage:
// restarting or redeploying must not replenish the configured daily allowance.
export function createFileBudget(file,limit,clock=Date.now){
  return {reserve(cost){
    if(!file||!Number.isSafeInteger(limit)||limit<=0)throw new Error('budget_not_configured');
    if(!Number.isSafeInteger(cost)||cost<=0)throw new Error('budget_invalid');
    let saved;
    try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('budget_setup_required');}
    const today=new Date(clock()).toISOString().slice(0,10);
    const savedDay=Date.parse(saved.date+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(saved.date||'')||!Number.isFinite(savedDay)||new Date(savedDay).toISOString().slice(0,10)!==saved.date||saved.date>today||!Number.isSafeInteger(saved.spent)||saved.spent<0)throw new Error('budget_invalid');
    const spent=saved.date===today?saved.spent:0;
    if(spent+cost>limit)throw new Error('budget_exhausted');
    const tmp=file+'.tmp';
    try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(tmp,JSON.stringify({date:today,spent:spent+cost}),{mode:0o600});fs.renameSync(tmp,file);}catch{throw new Error('budget_write_failed');}
  }};
}

export function createDataDockedProvider({apiKey='',enabled=false,publicDisplayAllowed=false,budget,
  refreshMs=3600000,maxLocationLookups=5,fetchImpl=fetch,clock=Date.now}={}){
  const interval=Math.max(3600000,Number(refreshMs)||3600000);
  const lookupLimit=Math.floor(Math.max(0,Math.min(25,Number(maxLocationLookups)||0)));
  const rows=new Map();
  let status=!enabled?'disabled':!publicDisplayAllowed?'awaiting_licence':!apiKey?'key_missing':'ready';
  let pending=null,nextAllowed=0,lastChecked=null,lastSuccess=null,lookupCursor=0,areaStatus=[];
  const permitted=enabled&&publicDisplayAllowed&&Boolean(apiKey);
  async function request(endpoint,params,cost){
    budget?.reserve(cost);
    if(!budget)throw new Error('budget_not_configured');
    const url=new URL(endpoint,BASE);
    for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
    let response;
    try{response=await fetchImpl(url.href,{headers:{accept:'application/json','x-api-key':apiKey},signal:AbortSignal.timeout(20000),redirect:'error'});}catch{throw new Error('network_error');}
    if(!response.ok){
      if(response.status===401||response.status===403){nextAllowed=Infinity;throw new Error('authentication_failed');}
      if(response.status===429){
        const retry=Number(response.headers?.get('retry-after'));
        nextAllowed=Math.max(nextAllowed,clock()+Math.max(60,Math.min(3600,retry||300))*1000);
        throw new Error('rate_limited');
      }
      throw new Error('provider_http_'+response.status);
    }
    let body;try{body=await response.json();}catch{throw new Error('invalid_response');}
    if(!body||body.error)throw new Error('invalid_response');
    return body;
  }
  function add(row){if(row)rows.set(row.mmsi,mergePosition(rows.get(row.mmsi),row));}
  async function cycle(){
    lastChecked=new Date(clock()).toISOString();nextAllowed=clock()+interval;
    const scans=[];let completed=0,error=null;
    for(const area of areas){
      try{
        const data=await request('get-vessels-by-area',{latitude:area.lat.toFixed(1),longitude:area.lon.toFixed(1),circle_radius:area.radiusKm},10);
        const list=data.vessels??data.detail?.vessels;
        if(!Array.isArray(list))throw new Error('invalid_response');
        const fetched=new Date(clock()).toISOString();
        for(const row of list)add(normalizeDataDocked(row,{kind:'area',observedAt:fetched,now:clock()}));
        scans.push({...area,fetched_at:fetched,returned_vessels:list.length});completed++;
      }catch(e){error=e.message;scans.push({...area,error});break;}
    }
    areaStatus=scans;
    // Discover near the gateways, then track known MMSIs wherever they move in
    // the Caspian. Single-vessel lookups supply the actual AIS timestamp and,
    // when the account permits it, satellite positions. No bulk/satellite claim.
    const candidates=[...rows.values()].filter(r=>clock()-Date.parse(r.observed_at)<24*3600000);
    if(!error&&candidates.length){
      const count=Math.min(lookupLimit,candidates.length);
      for(let i=0;i<count;i++){
        const row=candidates[(lookupCursor+i)%candidates.length];
        try{
          const data=await request('get-vessel-location',{imo_or_mmsi:row.mmsi},1);
          const location=normalizeDataDocked(data.detail||data,{kind:'location',expectedMmsi:row.mmsi,observedAt:new Date(clock()).toISOString(),now:clock()});
          if(!location)throw new Error('invalid_position');
          add(location);
        }catch(e){error=e.message;break;}
      }
      lookupCursor=(lookupCursor+count)%candidates.length;
    }
    for(const [id,row] of rows)if(clock()-Date.parse(row.observed_at)>24*3600000)rows.delete(id);
    if(completed)lastSuccess=new Date(clock()).toISOString();
    status=error||'connected';
    return snapshot();
  }
  function refresh(){
    if(pending)return pending;
    if(!permitted||clock()<nextAllowed)return Promise.resolve(snapshot());
    pending=cycle().finally(()=>{pending=null;});return pending;
  }
  function snapshot(){return {status,last_checked_at:lastChecked,last_success_at:lastSuccess,
    areas:permitted?areaStatus:[],vessels:permitted?[...rows.values()]:[],
    scope:'Gateway discovery areas; known-vessel tracking across the Caspian. Not a census of the entire sea.'};}
  return {refresh,snapshot};
}
