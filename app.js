const fmtUSD = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
let DATA;
function confidencePill(c){const x=(c||'').toLowerCase(); const cls=x.includes('high')?'good':x.includes('low')?'bad':'warn'; return `<span class="pill ${cls}">${c}</span>`;}
async function loadData(){const res=await fetch(`data.json?t=${Date.now()}`,{cache:'no-store'}); DATA=await res.json(); render(); refreshStatus.textContent=`Data loaded · ${new Date().toLocaleString()} · browser refresh every ${DATA.meta.refresh_minutes} min`;}
function render(){
  const h=DATA.headline;
  mcfiValue.textContent=fmtUSD(h.latest_mcfi_core.value_usd); mcfiMeta.textContent=`${h.latest_mcfi_core.period} · ${h.latest_mcfi_core.coverage}`;
  bakuValue.textContent=fmtUSD(h.latest_baku_market.value_usd); bakuMeta.textContent=`${h.latest_baku_market.period} · ${h.latest_baku_market.range}`;
  turkeyValue.textContent=fmtUSD(h.latest_turkey_market.value_usd); turkeyMeta.textContent=`${h.latest_turkey_market.period} · ${h.latest_turkey_market.range}`;
  providerValue.textContent=fmtUSD(h.latest_provider_snapshot.value_usd); providerMeta.textContent=`${h.latest_provider_snapshot.period} · ${h.latest_provider_snapshot.route} · not MCFI`;
  const s=DATA.model.shipment;
  modelSpecs.innerHTML=[['Container',s.container],['Cargo',s.cargo],['Direction',s.direction],['Origin',s.origin],['Core path',s.core_path]].map(([a,b])=>`<div class="spec"><span>${a}</span><strong>${b}</strong></div>`).join('');
  formulaText.textContent=DATA.model.formula.replace('MCFI-40 Core = ','');
  routeCards.innerHTML=DATA.model.routes.map(r=>`<div class="route-card"><b>${r.label}</b><small>Fixed weight ${(r.weight*100).toFixed(0)}% · ${r.purpose}</small></div>`).join('');
  modelNote.textContent=DATA.model.publication_rule;
  methodologyLink.href=DATA.model.methodology_source;
  aktauKpis.innerHTML=`<div class="inline-kpi"><span>Port capacity</span><strong>${DATA.aktau.capacity_mtpa ?? '—'} Mt/y</strong></div><div class="inline-kpi"><span>Container hub</span><strong>${(DATA.aktau.container_hub_teu ?? 0).toLocaleString()} TEU/y</strong></div><div class="inline-kpi"><span>2024 proposed 40' handling</span><strong>${fmtUSD(DATA.aktau.historical_2024_proposed_handling_40ft_usd ?? 80)}</strong></div>`;
  yearKpis.innerHTML=DATA.year_summary.map(x=>`<div class="inline-kpi"><span>${x.year} · ${x.complete_months}/${x.months_elapsed} complete months</span><strong>${fmtUSD(x.average_usd)}</strong><small>observed-month avg · range ${fmtUSD(x.low_usd)}–${fmtUSD(x.high_usd)}</small></div>`).join('');
  buildYearFilters(); renderMcfiTable(); renderHistoryTable();
  gapsTable.innerHTML=DATA.coverage_gaps.map(x=>`<tr><td>${x.period}</td><td><span class="pill warn">${x.status}</span></td><td>${x.detail}</td></tr>`).join('');
  const mm=DATA.external_benchmarks.maxmodal_msri_middle_20ft||[]; maxmodalTable.innerHTML=mm.length?mm.map(x=>`<tr><td>${x.period}</td><td class="price">${fmtUSD(x.value_usd)}</td></tr>`).join(''):'<tr><td colspan="2">No external series loaded.</td></tr>'; externalNote.textContent=DATA.external_benchmarks.note;
}
function buildYearFilters(){
  const years=[...new Set(DATA.historical_observations.map(x=>x.period.slice(0,4)))].sort(); if(yearFilter.options.length===0) yearFilter.innerHTML='<option value="all">All years</option>'+years.map(y=>`<option>${y}</option>`).join('');
  const my=[...new Set(DATA.mcfi_monthly.map(x=>x.period.slice(0,4)))].sort(); if(mcfiYearFilter.options.length===0) mcfiYearFilter.innerHTML='<option value="all">All years</option>'+my.map(y=>`<option>${y}</option>`).join('');
}
function renderMcfiTable(){const y=mcfiYearFilter.value||'all', total=DATA.model.routes.length; const rows=DATA.mcfi_monthly.filter(x=>y==='all'||x.period.startsWith(y)); mcfiTable.innerHTML=rows.map(x=>`<tr><td>${x.period}</td><td class="price">${fmtUSD(x.mcfi_usd)}</td><td class="price">${fmtUSD(x.baku_midpoint_usd)}</td><td class="price">${fmtUSD(x.turkey_midpoint_usd)}</td><td>${x.observed_routes}/${total} routes</td><td>${confidencePill(x.confidence)}</td><td>${x.basis}<br><small><a href="${x.source_url}" target="_blank" rel="noopener">source</a></small></td></tr>`).join('');}
function renderHistoryTable(){const y=yearFilter.value||'all', e=eligibilityFilter.value||'all'; const rows=DATA.historical_observations.filter(x=>(y==='all'||x.period.startsWith(y))&&(e==='all'||(e==='primary'?x.primary_eligible:!x.primary_eligible))); historyTable.innerHTML=rows.map(x=>{const price=x.low_usd===x.high_usd?fmtUSD(x.midpoint_usd):`${fmtUSD(x.low_usd)}–${fmtUSD(x.high_usd)}`; return `<tr><td>${x.date}</td><td><b>${x.route}</b><br><small>${x.container} · ${x.ownership}</small></td><td class="price">${price}</td><td>${x.scope}</td><td>${x.grade}</td><td>${x.primary_eligible?'<span class="pill good">core evidence</span>':'<span class="pill">context</span>'}</td><td><a href="${x.source_url}" target="_blank" rel="noopener">${x.source_name}</a><br><small>${x.notes}</small></td></tr>`}).join('');}
yearFilter?.addEventListener('change',renderHistoryTable); eligibilityFilter?.addEventListener('change',renderHistoryTable); mcfiYearFilter?.addEventListener('change',renderMcfiTable);
loadData().catch(err=>{refreshStatus.textContent='Could not load data.json: '+err.message}); setInterval(()=>loadData().catch(()=>{}),5*60*1000);