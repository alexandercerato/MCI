const fmtUSD = n => Number.isFinite(Number(n)) ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n)) : '—';
const fmtMonth = p => { if(!p) return '—'; const [y,m] = String(p).split('-'); if(!m) return p; return new Date(Number(y),Number(m)-1,1).toLocaleDateString('en-GB',{month:'short',year:'numeric'}); };
let DATA;
let PRICING_LIVE=null;

async function loadData(){
  const res=await fetch(`data.json?t=${Date.now()}`,{cache:'no-store'});
  DATA=await res.json();
  render();
  refreshStatus.textContent=`Market database loaded · ${new Date().toLocaleString('en-GB')} · online sources checked every ${DATA.meta.refresh_minutes} minutes`;
}

function render(){
  const h=DATA.headline;
  asOfDate.textContent=new Date(DATA.meta.as_of+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});

  const ref=Number(DATA.model.theoretical_reference_usd);
  if(DATA.model.index_status!=='live' || !Number.isFinite(ref) || ref<=0){
    mcfiValue.textContent='—';
    if(window.mcfiUnit) mcfiUnit.textContent='Fundamental model unavailable';
    mcfiMeta.textContent=`Latest observed market ${fmtUSD(h.latest_mcfi_core.value_usd)} / 40HC · ${fmtMonth(h.latest_mcfi_core.period)}`;
  }else{
    const currentIndex=Number(h.latest_mcfi_core.value_usd/ref*100);
    mcfiValue.textContent=currentIndex.toFixed(1);
    if(window.mcfiUnit) mcfiUnit.textContent='Index points · fundamental cost = 100';
    mcfiMeta.textContent=`${fmtMonth(h.latest_mcfi_core.period)} · Market ${fmtUSD(h.latest_mcfi_core.value_usd)} · Fundamental ${fmtUSD(ref)} · ${(currentIndex-100)>=0?'+':''}${(currentIndex-100).toFixed(1)}% premium`;
  }

  bakuValue.textContent=fmtUSD(h.latest_baku_market.value_usd);
  bakuMeta.textContent=`${fmtMonth(h.latest_baku_market.period)} · ${h.latest_baku_market.range}`;
  turkeyValue.textContent=fmtUSD(h.latest_turkey_market.value_usd);
  turkeyMeta.textContent=`${fmtMonth(h.latest_turkey_market.period)} · ${h.latest_turkey_market.range}`;
  providerValue.textContent=fmtUSD(h.latest_provider_snapshot.value_usd);
  providerMeta.textContent=`${fmtMonth(h.latest_provider_snapshot.period)} · ${h.latest_provider_snapshot.route}`;

  const structural=DATA.structural_benchmarks;
  const east=structural.segments.find(x=>x.id==='dostyk_aktau');
  const caspian=structural.segments.find(x=>x.id==='kuryk_alat');
  mapEastPrice.textContent=fmtUSD(east?.value_usd);
  mapCaspianPrice.textContent=fmtUSD(caspian?.value_usd);
  mapBakuPrice.textContent=fmtUSD(h.latest_baku_market.value_usd);

  const s=DATA.model.shipment;
  modelSpecs.innerHTML=[
    ['Container',s.container],['Cargo',s.cargo],['Direction',s.direction],['Origin',s.origin],['Core path',s.core_path]
  ].map(([a,b])=>`<div class="spec"><span>${a}</span><strong>${b}</strong></div>`).join('');
  formulaText.textContent=DATA.model.index_formula;
  methodologyLink.href=DATA.model.methodology_source;

  aktauKpis.innerHTML=`
    <div class="inline-kpi"><span>Port capacity</span><strong>${DATA.aktau.capacity_mtpa} Mt/y</strong><small>Aktau (Kazakhstan)</small></div>
    <div class="inline-kpi"><span>Container hub</span><strong>${DATA.aktau.container_hub_teu.toLocaleString()} TEU/y</strong><small>Annual capacity</small></div>
    <div class="inline-kpi"><span>Verified KZ rail benchmark</span><strong>${fmtUSD(east?.value_usd)}</strong><small>Dostyk → Aktau · 40' loaded</small></div>`;

  yearKpis.innerHTML=DATA.year_summary.map(x=>`
    <div class="inline-kpi"><span>${x.year}</span><strong>${fmtUSD(x.average_usd)}</strong><small>${x.complete_months} observed months · range ${fmtUSD(x.low_usd)}–${fmtUSD(x.high_usd)}</small></div>`).join('');

  renderStructural(PRICING_LIVE);
  buildYearFilters();
  renderMcfiTable();
  renderMcfiChart();
  renderHistoryTable();

  gapsTable.innerHTML=DATA.coverage_gaps.map(x=>`<tr><td>${x.period}</td><td>${coverageLabel(x)}</td></tr>`).join('');

  const mm=DATA.external_benchmarks.maxmodal_msri_middle_20ft||[];
  maxmodalTable.innerHTML=mm.length?mm.map(x=>`<tr><td>${fmtMonth(x.period)}</td><td class="price">${fmtUSD(x.value_usd)}</td></tr>`).join(''):'<tr><td colspan="2">—</td></tr>';
  externalNote.textContent='External corridor reference series with a different container and route methodology.';
}

