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
  if(window.mapEastPrice) mapEastPrice.textContent=fmtUSD(east?.value_usd);
  if(window.mapCaspianPrice) mapCaspianPrice.textContent=fmtUSD(caspian?.value_usd);
  if(window.mapBakuPrice) mapBakuPrice.textContent=fmtUSD(h.latest_baku_market.value_usd);

  const s=DATA.model.shipment;
  modelSpecs.innerHTML=[
    ['Container',s.container],['Cargo',s.cargo],['Direction',s.direction],['Origin',s.origin],['Core path',s.core_path]
  ].map(([a,b])=>`<div class="spec"><span>${a}</span><strong>${b}</strong></div>`).join('');
  formulaText.textContent=DATA.model.index_formula;

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
    <td class="price">${Number.isFinite(Number(x.mcfi_index))?Number(x.mcfi_index).toFixed(1):'—'}</td>
    <td>${fmtUSD(x.mcfi_usd)}</td>
    <td>${fmtUSD(x.fundamental_cost_usd)}</td>
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
  const W=1200,H=430,pad={l:70,r:30,t:34,b:54}; const plotW=W-pad.l-pad.r,plotH=H-pad.t-pad.b;
  const today=new Date(),start=new Date(2024,10,1),end=new Date(today.getFullYear(),today.getMonth(),1),totalMonths=Math.max(1,monthDiff(start,end));
  const rows=DATA.mcfi_monthly
    .filter(x=>x.period&&Number.isFinite(Number(x.mcfi_index)))
    .map(x=>({...x,value:Number(x.mcfi_index),date:monthKeyToDate(x.period)}))
    .filter(x=>x.date>=start&&x.date<=end).sort((a,b)=>a.date-b.date);
  if(!rows.length) return;
  const values=rows.map(x=>x.value),rawMin=Math.min(100,...values),rawMax=Math.max(100,...values),step=20;
  const yMin=Math.max(0,Math.floor((rawMin-10)/step)*step),yMax=Math.ceil((rawMax+10)/step)*step;
  const xOf=d=>pad.l+(monthDiff(start,d)/totalMonths)*plotW;
  const yOf=v=>pad.t+((yMax-v)/(yMax-yMin||1))*plotH;

  for(let v=yMin;v<=yMax;v+=step){
    const y=yOf(v);
    svg.appendChild(svgEl('line',{x1:pad.l,y1:y,x2:W-pad.r,y2:y,class:v===100?'chart-baseline-line':'chart-grid'}));
    svg.appendChild(svgEl('text',{x:pad.l-12,y:y+4,'text-anchor':'end',class:'chart-axis-text'},String(v)));
  }
  svg.appendChild(svgEl('text',{x:pad.l+8,y:yOf(100)-8,class:'chart-baseline-label'},'FUNDAMENTAL COST = 100'));

  for(let y=start.getFullYear();y<=end.getFullYear();y++){
    const yd=y===start.getFullYear()?start:new Date(y,0,1);
    if(yd>end) break;
    const x=xOf(yd);
    svg.appendChild(svgEl('line',{x1:x,y1:pad.t,x2:x,y2:H-pad.b,class:'chart-year-line'}));
    svg.appendChild(svgEl('text',{x:x+6,y:H-17,class:'chart-year-text'},String(y)));
    [0,3,6,9].forEach(m=>{
      const dd=new Date(y,m,1);
      if(dd>=start&&dd<=end) svg.appendChild(svgEl('text',{x:xOf(dd),y:H-38,'text-anchor':'middle',class:'chart-axis-text'},dd.toLocaleDateString('en-GB',{month:'short'})));
    });
  }

  for(let i=1;i<rows.length;i++){
    const a=rows[i-1],b=rows[i],cls=monthDiff(a.date,b.date)===1?'chart-path':'chart-gap';
    svg.appendChild(svgEl('line',{x1:xOf(a.date),y1:yOf(a.value),x2:xOf(b.date),y2:yOf(b.value),class:cls}));
  }

  const currentX=xOf(end);
  svg.appendChild(svgEl('line',{x1:currentX,y1:pad.t,x2:currentX,y2:H-pad.b,class:'chart-current-line'}));
  svg.appendChild(svgEl('text',{x:Math.min(W-pad.r-2,currentX-5),y:pad.t+11,'text-anchor':'end',class:'chart-current-label'},'CURRENT MONTH'));

  rows.forEach((r,i)=>{
    const c=svgEl('circle',{cx:xOf(r.date),cy:yOf(r.value),r:i===rows.length-1?5.5:4.3,class:`chart-point${i===rows.length-1?' latest':''}`});
    c.addEventListener('mouseenter',ev=>showChartTooltip(ev,r));
    c.addEventListener('mousemove',moveChartTooltip);
    c.addEventListener('mouseleave',hideChartTooltip);
    svg.appendChild(c);
  });

  const latest=rows[rows.length-1],prev=rows.length>1?rows[rows.length-2]:null;
  const change=prev?(latest.value-prev.value):null;
  chartSummary.innerHTML=`MCFI ${latest.value.toFixed(1)}<small>${fmtMonth(latest.period)} · fundamental ${fmtUSD(latest.fundamental_cost_usd)}${change===null?'':` · ${change>=0?'+':''}${change.toFixed(1)} pts`}</small>`;
  if(window.chartYLabel) chartYLabel.textContent='MCFI points';
}
function showChartTooltip(ev,row){
  if(!window.chartTooltip) return;
  const status=row.fundamental_anchor_status==='carry_forward'?'carry-forward anchor':'official-period anchor';
  chartTooltip.innerHTML=`<strong>MCFI ${Number(row.mcfi_index).toFixed(1)}</strong>${fmtMonth(row.period)}<span>Market ${fmtUSD(row.mcfi_usd)} · Fundamental ${fmtUSD(row.fundamental_cost_usd)}</span><span>${status}</span>`;
  chartTooltip.hidden=false;
  moveChartTooltip(ev);
}
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
    if(a?.midpoint_usd){ bakuValue.textContent=fmtUSD(a.midpoint_usd); bakuMeta.textContent=`${fmtMonth(a.period)} · ${fmtUSD(a.low_usd)}–${fmtUSD(a.high_usd)}`; if(window.mapBakuPrice) mapBakuPrice.textContent=fmtUSD(a.midpoint_usd); }
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

