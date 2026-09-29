const fmtUSD = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
const fmtIndex = n => Number(n).toFixed(1);
const fmtMonth = p => { const [y,m] = p.split('-'); if(!m) return p; return new Date(Number(y),Number(m)-1,1).toLocaleDateString('en-GB',{month:'short',year:'numeric'}); };
let DATA;

async function loadData(){
  const res=await fetch(`data.json?t=${Date.now()}`,{cache:'no-store'});
  DATA=await res.json();
  render();
  refreshStatus.textContent=`Market data loaded · ${new Date().toLocaleString('en-GB')} · refresh every ${DATA.meta.refresh_minutes} minutes`;
}

function render(){
  const h=DATA.headline;
  asOfDate.textContent=new Date(DATA.meta.as_of+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  const ref=Number(DATA.model.theoretical_reference_usd || h.latest_mcfi_core.theoretical_reference_usd || 6500);
  const currentIndex=Number(h.latest_mcfi_core.value_index ?? (h.latest_mcfi_core.value_usd/ref*100));
  const premium=Number(h.latest_mcfi_core.premium_vs_model_pct ?? (currentIndex-100));
  mcfiValue.textContent=fmtIndex(currentIndex);
  mcfiMeta.textContent=`${fmtMonth(h.latest_mcfi_core.period)} · Market ${fmtUSD(h.latest_mcfi_core.value_usd)} · Model ${fmtUSD(ref)} · ${premium>=0?'+':''}${premium.toFixed(1)}%`;
  bakuValue.textContent=fmtUSD(h.latest_baku_market.value_usd);
  bakuMeta.textContent=`${fmtMonth(h.latest_baku_market.period)} · ${h.latest_baku_market.range}`;
  turkeyValue.textContent=fmtUSD(h.latest_turkey_market.value_usd);
  turkeyMeta.textContent=`${fmtMonth(h.latest_turkey_market.period)} · ${h.latest_turkey_market.range}`;
  providerValue.textContent=fmtUSD(h.latest_provider_snapshot.value_usd);
  providerMeta.textContent=`${fmtMonth(h.latest_provider_snapshot.period)} · ${h.latest_provider_snapshot.route}`;

  mapAktauCapacity.textContent=`${DATA.aktau.capacity_mtpa} Mt/y`;
  mapBakuPrice.textContent=fmtUSD(h.latest_baku_market.value_usd);
  mapTurkeyPrice.textContent=fmtUSD(h.latest_turkey_market.value_usd);

  const s=DATA.model.shipment;
  modelSpecs.innerHTML=[
    ['Container',s.container],['Cargo',s.cargo],['Direction',s.direction],['Origin',s.origin],['Core path',s.core_path]
  ].map(([a,b])=>`<div class="spec"><span>${a}</span><strong>${b}</strong></div>`).join('');
  formulaText.textContent=DATA.model.index_formula || `Market cost ÷ ${fmtUSD(ref)} × 100`;
  methodologyLink.href=DATA.model.methodology_source;

  aktauKpis.innerHTML=`
    <div class="inline-kpi"><span>Port capacity</span><strong>${DATA.aktau.capacity_mtpa} Mt/y</strong><small>Aktau</small></div>
    <div class="inline-kpi"><span>Container hub</span><strong>${DATA.aktau.container_hub_teu.toLocaleString()} TEU/y</strong><small>Annual capacity</small></div>
    <div class="inline-kpi"><span>40' handling reference</span><strong>${fmtUSD(DATA.aktau.historical_2024_proposed_handling_40ft_usd)}</strong><small>2024 published proposal</small></div>`;

  yearKpis.innerHTML=DATA.year_summary.map(x=>`
    <div class="inline-kpi"><span>${x.year}</span><strong>${fmtIndex(x.average_index ?? (x.average_usd/ref*100))}</strong><small>${x.complete_months} priced months · avg market ${fmtUSD(x.average_usd)} · index ${fmtIndex(x.low_index ?? (x.low_usd/ref*100))}–${fmtIndex(x.high_index ?? (x.high_usd/ref*100))}</small></div>`).join('');

  buildYearFilters();
  renderMcfiTable();
  renderMcfiChart();
  renderHistoryTable();

  gapsTable.innerHTML=DATA.coverage_gaps.map(x=>`<tr><td>${x.period}</td><td>${coverageLabel(x)}</td></tr>`).join('');

  const mm=DATA.external_benchmarks.maxmodal_msri_middle_20ft||[];
  maxmodalTable.innerHTML=mm.length?mm.map(x=>`<tr><td>${fmtMonth(x.period)}</td><td class="price">${fmtUSD(x.value_usd)}</td></tr>`).join(''):'<tr><td colspan="2">—</td></tr>';
  externalNote.textContent='External corridor reference series with a different container and route methodology.';
}

function coverageLabel(x){
  if(x.period==='2025-07') return 'Baku assessment available';
  if(x.period==='2026-08') return 'Provider rates available';
  if(x.period==='2026-09') return 'Awaiting monthly assessment';
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
  const ref=Number(DATA.model.theoretical_reference_usd || 6500);
  mcfiTable.innerHTML=rows.map(x=>`<tr>
    <td>${fmtMonth(x.period)}</td>
    <td>${fmtIndex(x.mcfi_index ?? (x.mcfi_usd/ref*100))}</td>
    <td>${fmtUSD(x.mcfi_usd)}</td>
    <td>${fmtUSD(x.baku_midpoint_usd)}</td>
    <td>${fmtUSD(x.turkey_midpoint_usd)}</td>
    <td><a href="${x.source_url}" target="_blank" rel="noopener">View ↗</a></td>
  </tr>`).join('');
}


function monthKeyToDate(period){
  const [y,m]=String(period).split('-').map(Number);
  return new Date(y,(m||1)-1,1);
}
function monthKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function monthDiff(a,b){ return (b.getFullYear()-a.getFullYear())*12 + (b.getMonth()-a.getMonth()); }
function svgEl(tag,attrs={},textValue=null){
  const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,String(v)));
  if(textValue!==null) el.textContent=textValue;
  return el;
}
function renderMcfiChart(){
  if(!window.mcfiChart || !DATA?.mcfi_monthly?.length) return;
  const svg=mcfiChart;
  while(svg.firstChild) svg.removeChild(svg.firstChild);

  const W=1200,H=430, pad={l:72,r:30,t:34,b:54};
  const plotW=W-pad.l-pad.r, plotH=H-pad.t-pad.b;
  const today=new Date();
  const start=new Date(2024,0,1);
  const end=new Date(today.getFullYear(),today.getMonth(),1);
  const totalMonths=Math.max(1,monthDiff(start,end));
  const ref=Number(DATA.model.theoretical_reference_usd || 6500);
  const rows=DATA.mcfi_monthly
    .filter(x=>x.period && Number.isFinite(Number(x.mcfi_usd)))
    .map(x=>({...x,mcfi_index:Number(x.mcfi_index ?? (x.mcfi_usd/ref*100)),date:monthKeyToDate(x.period)}))
    .filter(x=>x.date>=start && x.date<=end)
    .sort((a,b)=>a.date-b.date);
  if(!rows.length) return;

  const values=rows.map(x=>Number(x.mcfi_index));
  const rawMin=Math.min(...values,100), rawMax=Math.max(...values,100);
  const step=5;
  const yMin=Math.floor((rawMin-2.5)/step)*step;
  const yMax=Math.ceil((rawMax+2.5)/step)*step;
  const xOf=d=>pad.l+(monthDiff(start,d)/totalMonths)*plotW;
  const yOf=v=>pad.t+((yMax-v)/(yMax-yMin||1))*plotH;

  for(let v=yMin;v<=yMax;v+=step){
    const y=yOf(v);
    svg.appendChild(svgEl('line',{x1:pad.l,y1:y,x2:W-pad.r,y2:y,class:'chart-grid'}));
    svg.appendChild(svgEl('text',{x:pad.l-12,y:y+4,'text-anchor':'end',class:'chart-axis-text'},v.toFixed(0)));
  }

  if(yMin<=100 && yMax>=100){
    const y=yOf(100);
    svg.appendChild(svgEl('line',{x1:pad.l,y1:y,x2:W-pad.r,y2:y,class:'chart-baseline-line'}));
    svg.appendChild(svgEl('text',{x:W-pad.r-4,y:y-7,'text-anchor':'end',class:'chart-baseline-label'},'MODEL = 100'));
  }

  for(let y=2024;y<=end.getFullYear();y++){
    const yd=new Date(y,0,1); if(yd>end) break;
    const x=xOf(yd);
    svg.appendChild(svgEl('line',{x1:x,y1:pad.t,x2:x,y2:H-pad.b,class:'chart-year-line'}));
    svg.appendChild(svgEl('text',{x:x+6,y:H-17,class:'chart-year-text'},String(y)));
    [3,6,9].forEach(m=>{
      const d=new Date(y,m,1); if(d<=end){
        svg.appendChild(svgEl('text',{x:xOf(d),y:H-38,'text-anchor':'middle',class:'chart-axis-text'},d.toLocaleDateString('en-GB',{month:'short'})));
      }
    });
  }

  for(let i=1;i<rows.length;i++){
    const a=rows[i-1], b=rows[i];
    const cls=monthDiff(a.date,b.date)===1?'chart-path':'chart-gap';
    svg.appendChild(svgEl('line',{x1:xOf(a.date),y1:yOf(a.mcfi_index),x2:xOf(b.date),y2:yOf(b.mcfi_index),class:cls}));
  }

  const currentX=xOf(end);
  svg.appendChild(svgEl('line',{x1:currentX,y1:pad.t,x2:currentX,y2:H-pad.b,class:'chart-current-line'}));
  svg.appendChild(svgEl('text',{x:Math.min(W-pad.r-2,currentX-5),y:pad.t+11,'text-anchor':'end',class:'chart-current-label'},'CURRENT MONTH'));

  rows.forEach((r,i)=>{
    const c=svgEl('circle',{cx:xOf(r.date),cy:yOf(r.mcfi_index),r:i===rows.length-1?5.5:4.3,class:`chart-point${i===rows.length-1?' latest':''}`});
    c.dataset.period=r.period; c.dataset.value=r.mcfi_index;
    c.addEventListener('mouseenter',ev=>showChartTooltip(ev,r));
    c.addEventListener('mousemove',ev=>moveChartTooltip(ev));
    c.addEventListener('mouseleave',hideChartTooltip);
    svg.appendChild(c);
  });

  const latest=rows[rows.length-1], prev=rows.length>1?rows[rows.length-2]:null;
  const change=prev?((latest.mcfi_index-prev.mcfi_index)/prev.mcfi_index)*100:null;
  const premium=latest.mcfi_index-100;
  chartSummary.innerHTML=`MCFI ${fmtIndex(latest.mcfi_index)}<small>${fmtMonth(latest.period)} · ${fmtUSD(latest.mcfi_usd)} / 40HC · ${premium>=0?'+':''}${premium.toFixed(1)}% vs model${change===null?'':` · ${change>=0?'+':''}${change.toFixed(1)}% vs previous observed month`}</small>`;
}
function showChartTooltip(ev,row){
  if(!window.chartTooltip) return;
  const ref=Number(DATA.model.theoretical_reference_usd || 6500);
  const idx=Number(row.mcfi_index ?? (row.mcfi_usd/ref*100));
  const premium=idx-100;
  chartTooltip.innerHTML=`<strong>MCFI ${fmtIndex(idx)}</strong>${fmtMonth(row.period)}<span>Market ${fmtUSD(row.mcfi_usd)} · Model ${fmtUSD(ref)} · ${premium>=0?'+':''}${premium.toFixed(1)}%</span><span>Baku ${fmtUSD(row.baku_midpoint_usd)} · Turkey ${fmtUSD(row.turkey_midpoint_usd)}</span>`;
  chartTooltip.hidden=false; moveChartTooltip(ev);
}
function moveChartTooltip(ev){
  if(!window.chartTooltip || chartTooltip.hidden) return;
  const box=chartTooltip.parentElement.getBoundingClientRect();
  let left=ev.clientX-box.left+14, top=ev.clientY-box.top-18;
  const maxLeft=box.width-chartTooltip.offsetWidth-8;
  left=Math.max(8,Math.min(maxLeft,left));
  top=Math.max(8,Math.min(box.height-chartTooltip.offsetHeight-8,top));
  chartTooltip.style.left=`${left}px`; chartTooltip.style.top=`${top}px`;
}
function hideChartTooltip(){ if(window.chartTooltip) chartTooltip.hidden=true; }