function renderStructural(live){
  const sb=DATA.structural_benchmarks;
  const segments=sb.segments;
  const get=id=>segments.find(x=>x.id===id)||{};
  const east=get('dostyk_aktau');
  const xianAktau=get('xian_aktau');
  const casp=get('kuryk_alat');
  const aktauBaku=get('aktau_baku');

  const liveEast=live?.structural?.dostyk_aktau || east;
  const liveCasp=live?.structural?.kuryk_alat || casp;
  eastBenchmark.textContent=fmtUSD(liveEast.value_usd);
  eastBenchmarkMeta.textContent=`40' loaded · ${east.distance_km.toLocaleString()} km · ${east.delivery_hours} h · official tariff`;
  xianAktauBenchmark.textContent=xianAktau.value_usd?fmtUSD(xianAktau.value_usd):'N/A';
  xianAktauMeta.textContent=xianAktau.note;
  caspianBenchmark.textContent=fmtUSD(liveCasp.value_usd);
  caspianBenchmarkMeta.textContent=`40' container · loading/discharging excluded`;
  aktauBakuBenchmark.textContent=aktauBaku.value_usd?fmtUSD(aktauBaku.value_usd):'N/A';
  aktauBakuMeta.textContent=aktauBaku.note;

  corridorBenchmarks.innerHTML=sb.integrated_official_reference.routes.map(r=>`<article class="structural-card compact-card">
    <span class="structural-route">${escapeHTML(r.route)}</span>
    <strong>${fmtUSD(r.value_usd)}</strong>
    <small>${escapeHTML(r.container)} · ${r.distance_km.toLocaleString()} km · ${r.delivery_days} days · ${escapeHTML(sb.integrated_official_reference.effective_period)}</small>
  </article>`).join('');

  const assessment=live?.market?.assessment || sb.market_defaults.latest_comparable_assessment;
  const quotes=live?.market?.provider_quotes?.length ? live.market.provider_quotes : sb.market_defaults.provider_quotes;
  const marketCards=[
    {route:assessment.route, value:`${fmtUSD(assessment.low_usd)}–${fmtUSD(assessment.high_usd)}`, meta:`${fmtMonth(assessment.period)} · midpoint ${fmtUSD(assessment.midpoint_usd)} · market assessment`, url:assessment.source_url},
    ...quotes.map(q=>({route:q.route,value:`${q.price_floor?'from ':''}${fmtUSD(q.value_usd)}`,meta:`${q.container} · provider quote`,url:q.source_url}))
  ];
  livePricingCards.innerHTML=marketCards.slice(0,4).map(x=>`<article class="structural-card compact-card">
    <span class="structural-route">${escapeHTML(x.route)}</span>
    <strong>${x.value}</strong>
    <small>${escapeHTML(x.meta)}</small>
    ${x.url?`<a class="source-link" href="${x.url}" target="_blank" rel="noopener">Source ↗</a>`:''}
  </article>`).join('');

  if(live){
    pricingWatchStatus.textContent=live.status==='live'?'SOURCE WATCH LIVE':'SOURCE WATCH';
    pricingWatchStatus.className=live.review_required?'review':'live';
    pricingLastChecked.textContent=live.checked_at?`Checked ${formatAge(live.checked_at)}`:'—';
    if(live.review_required) pricingLastChecked.textContent='Source changed · review required';
  }else{
    pricingWatchStatus.textContent='SOURCE WATCH';
    pricingLastChecked.textContent='Waiting for backend';
  }
}