// --- Interactive Middle Corridor map ---

function initRouteMap(){
  if(!window.L || !document.getElementById('routeInteractiveMap')) return;

  const palette={
    china:'#35a7d8',
    kazakh:'#28b7d8',
    sea:'#f0a43c',
    west:'#48b57a',
    blackSea:'#8c74d8',
    branch:'#d5a45c',
    origin:'#4aa3ff',
    gateway:'#35c4c7',
    port:'#f0a43c',
    destination:'#56c58a',
    blackSeaNode:'#9b83e6',
    outline:'#081018'
  };

  const map=L.map('routeInteractiveMap',{
    scrollWheelZoom:false,
    zoomControl:true,
    preferCanvas:false,
    minZoom:2
  }).setView([43,61],3);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:12,
    attribution:'&copy; OpenStreetMap contributors'
  }).addTo(map);

  const N={
    xian:{name:"Xi'an",country:"China",lat:34.34,lon:108.94,role:"Eastern origin and consolidation hub",kind:"origin"},
    lanzhou:{name:"Lanzhou",country:"China",lat:36.06,lon:103.83,role:"North-west China rail corridor",kind:"rail"},
    urumqi:{name:"Ürümqi",country:"China",lat:43.82,lon:87.62,role:"Xinjiang rail hub",kind:"rail"},
    khorgos:{name:"Khorgos",country:"China",lat:44.21,lon:80.41,role:"China–Kazakhstan rail border",kind:"gateway"},
    altynkol:{name:"Altynkol",country:"Kazakhstan",lat:44.17,lon:80.29,role:"Kazakhstan border and gauge-transfer gateway",kind:"gateway"},
    aktogay:{name:"Aktogay",country:"Kazakhstan",lat:46.95,lon:79.67,role:"Major Kazakhstan rail junction",kind:"rail"},
    balkhash:{name:"Balkhash",country:"Kazakhstan",lat:46.85,lon:74.98,role:"Central Kazakhstan rail corridor",kind:"rail"},
    zhezkazgan:{name:"Zhezkazgan",country:"Kazakhstan",lat:47.78,lon:67.70,role:"Key link on the Zhezkazgan–Beineu westbound axis",kind:"rail"},
    saksaulsk:{name:"Saksaulsk",country:"Kazakhstan",lat:47.09,lon:61.16,role:"Western Kazakhstan rail junction",kind:"rail"},
    beineu:{name:"Beineu",country:"Kazakhstan",lat:45.32,lon:55.20,role:"Rail gateway toward the Caspian coast",kind:"gateway"},
    kuryk:{name:"Port of Kuryk",country:"Kazakhstan",lat:43.18,lon:51.66,role:"Principal Kazakhstan ferry gateway for the TITR",kind:"port"},
    aktau:{name:"Port of Aktau",country:"Kazakhstan",lat:43.65,lon:51.17,role:"Major commercial Caspian port and MCFI focus",kind:"port"},
    alat:{name:"Port of Baku (Alat)",country:"Azerbaijan",lat:39.95,lon:49.39,role:"Main Azerbaijan Caspian gateway",kind:"port"},
    ganja:{name:"Ganja",country:"Azerbaijan",lat:40.68,lon:46.36,role:"Westbound Azerbaijan rail corridor",kind:"rail"},
    boyuk:{name:"Boyuk-Kesik",country:"Azerbaijan",lat:41.31,lon:45.07,role:"Azerbaijan–Georgia rail border",kind:"gateway"},
    tbilisi:{name:"Tbilisi",country:"Georgia",lat:41.72,lon:44.79,role:"Major Georgian rail hub",kind:"gateway"},
    akhalkalaki:{name:"Akhalkalaki",country:"Georgia",lat:41.41,lon:43.49,role:"Baku–Tbilisi–Kars interface",kind:"gateway"},
    kars:{name:"Kars",country:"Türkiye",lat:40.61,lon:43.10,role:"Türkiye gateway on the BTK railway",kind:"gateway"},
    erzurum:{name:"Erzurum",country:"Türkiye",lat:39.90,lon:41.27,role:"Eastern Türkiye rail corridor",kind:"rail"},
    ankara:{name:"Ankara",country:"Türkiye",lat:39.93,lon:32.86,role:"Central Türkiye rail hub",kind:"rail"},
    istanbul:{name:"Istanbul",country:"Türkiye",lat:41.01,lon:28.97,role:"European gateway and principal western destination",kind:"destination"},
    poti:{name:"Poti",country:"Georgia",lat:42.15,lon:41.67,role:"Black Sea port branch",kind:"blackSeaNode"},
    constanta:{name:"Constanța",country:"Romania",lat:44.17,lon:28.65,role:"Black Sea European gateway",kind:"blackSeaNode"}
  };

  const layers={
    china:L.layerGroup().addTo(map),
    kazakhstan:L.layerGroup().addTo(map),
    aktau:L.layerGroup().addTo(map),
    caspian:L.layerGroup().addTo(map),
    west:L.layerGroup().addTo(map),
    blackSea:L.layerGroup().addTo(map),
    nodes:L.layerGroup().addTo(map)
  };

  const segment=(points,options,layer,title,detail)=>{
    const line=L.polyline(points.map(p=>[p.lat,p.lon]),{
      ...options,
      lineCap:'round',
      lineJoin:'round',
      interactive:true
    }).addTo(layer);

    line.bindTooltip(title,{sticky:true,className:'route-tooltip'});
    line.bindPopup(`<div class="route-popup"><span class="route-popup-type">Route segment</span><strong>${escapeHTML(title)}</strong><p>${escapeHTML(detail)}</p></div>`);
    const baseWeight=options.weight||4;
    line.on('mouseover',()=>line.setStyle({weight:baseWeight+3,opacity:1}));
    line.on('mouseout',()=>line.setStyle({weight:baseWeight,opacity:options.opacity??.9}));
    return line;
  };

  const china=[N.xian,N.lanzhou,N.urumqi,N.khorgos];
  const kazakhstan=[N.altynkol,N.aktogay,N.balkhash,N.zhezkazgan,N.saksaulsk,N.beineu,N.kuryk];
  const west=[N.alat,N.ganja,N.boyuk,N.tbilisi,N.akhalkalaki,N.kars,N.erzurum,N.ankara,N.istanbul];
  const blackSeaRail=[N.tbilisi,N.poti];

  segment(china,{color:palette.china,weight:5,opacity:.96,className:'route-path route-path-china'},layers.china,
    "China rail spine","Xi'an → Lanzhou → Ürümqi → Khorgos.");
  segment(kazakhstan,{color:palette.kazakh,weight:5,opacity:.96,className:'route-path route-path-kazakh'},layers.kazakhstan,
    "Kazakhstan rail spine","Altynkol → Aktogay → Balkhash → Zhezkazgan → Saksaulsk → Beineu → Kuryk.");
  segment([N.beineu,N.aktau],{color:palette.branch,weight:4,opacity:.9,dashArray:'7 7',className:'route-path route-path-branch'},layers.aktau,
    "Aktau branch","Beineu → Aktau commercial port branch.");
  segment([N.kuryk,{lat:42.55,lon:51.20},{lat:41.65,lon:50.60},{lat:40.75,lon:49.95},N.alat],
    {color:palette.sea,weight:6,opacity:.98,dashArray:'12 8',className:'route-path route-path-sea'},layers.caspian,
    "Caspian crossing","Kuryk → Port of Baku (Alat), the principal ferry crossing in the current TITR routing.");
  segment(west,{color:palette.west,weight:5,opacity:.92,className:'route-path route-path-west'},layers.west,
    "Türkiye continuation","Alat → Ganja → Boyuk-Kesik → Tbilisi → Akhalkalaki → Kars → Erzurum → Ankara → Istanbul.");
  segment(blackSeaRail,{color:palette.blackSea,weight:4,opacity:.9,dashArray:'8 7',className:'route-path route-path-blacksea'},layers.blackSea,
    "Black Sea rail branch","Tbilisi → Poti.");
  segment([N.poti,{lat:42.75,lon:37.0},{lat:43.55,lon:32.8},N.constanta],
    {color:palette.blackSea,weight:5,opacity:.85,dashArray:'5 10',className:'route-path route-path-blacksea-sea'},layers.blackSea,
    "Black Sea maritime branch","Poti → Constanța.");

  const markerColor=p=>{
    if(p.kind==='origin') return palette.origin;
    if(p.kind==='port') return palette.port;
    if(p.kind==='destination') return palette.destination;
    if(p.kind==='blackSeaNode') return palette.blackSeaNode;
    if(p.kind==='gateway') return palette.gateway;
    return '#8fa7bb';
  };

  const visibleNodes=[
    N.xian,N.lanzhou,N.urumqi,N.khorgos,N.altynkol,N.aktogay,N.zhezkazgan,N.beineu,
    N.kuryk,N.aktau,N.alat,N.ganja,N.tbilisi,N.akhalkalaki,N.kars,N.ankara,N.istanbul,N.poti,N.constanta
  ];

  visibleNodes.forEach(p=>{
    const keyNode=['origin','port','destination','blackSeaNode'].includes(p.kind);
    const m=L.circleMarker([p.lat,p.lon],{
      radius:keyNode?7:4.5,
      color:palette.outline,
      weight:2,
      fillColor:markerColor(p),
      fillOpacity:1,
      className:'route-node-marker'
    }).addTo(layers.nodes);

    m.bindPopup(
      `<div class="route-popup"><span class="route-popup-type">${escapeHTML(p.kind==='origin'?'Origin':p.kind==='port'?'Port':p.kind==='destination'?'Destination':p.kind==='blackSeaNode'?'Black Sea node':p.kind==='gateway'?'Gateway':'Rail node')}</span><strong>${escapeHTML(p.name)}</strong><small>${escapeHTML(p.country)}</small><p>${escapeHTML(p.role)}</p></div>`
    );
    m.bindTooltip(p.name,{direction:'top',offset:[0,-7],className:'route-tooltip'});
    m.on('mouseover',()=>m.setStyle({radius:keyNode?10:7,weight:3}));
    m.on('mouseout',()=>m.setStyle({radius:keyNode?7:4.5,weight:2}));
  });

  L.control.layers(null,{
    'China rail':layers.china,
    'Kazakhstan rail':layers.kazakhstan,
    'Aktau branch':layers.aktau,
    'Caspian crossing':layers.caspian,
    'Türkiye continuation':layers.west,
    'Black Sea branch':layers.blackSea,
    'Nodes':layers.nodes
  },{
    collapsed:window.innerWidth<760,
    position:'topright'
  }).addTo(map);

  L.control.scale({imperial:false,position:'bottomright'}).addTo(map);

  const bounds={
    full:L.latLngBounds([[33.5,27.8],[48.8,110.2]]),
    caspian:L.latLngBounds([[39.1,48.4],[48.5,81.0]]),
    turkiye:L.latLngBounds([[39.1,28.2],[42.3,50.1]]),
    blacksea:L.latLngBounds([[40.8,27.8],[45.0,45.4]])
  };

  const setView=(key)=>{
    const b=bounds[key]||bounds.full;
    map.fitBounds(b,{padding:[28,28],maxZoom:key==='full'?4:6});
    document.querySelectorAll('[data-route-view]').forEach(btn=>{
      btn.classList.toggle('active',btn.dataset.routeView===key);
    });
    setTimeout(()=>map.invalidateSize(),80);
  };

  document.querySelectorAll('[data-route-view]').forEach(btn=>{
    btn.addEventListener('click',()=>setView(btn.dataset.routeView));
  });

  setView('full');
  map.on('click',()=>map.scrollWheelZoom.enable());
}
let NEWS_DATA=null;