function displayType(x){
  if(x.primary_eligible) return 'Market assessment';
  if((x.evidence_type||'').includes('provider')) return 'Provider tariff';
  if((x.evidence_type||'').includes('fixed')) return 'Published tariff';
  return 'Reference price';
}

function renderHistoryTable(){
  const y=yearFilter.value||'all', e=eligibilityFilter.value||'all';
  const rows=DATA.historical_observations.filter(x=>(y==='all'||x.period.startsWith(y))&&(e==='all'||(e==='primary'?x.primary_eligible:!x.primary_eligible))).slice().reverse();
  historyTable.innerHTML=rows.map(x=>{
    const price=x.low_usd===x.high_usd?fmtUSD(x.midpoint_usd):`${fmtUSD(x.low_usd)}–${fmtUSD(x.high_usd)}`;
    return `<tr>
      <td>${x.period.length===7?fmtMonth(x.period):x.date}</td>
      <td><b>${x.route}</b><br><small>${x.container} · ${x.ownership}</small></td>
      <td class="price">${price}</td>
      <td>${displayType(x)}</td>
      <td><a href="${x.source_url}" target="_blank" rel="noopener">${x.source_name} ↗</a></td>
    </tr>`;
  }).join('');
}

yearFilter?.addEventListener('change',renderHistoryTable);
eligibilityFilter?.addEventListener('change',renderHistoryTable);
mcfiYearFilter?.addEventListener('change',renderMcfiTable);
loadData().catch(err=>{refreshStatus.textContent='Market data unavailable'; console.error(err)});
setInterval(()=>loadData().catch(()=>{}),5*60*1000);

// --- Caspian Live / AISStream proxy ---
const AIS_CFG = window.MCFM_CONFIG || {};
const AIS_REFRESH_MS = 30 * 1000;
const AIS_BOUNDS = { south: 39.0, west: 48.0, north: 45.2, east: 53.0 };

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