function coverageLabel(x){
  if(x.period==='2025-07') return 'Baku assessment available';
  if(x.period==='2026-08') return 'Provider rates available';
  if(x.period==='2026-09') return 'No new comparable monthly assessment published in database';
  return 'Partial historical coverage';
}

function buildYearFilters(){
  const years=[...new Set(DATA.historical_observations.map(x=>x.period.slice(0,4)))].sort();
  if(yearFilter.options.length===0) yearFilter.innerHTML='<option value="all">All years</option>'+years.map(y=>`<option>${y}</option>`).join('');
  const my=[...new Set(DATA.mcfi_monthly.map(x=>x.period.slice(0,4)))].sort();
  if(mcfiYearFilter.options.length===0) mcfiYearFilter.innerHTML='<option value="all">All years</option>'+my.map(y=>`<option>${y}</option>`).join('');
}

function renderMcfiTable(){
  const y=mcfiYearFilter.value||'all';
  const rows=DATA.mcfi_monthly.filter(x=>y==='all'||x.period.startsWith(y)).slice().reverse();
  mcfiTable.innerHTML=rows.map(x=>`<tr>
    <td>${fmtMonth(x.period)}</td>
    <td>${fmtUSD(x.mcfi_usd)}</td>
    <td>${fmtUSD(x.baku_midpoint_usd)}</td>
    <td>${fmtUSD(x.turkey_midpoint_usd)}</td>
    <td><a href="${x.source_url}" target="_blank" rel="noopener">View ↗</a></td>
  </tr>`).join('');
}

function monthKeyToDate(period){ const [y,m]=String(period).split('-').map(Number); return new Date(y,(m||1)-1,1); }
function monthDiff(a,b){ return (b.getFullYear()-a.getFullYear())*12 + (b.getMonth()-a.getMonth()); }
function svgEl(tag,attrs={},textValue=null){ const el=document.createElementNS('http://www.w3.org/2000/svg',tag); Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,String(v))); if(textValue!==null) el.textContent=textValue; return el; }