function renderNews(data){
  NEWS_DATA=data;
  if(!window.newsGrid) return;
  const items=data?.items||[];
  newsStatus.textContent=data?.status==='live'?'LIVE':'OFFLINE';
  newsStatus.className=data?.status==='live'?'live':'offline';
  newsUpdated.textContent=data?.updated_at?`Updated ${formatAge(data.updated_at)}`:'—';

  newsGrid.innerHTML=items.length?items.slice(0,8).map(n=>`<article class="news-card">
    <div class="news-meta"><span>${escapeHTML(n.source||'News')}</span><time>${n.published_at?new Date(n.published_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}):''}</time></div>
    <h3><a href="${n.url}" target="_blank" rel="noopener">${escapeHTML(n.title)}</a></h3>
  </article>`).join(''):'<div class="news-empty">No recent Middle Corridor stories available.</div>';
}

async function loadNews(){
  const base=((window.MCFM_CONFIG||{}).aisApiBase||'').replace(/\/$/,'');
  if(!base){ renderNews({status:'offline',items:[]}); return; }
  try{
    const res=await fetch(`${base}/api/news?t=${Date.now()}`,{cache:'no-store'});
    if(!res.ok) throw new Error(`News HTTP ${res.status}`);
    renderNews(await res.json());
  }catch(err){
    renderNews({status:'offline',items:NEWS_DATA?.items||[]});
    console.warn(err);
  }
}

document.addEventListener('DOMContentLoaded',initRouteMap);
loadNews();
setInterval(loadNews,5*60*1000);

// --- Shared display utilities ---

function escapeHTML(v){
  return String(v??'').replace(/[&<>'"]/g,c=>({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    "'":'&#39;',
    '"':'&quot;'
  }[c]));
}

function formatAge(iso){
  if(!iso) return '—';
  const sec=Math.max(0,Math.floor((Date.now()-new Date(iso).getTime())/1000));
  if(sec<60) return `${sec}s ago`;
  if(sec<3600) return `${Math.floor(sec/60)}m ago`;
  if(sec<86400) return `${Math.floor(sec/3600)}h ago`;
  return `${Math.floor(sec/86400)}d ago`;
}
