let DATA = null;
let lastPayload = '';

const money = v => '$' + Number(v).toLocaleString('en-US', {maximumFractionDigits: 0});
const fmtInt = v => Number(v).toLocaleString('en-US');
const pct = v => (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(1) + '%';
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function set(id, v){ const el = document.getElementById(id); if (el) el.textContent = v; }

function startClock(){
  const tick = () => set('clockUtc', new Date().toLocaleString('en-GB', {
    timeZone:'UTC', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
  }) + ' UTC');
  tick(); setInterval(tick, 1000);
}

async function load({silent=false} = {}){
  try{
    const r = await fetch('data.json?ts=' + Date.now(), {cache:'no-store'});
    if(!r.ok) throw new Error('HTTP ' + r.status);
    const raw = await r.text();
    if(raw === lastPayload && DATA){ if(!silent) set('updateState','no newer verified publication'); return; }
    lastPayload = raw;
    DATA = JSON.parse(raw);
    render();
  }catch(e){
    console.error(e);
    if(!silent) set('updateState','data file unavailable');
  }
}

function render(){
  const ix=DATA.index, c=DATA.corridor, t=DATA.transit, ca=DATA.caspian, cap=DATA.capacity||{}, a=DATA.aktau||{};
  set('mciIndex', Number(ix.current_index).toFixed(1));
  set('basePeriod', ix.base_period.toUpperCase());
  set('coverage', ix.coverage);
  set('mciPrice', money(ix.current_usd_feu));
  set('fixingPeriod', ix.current_period);
  set('mciDelta', `${pct(ix.change_since_base_pct)} VS BASE`);
  set('baseBasketUsd', money(ix.base_usd_feu || (ix.history?.[0]?.usd_feu || 0)));
  set('laneCount', String(ix.components?.length || 0));
  set('fixingFreshness', ix.current_period === 'Jun 2026' ? 'latest comparable public 3-lane fixing found in current source set' : 'latest comparable public 3-lane fixing');
  set('aboutMciIndex', Number(ix.current_index).toFixed(1));
  set('aboutMciPrice', money(ix.current_usd_feu));
  set('aboutBasketPrice', money(ix.current_usd_feu) + ' / FEU');

  set('teuYtd', fmtInt(c.teu_ytd) + ' TEU'); set('teuPeriod', c.period); set('teuYoy', pct(c.yoy_pct));
  set('blockTrains', fmtInt(c.block_trains)); set('trainGrowth', pct(c.block_trains_yoy_pct) + ' YoY');
  set('transitDays', t.reference_days + ' days'); set('transitRoute', t.route);
  set('westShare', Number(c.westbound_share_pct).toFixed(1) + '%');
  set('westTeu', fmtInt(c.westbound_teu) + ' TEU'); set('eastTeu', fmtInt(c.eastbound_teu) + ' TEU');
  document.getElementById('westBar').style.width = c.westbound_share_pct + '%';
  document.getElementById('eastBar').style.width = (100 - c.westbound_share_pct) + '%';
  set('capacityMt', Number(cap.designed_mt || 6).toFixed(1));
  set('cargoMt', Number(cap.ytd_mt || 3).toFixed(1) + 'm t'); set('cargoPeriod', cap.period || 'Jan–Aug 2026'); set('cargoYoy', pct(cap.yoy_pct || 22));

  const ocean=(DATA.transport_prices||[]).find(x=>x.code==='OCEAN-EU');
  if(ocean){
    const spread = 100*(ix.current_usd_feu/ocean.mid - 1);
    set('oceanPremium', pct(spread));
    set('heroOceanPremium', pct(spread));
  }

  renderAktau(a,ca); renderComponents(); renderPricing(); renderLog(); renderNews(); renderSources(); renderRoute();

  const dt = new Date(DATA.meta.generated_at);
  const stamp = isNaN(dt) ? DATA.meta.generated_at : dt.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
  set('lastUpdated', stamp); set('footerUpdated','Published snapshot ' + stamp);
  const u=DATA.meta.update_results;
  set('updateState', u ? Object.entries(u).map(([k,v])=>`${k}: ${v===true?'updated':v===false?'no change':v}`).join(' · ') : 'verified snapshot');
}

function renderAktau(a,ca){
  set('aktauCapacity', Number(a.capacity_mt||11.8).toFixed(1)); set('aktauBerths', a.berths||11);
  set('aktauNav', a.navigation||'Year-round'); set('aktauOps', a.operations||'24 / 7');
  set('aktauOpenStorage', fmtInt(a.open_storage_m2||79700) + ' m²');
  set('hubStage1', fmtInt(a.container_hub_stage1_teu||140000) + ' TEU');
  set('hubDesign', fmtInt(a.container_hub_design_teu||240000) + ' TEU');
  set('hubStatus', a.container_hub_status||'First stage operational; expansion continues toward design capacity.');
  const share = Math.min(100,100*(a.container_hub_stage1_teu||140000)/(a.container_hub_design_teu||240000));
  document.getElementById('hubCapacityFill').style.width = share + '%';
  set('aktauCapex', (a.upgrade_capex_kzt_bn||29.6).toFixed(1) + 'bn KZT');
  set('aktauAlatTeu', fmtInt(ca.aktau_alat_teu) + ' TEU'); set('aktauAlatPeriod', ca.latest_month);
  set('aktauAlatYoy', '+' + ca.yoy_pct + '%'); set('aktauFerryLoad', (ca.ferry_load_pct||80) + '%');
  set('aktauDraft', (a.draft_target_min_m||6) + '–' + (a.draft_target_max_m||7) + ' m');
  set('aktauDredging', a.dredging_completion||'Target: end-2026');
  set('aktauTariffDate', a.tariff_schedule_date||'—');
  set('pressureState', a.pressure_index==null ? 'DATA BUILDING' : 'APP ' + a.pressure_index);
  document.getElementById('pressureFactors').innerHTML=(a.pressure_factors||[]).map(x=>`<div class="pressure-factor"><span>${esc(x.name)}</span><b class="${esc(x.level||'na')}">${esc(x.value)}</b></div>`).join('');
}

function renderComponents(){
  const ix=DATA.index;
  document.getElementById('componentStrip').innerHTML=ix.components.map(x=>`<div class="ref"><div class="top"><span>${esc(x.code)} · ${(x.weight*100).toFixed(0)}%</span><span>${esc(x.period)}</span></div><strong>${money(x.mid)} / FEU</strong><small>${esc(x.lane)}</small></div>`).join('');
  document.getElementById('laneRows').innerHTML=ix.components.map(x=>`<tr><td><strong>${esc(x.code)}</strong></td><td>${esc(x.lane)}</td><td>${(x.weight*100).toFixed(0)}%</td><td>${money(x.low)}–${money(x.high)}</td><td><strong>${money(x.mid)}</strong></td><td>${esc(x.period)}</td></tr>`).join('');
}

function renderPricing(){
  document.getElementById('priceGrid').innerHTML=(DATA.transport_prices||[]).map(r=>`<article class="price-card"><div class="mode"><span>${esc(r.mode)}</span><span>${esc(r.period)}</span></div><strong>${esc(r.display)}</strong><div class="unit">${esc(r.unit)}</div><p>${esc(r.lane)} · ${esc(r.transit||'')}<br><a href="${esc(r.source_url)}" target="_blank" rel="noreferrer">${esc(r.source)} ↗</a></p></article>`).join('');
}

function renderLog(){
  if(!DATA) return;
  const q=(document.getElementById('searchBox').value||'').toLowerCase(), ty=document.getElementById('typeFilter').value;
  const rows=DATA.log.filter(r=>(ty==='all'||r.type===ty)&&Object.values(r).join(' ').toLowerCase().includes(q));
  document.getElementById('logRows').innerHTML=rows.map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.type)}</td><td>${esc(r.lane)}</td><td><strong>${esc(r.value)}</strong></td><td>${esc(r.source)}</td></tr>`).join('') || '<tr><td colspan="5">No matching records.</td></tr>';
}

function renderNews(){
  document.getElementById('newsGrid').innerHTML=(DATA.news||[]).map(n=>`<a class="news-card" href="${esc(n.url)}" target="_blank" rel="noreferrer"><div class="meta"><span>${esc(n.source)}</span><span>${esc(n.date)}</span></div><h3>${esc(n.title)}</h3><p>${esc(n.summary)}</p><div class="arrow">READ SOURCE ↗</div></a>`).join('');
}

function renderSources(){
  const urls=new Map();
  [...(DATA.index.components||[]),DATA.corridor,DATA.transit,DATA.caspian,DATA.capacity,DATA.aktau,...(DATA.transport_prices||[])].filter(Boolean).forEach(x=>{
    if(x.source_url) urls.set(x.source_url,x.source||x.code||'Source');
    if(x.tariff_source_url) urls.set(x.tariff_source_url,'Aktau Port tariffs');
    if(x.container_hub_source_url) urls.set(x.container_hub_source_url,'Aktau container hub');
    if(x.dredging_source_url) urls.set(x.dredging_source_url,'Aktau dredging');
  });
  document.getElementById('sourceLinks').innerHTML=[...urls].map(([u,n])=>`<a href="${esc(u)}" target="_blank" rel="noreferrer">${esc(n)} ↗</a>`).join('');
}

function renderRoute(){
  const svg=document.getElementById('corridorSchematic'); if(!svg||!DATA) return;
  const c=DATA.index.components, a=DATA.aktau, ca=DATA.caspian, t=DATA.transit;
  const mc1=c.find(x=>x.code==='MC1'), mc2=c.find(x=>x.code==='MC2'), mc3=c.find(x=>x.code==='MC3');
  const n={
    xian:[86,165], khorgos:[250,165], altynkol:[355,165], aktau:[555,165], alat:[735,165], tbilisi:[895,165], kars:[1010,165], istanbul:[1170,165],
    poti:[900,420], constanta:[1155,420]
  };
  const line=(a,b,cls)=>`<line class="${cls}" x1="${n[a][0]}" y1="${n[a][1]}" x2="${n[b][0]}" y2="${n[b][1]}"/>`;
  const node=(id,label,sub,kind='rail',above=true)=>{const [x,y]=n[id]; const cy=above?y-25:y+42; const sy=above?y-10:y+58; return `<g><circle cx="${x}" cy="${y}" r="${id==='aktau'?10:6}" class="node ${kind} ${id==='aktau'?'focus':''}"/><text x="${x}" y="${cy}" text-anchor="middle" class="node-name ${id==='aktau'?'focus-text':''}">${esc(label)}</text><text x="${x}" y="${sy}" text-anchor="middle" class="node-sub">${esc(sub)}</text></g>`};
  const box=(x,y,w,title,value,sub,accent='green')=>`<g transform="translate(${x} ${y})"><rect class="metric-box" width="${w}" height="72" rx="4"/><text x="13" y="19" class="box-title">${esc(title)}</text><text x="13" y="43" class="box-value ${accent}">${esc(value)}</text><text x="13" y="60" class="box-sub">${esc(sub)}</text></g>`;

  svg.innerHTML=`
  <style>
    .bg{fill:#080a0a}.band{fill:#0b0e0d;stroke:#171b1a}.band-alt{fill:#0a0d0c;stroke:#171b1a}.band-label{font:9px 'DM Mono',monospace;fill:#4d5954;letter-spacing:.13em}
    .rail-line{stroke:#37e38d;stroke-width:5;stroke-linecap:round}.sea-line{stroke:#55c2ff;stroke-width:5;stroke-linecap:round;stroke-dasharray:11 8}.branch-line{stroke:#f5b94c;stroke-width:4;stroke-linecap:round}
    .node{fill:#080a0a;stroke-width:3}.node.rail{stroke:#37e38d}.node.port{stroke:#55c2ff}.node.branch{stroke:#f5b94c}.node.focus{stroke-width:5}
    .node-name{font:500 10px 'DM Mono',monospace;fill:#b5c0bb}.node-sub{font:8px 'DM Mono',monospace;fill:#56615c}.focus-text{fill:#fff}
    .segment{font:9px 'DM Mono',monospace;fill:#62706a;letter-spacing:.07em}.sea-name{font:10px 'DM Mono',monospace;fill:#31596b;letter-spacing:.12em}
    .metric-box{fill:#0c0f0e;stroke:#2a302e}.box-title{font:8px 'DM Mono',monospace;fill:#7f8a86}.box-value{font:700 16px 'DM Mono',monospace}.box-value.green{fill:#37e38d}.box-value.blue{fill:#55c2ff}.box-value.gold{fill:#f5b94c}.box-sub{font:8px 'DM Mono',monospace;fill:#68736f}
    .aktau-zone{fill:#0a1316;stroke:#235164;stroke-width:1}.aktau-title{font:700 10px 'DM Mono',monospace;fill:#d7edf6}.aktau-stat{font:8px 'DM Mono',monospace;fill:#78909a}.aktau-val{font:700 13px 'DM Mono',monospace;fill:#55c2ff}
  </style>
  <rect class="bg" width="1280" height="650"/>
  <rect class="band" x="30" y="42" width="175" height="50"/><rect class="band-alt" x="205" y="42" width="460" height="50"/><rect class="band" x="665" y="42" width="300" height="50"/><rect class="band-alt" x="965" y="42" width="285" height="50"/>
  <text class="band-label" x="48" y="72">CHINA</text><text class="band-label" x="225" y="72">KAZAKHSTAN</text><text class="band-label" x="685" y="72">AZERBAIJAN / GEORGIA</text><text class="band-label" x="985" y="72">TÜRKİYE / EUROPE</text>

  ${line('xian','khorgos','rail-line')}${line('khorgos','altynkol','rail-line')}${line('altynkol','aktau','rail-line')}
  ${line('aktau','alat','sea-line')}${line('alat','tbilisi','rail-line')}${line('tbilisi','kars','branch-line')}${line('kars','istanbul','branch-line')}
  ${line('tbilisi','poti','branch-line')}${line('poti','constanta','sea-line')}

  <text class="segment" x="135" y="137">CHINA RAIL</text><text class="segment" x="400" y="137">KAZAKH RAIL</text><text class="sea-name" x="612" y="137">CASPIAN</text><text class="segment" x="775" y="137">SOUTH CAUCASUS RAIL</text><text class="segment" x="1035" y="137">BTK / TÜRKİYE</text>
  <text class="segment" x="908" y="315">BLACK SEA BRANCH</text>

  ${node('xian','XI’AN','origin','rail',true)}
  ${node('khorgos','KHORGOS','China border','rail',false)}
  ${node('altynkol','ALTYNKOL','Kazakh gateway','rail',true)}
  ${node('aktau','AKTAU','Caspian gateway','port',false)}
  ${node('alat','ALAT','Baku Port','port',true)}
  ${node('tbilisi','TBILISI','Georgia hub','rail',false)}
  ${node('kars','KARS','BTK gateway','branch',true)}
  ${node('istanbul','ISTANBUL','Türkiye','branch',false)}
  ${node('poti','POTI','Black Sea port','branch',false)}
  ${node('constanta','CONSTANȚA','EU gateway','port',false)}

  ${box(655,245,205,'MC1 · XI’AN → ALAT',`${money(mc1.mid)} / FEU`,`${mc1.period} midpoint`,'green')}
  ${box(835,245,205,'MC2 · XI’AN → TBILISI',`${money(mc2.mid)} / FEU`,`${mc2.period} midpoint`,'green')}
  ${box(1042,245,205,'MC3 · XI’AN → TÜRKİYE',`${money(mc3.mid)} / FEU`,`${mc3.period} midpoint`,'gold')}

  <g transform="translate(375 300)"><rect class="aktau-zone" width="405" height="165" rx="5"/><text x="16" y="25" class="aktau-title">AKTAU OPERATING NODE</text>
    <text x="16" y="52" class="aktau-stat">PORT CAPACITY</text><text x="16" y="73" class="aktau-val">${Number(a.capacity_mt).toFixed(1)}m t/yr</text>
    <text x="125" y="52" class="aktau-stat">BERTHS</text><text x="125" y="73" class="aktau-val">${a.berths}</text>
    <text x="205" y="52" class="aktau-stat">CONTAINER HUB</text><text x="205" y="73" class="aktau-val">${fmtInt(a.container_hub_stage1_teu)} TEU</text>
    <text x="16" y="103" class="aktau-stat">AKTAU → ALAT</text><text x="16" y="124" class="aktau-val">${fmtInt(ca.aktau_alat_teu)} TEU</text><text x="16" y="142" class="aktau-stat">${esc(ca.latest_month)} · +${ca.yoy_pct}% YoY</text>
    <text x="205" y="103" class="aktau-stat">FERRY LOAD SIGNAL</text><text x="205" y="124" class="aktau-val">${ca.ferry_load_pct}%</text><text x="205" y="142" class="aktau-stat">reported usable load</text>
  </g>

  ${box(792,500,205,'REFERENCE TRANSIT',`${t.reference_days} DAYS`,`${t.route} · ${fmtInt(t.distance_km)} km`,'blue')}
  ${box(1010,500,235,'AKTAU DRAFT PROGRAMME',`${a.draft_target_min_m}–${a.draft_target_max_m} m`,`${a.dredging_completion}`,'blue')}
  `;

  const ladder=[mc1,mc2,mc3];
  document.getElementById('rateLadder').innerHTML=ladder.map((r,i)=>{const prev=i?ladder[i-1]:null,step=prev?r.mid-prev.mid:null;return `<div class="rate-rung"><div class="r-top"><span>${esc(r.code)}</span><span>${esc(r.period)}</span></div><strong>${money(r.mid)}</strong><small>${esc(r.lane)}</small>${step!=null?`<small class="step">IMPLIED INCREMENT +${money(step)}</small>`:''}</div>`}).join('');
  document.getElementById('routeStats').innerHTML=`<div><span>Aktau port capacity</span><strong>${Number(a.capacity_mt).toFixed(1)}m t</strong><small>annual handling capacity</small></div><div><span>Aktau container hub</span><strong>${fmtInt(a.container_hub_stage1_teu)} TEU</strong><small>stage 1 · ${fmtInt(a.container_hub_design_teu)} TEU design</small></div><div><span>Reference train</span><strong>${t.reference_days} days</strong><small>${esc(t.route)}</small></div><div><span>Draft programme</span><strong>${a.draft_target_min_m}–${a.draft_target_max_m} m</strong><small>${esc(a.dredging_completion)}</small></div>`;
  const ref=DATA.official_titr_tariff_reference;
  document.getElementById('officialTariffNote').innerHTML=ref?`Historical official tariff reference: ${esc(ref.period)} TITR complex rates listed Altynkol→Baku/Alat at <b>${money(ref.altynkol_alat_feu)}/FEU</b>, Altynkol→Poti at <b>${money(ref.altynkol_poti_feu)}/FEU</b> and Altynkol→Istanbul at <b>${money(ref.altynkol_istanbul_feu)}/FEU</b>. These are historical reference tariffs and are <b>not</b> used as current 2026 MCI market prices. <a href="${esc(ref.source_url)}" target="_blank" rel="noreferrer">Official TITR tariff ↗</a>`:'';
}

document.getElementById('searchBox').addEventListener('input',renderLog);
document.getElementById('typeFilter').addEventListener('input',renderLog);
startClock();
load();
setInterval(()=>load({silent:true}), 300000);