function renderMcfiChart(){
  if(!window.mcfiChart || !DATA?.mcfi_monthly?.length) return;
  const svg=mcfiChart; while(svg.firstChild) svg.removeChild(svg.firstChild);
  const W=1200,H=430,pad={l:86,r:30,t:34,b:54}; const plotW=W-pad.l-pad.r,plotH=H-pad.t-pad.b;
  const today=new Date(),start=new Date(2024,10,1),end=new Date(today.getFullYear(),today.getMonth(),1),totalMonths=Math.max(1,monthDiff(start,end));
  const rows=DATA.mcfi_monthly.filter(x=>x.period&&Number.isFinite(Number(x.mcfi_usd))).map(x=>({...x,value:Number(x.mcfi_usd),date:monthKeyToDate(x.period)})).filter(x=>x.date>=start&&x.date<=end).sort((a,b)=>a.date-b.date);
  if(!rows.length) return;
  const values=rows.map(x=>x.value),rawMin=Math.min(...values),rawMax=Math.max(...values); const step=500;
  const yMin=Math.floor((rawMin-250)/step)*step, yMax=Math.ceil((rawMax+250)/step)*step;
  const xOf=d=>pad.l+(monthDiff(start,d)/totalMonths)*plotW; const yOf=v=>pad.t+((yMax-v)/(yMax-yMin||1))*plotH;
  for(let v=yMin;v<=yMax;v+=step){ const y=yOf(v); svg.appendChild(svgEl('line',{x1:pad.l,y1:y,x2:W-pad.r,y2:y,class:'chart-grid'})); svg.appendChild(svgEl('text',{x:pad.l-12,y:y+4,'text-anchor':'end',class:'chart-axis-text'},`$${(v/1000).toFixed(v%1000?1:0)}k`)); }
  for(let y=start.getFullYear();y<=end.getFullYear();y++){ const yd=y===start.getFullYear()?start:new Date(y,0,1); if(yd>end) break; const x=xOf(yd); svg.appendChild(svgEl('line',{x1:x,y1:pad.t,x2:x,y2:H-pad.b,class:'chart-year-line'})); svg.appendChild(svgEl('text',{x:x+6,y:H-17,class:'chart-year-text'},String(y))); [0,3,6,9].forEach(m=>{const d=new Date(y,m,1); if(d>=start&&d<=end) svg.appendChild(svgEl('text',{x:xOf(d),y:H-38,'text-anchor':'middle',class:'chart-axis-text'},d.toLocaleDateString('en-GB',{month:'short'})));}); }
  for(let i=1;i<rows.length;i++){ const a=rows[i-1],b=rows[i],cls=monthDiff(a.date,b.date)===1?'chart-path':'chart-gap'; svg.appendChild(svgEl('line',{x1:xOf(a.date),y1:yOf(a.value),x2:xOf(b.date),y2:yOf(b.value),class:cls})); }
  const currentX=xOf(end); svg.appendChild(svgEl('line',{x1:currentX,y1:pad.t,x2:currentX,y2:H-pad.b,class:'chart-current-line'})); svg.appendChild(svgEl('text',{x:Math.min(W-pad.r-2,currentX-5),y:pad.t+11,'text-anchor':'end',class:'chart-current-label'},'CURRENT MONTH'));
  rows.forEach((r,i)=>{ const c=svgEl('circle',{cx:xOf(r.date),cy:yOf(r.value),r:i===rows.length-1?5.5:4.3,class:`chart-point${i===rows.length-1?' latest':''}`}); c.addEventListener('mouseenter',ev=>showChartTooltip(ev,r)); c.addEventListener('mousemove',moveChartTooltip); c.addEventListener('mouseleave',hideChartTooltip); svg.appendChild(c); });
  const latest=rows[rows.length-1],prev=rows.length>1?rows[rows.length-2]:null; const change=prev?((latest.value-prev.value)/prev.value)*100:null;
  chartSummary.innerHTML=`${fmtUSD(latest.value)} / 40HC<small>${fmtMonth(latest.period)}${change===null?'':` · ${change>=0?'+':''}${change.toFixed(1)}% vs previous observed month`}</small>`;
  if(window.chartYLabel) chartYLabel.textContent='USD / 40HC';
}
function showChartTooltip(ev,row){ if(!window.chartTooltip) return; chartTooltip.innerHTML=`<strong>${fmtUSD(row.mcfi_usd)} / 40HC</strong>${fmtMonth(row.period)}<span>Baku ${fmtUSD(row.baku_midpoint_usd)} · Türkiye ${fmtUSD(row.turkey_midpoint_usd)}</span><span>Observed market basket; no structural normalization applied</span>`; chartTooltip.hidden=false; moveChartTooltip(ev); }
function moveChartTooltip(ev){ if(!window.chartTooltip||chartTooltip.hidden)return; const box=chartTooltip.parentElement.getBoundingClientRect(); let left=ev.clientX-box.left+14,top=ev.clientY-box.top-18; left=Math.max(8,Math.min(box.width-chartTooltip.offsetWidth-8,left)); top=Math.max(8,Math.min(box.height-chartTooltip.offsetHeight-8,top)); chartTooltip.style.left=`${left}px`; chartTooltip.style.top=`${top}px`; }
function hideChartTooltip(){ if(window.chartTooltip) chartTooltip.hidden=true; }

