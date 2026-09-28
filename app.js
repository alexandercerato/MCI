const fmtUSD = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
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
  mcfiValue.textContent=fmtUSD(h.latest_mcfi_core.value_usd);
  mcfiMeta.textContent=`${fmtMonth(h.latest_mcfi_core.period)} · ${h.latest_mcfi_core.coverage}`;
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
  formulaText.textContent=DATA.model.formula.replace('MCFI-40 Core = ','');
  methodologyLink.href=DATA.model.methodology_source;

  aktauKpis.innerHTML=`
    <div class="inline-kpi"><span>Port capacity</span><strong>${DATA.aktau.capacity_mtpa} Mt/y</strong><small>Aktau</small></div>
    <div class="inline-kpi"><span>Container hub</span><strong>${DATA.aktau.container_hub_teu.toLocaleString()} TEU/y</strong><small>Annual capacity</small></div>
    <div class="inline-kpi"><span>40' handling reference</span><strong>${fmtUSD(DATA.aktau.historical_2024_proposed_handling_40ft_usd)}</strong><small>2024 published proposal</small></div>`;

  yearKpis.innerHTML=DATA.year_summary.map(x=>`
    <div class="inline-kpi"><span>${x.year}</span><strong>${fmtUSD(x.average_usd)}</strong><small>${x.complete_months} priced months · ${fmtUSD(x.low_usd)}–${fmtUSD(x.high_usd)}</small></div>`).join('');

  buildYearFilters();
  renderMcfiTable();
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
  mcfiTable.innerHTML=rows.map(x=>`<tr>
    <td>${fmtMonth(x.period)}</td>
    <td>${fmtUSD(x.mcfi_usd)}</td>
    <td>${fmtUSD(x.baku_midpoint_usd)}</td>
    <td>${fmtUSD(x.turkey_midpoint_usd)}</td>
    <td><a href="${x.source_url}" target="_blank" rel="noopener">View ↗</a></td>
  </tr>`).join('');
}

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