function displayType(x){ if(x.primary_eligible)return'Market assessment'; if((x.evidence_type||'').includes('provider'))return'Provider tariff'; if((x.evidence_type||'').includes('fixed'))return'Published tariff'; return'Reference price'; }
function renderHistoryTable(){ const y=yearFilter.value||'all',e=eligibilityFilter.value||'all'; const rows=DATA.historical_observations.filter(x=>(y==='all'||x.period.startsWith(y))&&(e==='all'||(e==='primary'?x.primary_eligible:!x.primary_eligible))).slice().reverse(); historyTable.innerHTML=rows.map(x=>{ const price=x.low_usd===x.high_usd?fmtUSD(x.midpoint_usd):`${fmtUSD(x.low_usd)}–${fmtUSD(x.high_usd)}`; return `<tr><td>${x.period.length===7?fmtMonth(x.period):x.date}</td><td><b>${x.route}</b><br><small>${x.container} · ${x.ownership}</small></td><td class="price">${price}</td><td>${displayType(x)}</td><td><a href="${x.source_url}" target="_blank" rel="noopener">${x.source_name} ↗</a></td></tr>`; }).join(''); }

yearFilter?.addEventListener('change',renderHistoryTable);
eligibilityFilter?.addEventListener('change',renderHistoryTable);
mcfiYearFilter?.addEventListener('change',renderMcfiTable);

async function loadPricing(){
  const base=((window.MCFM_CONFIG||{}).aisApiBase||'').replace(/\/$/,'');
  if(!base){ renderStructural(null); return; }
  try{
    const res=await fetch(`${base}/api/pricing?t=${Date.now()}`,{cache:'no-store'});
    if(!res.ok) throw new Error(`Pricing HTTP ${res.status}`);
    PRICING_LIVE=await res.json();
    renderStructural(PRICING_LIVE);
    const a=PRICING_LIVE?.market?.assessment;
    if(a?.midpoint_usd){ bakuValue.textContent=fmtUSD(a.midpoint_usd); bakuMeta.textContent=`${fmtMonth(a.period)} · ${fmtUSD(a.low_usd)}–${fmtUSD(a.high_usd)}`; mapBakuPrice.textContent=fmtUSD(a.midpoint_usd); }
    const q=(PRICING_LIVE?.market?.provider_quotes||[]).find(x=>/Baku|Absheron/i.test(x.route||''));
    if(q?.value_usd){ providerValue.textContent=fmtUSD(q.value_usd); providerMeta.textContent=`${q.container||'40HQ'} · provider quote`; }
  }catch(err){
    console.warn(err);
    if(window.pricingWatchStatus) pricingWatchStatus.textContent='SOURCE WATCH OFFLINE';
  }
}

loadData().then(loadPricing).catch(err=>{refreshStatus.textContent='Market data unavailable'; console.error(err)});
setInterval(()=>loadData().catch(()=>{}),5*60*1000);
setInterval(()=>loadPricing().catch(()=>{}),5*60*1000);

// --- Caspian Live / AISStream proxy ---

const AIS_CFG = window.MCFM_CONFIG || {};
const AIS_REFRESH_MS = 30 * 1000;
let AIS_BOUNDS = { south: 39.0, west: 48.0, north: 45.2, east: 53.0 };

function setAisStatus(kind, label, updated){
  if(!window.aisStatus) return;
  aisStatus.className = `ais-status ${kind || 'offline'}`;
  aisStatus.textContent = label;
  aisUpdated.textContent = updated || '—';
}

function radarPosition(lat, lon){
  const x = ((lon - AIS_BOUNDS.west) / (AIS_BOUNDS.east - AIS_BOUNDS.west)) * 100;
  const y = ((AIS_BOUNDS.north - lat) / (AIS_BOUNDS.north - AIS_BOUNDS.south)) * 100;
  return {x: Math.max(0,Math.min(100,x)), y: Math.max(0,Math.min(100,y))};
}

function formatAge(iso){
  if(!iso) return '—';
  const sec=Math.max(0,Math.floor((Date.now()-new Date(iso).getTime())/1000));
  if(sec<60) return `${sec}s ago`;
  if(sec<3600) return `${Math.floor(sec/60)}m ago`;
  return `${Math.floor(sec/3600)}h ago`;
}

function renderAIS(data){
  const b=data?.bounds;
  if(b && [b.south,b.west,b.north,b.east].every(Number.isFinite) && b.north>b.south && b.east>b.west){
    AIS_BOUNDS={south:b.south,west:b.west,north:b.north,east:b.east};
  }
  const live=data?.status==='live';
  setAisStatus(live?'live':(data?.status==='connecting'?'connecting':'offline'), live?'LIVE':(data?.status==='connecting'?'CONNECTING':'OFFLINE'), data?.updated_at?`Updated ${formatAge(data.updated_at)}`:'—');
  aisProvider.textContent=data?.provider||'AISStream';
  const s=data?.summary||{};
  aisVessels.textContent=s.vessels_30m ?? '—';
  aisUnderway.textContent=s.underway ?? '—';
  aisEastPorts.textContent=((s.near_aktau||0)+(s.near_kuryk||0)) || (live?0:'—');
  aisWestPorts.textContent=((s.near_alat||0)+(s.near_baku||0)) || (live?0:'—');
  aisWestbound.textContent=s.westbound ?? '—';
  aisEastbound.textContent=s.eastbound ?? '—';

  const existing=[...aisRadar.querySelectorAll('.vessel-dot')]; existing.forEach(x=>x.remove());
  const vessels=(data?.vessels||[]).filter(v=>Number.isFinite(v.lat)&&Number.isFinite(v.lon));
  aisEmpty.style.display=vessels.length?'none':'flex';
  aisEmpty.textContent=live?'No recent AIS positions in the selected sector.':'Connect the AIS backend to start receiving live positions.';
  vessels.forEach(v=>{
    const p=radarPosition(v.lat,v.lon), dot=document.createElement('div');
    dot.className='vessel-dot'+((v.sog||0)<1.5?' stationary':'')+(v.corridor_candidate?' corridor':'');
    dot.style.left=`${p.x}%`; dot.style.top=`${p.y}%`;
    dot.dataset.label=`${v.name||v.mmsi} · ${(v.sog||0).toFixed(1)} kn`;
    aisRadar.appendChild(dot);
  });

  vesselList.innerHTML=vessels.length?vessels.slice(0,18).map(v=>`<div class="vessel-row">
    <div><div class="vessel-name">${escapeHTML(v.name||`MMSI ${v.mmsi}`)}</div><div class="vessel-meta"><span>${escapeHTML(v.direction||'AIS')}</span>${v.zone?`<span>${escapeHTML(v.zone)}</span>`:''}${v.destination?`<span>${escapeHTML(v.destination)}</span>`:''}</div></div>
    <div class="vessel-speed">${Number(v.sog||0).toFixed(1)} kn<span class="vessel-time">${formatAge(v.last_seen)}</span></div>
  </div>`).join(''):'<div class="vessel-empty">No recent vessels in the live window.</div>';

  const c=data?.crossings||{};
  aisCrossings.textContent=`Crossings recorded: ${c.count ?? '—'}`;
  aisMedian.textContent=`Median crossing time: ${Number.isFinite(c.median_hours)?`${c.median_hours.toFixed(1)} h`:'—'}`;
  aisTrackerSince.textContent=`Tracker since: ${data?.tracker_since?new Date(data.tracker_since).toLocaleDateString('en-GB'):'—'}`;
}

function escapeHTML(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

async function loadAIS(){
  const base=(AIS_CFG.aisApiBase||'').replace(/\/$/,'');
  if(!base){ renderAIS({status:'offline',provider:'AISStream',vessels:[]}); return; }
  try{
    const res=await fetch(`${base}/api/caspian`,{cache:'no-store'});
    if(!res.ok) throw new Error(`AIS HTTP ${res.status}`);
    renderAIS(await res.json());
  }catch(err){
    renderAIS({status:'offline',provider:'AISStream',vessels:[]});
    aisEmpty.textContent='AIS backend unavailable.';
    console.warn(err);
  }
}

loadAIS();
setInterval(loadAIS,AIS_REFRESH_MS);
