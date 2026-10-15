/* Reuses the site's data.json and /api/pricing refreshes. No separate rate cache. */
(function(){
  'use strict';
  const engine=window.MCI_ESTIMATOR,form=document.getElementById('estimateForm');
  if(!engine||!form)return;
  const from=form.elements.origin,to=form.elements.destination,result=document.getElementById('estimateResult'),status=document.getElementById('estimateFeedStatus');
  let snapshot=null,live=null,checked=null,feedState='loading';
  const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
  const period=p=>p?new Date(p+'-01T00:00:00Z').toLocaleDateString('en-GB',{month:'short',year:'numeric',timeZone:'UTC'}):'Unknown period';
  const safeURL=s=>{try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)?escape(u.href):null;}catch{return null;}};
  const countries=[...new Set(engine.nodes.map(n=>n.country))];
  const options=countries.map(country=>`<optgroup label="${escape(country)}">${engine.nodes.filter(n=>n.country===country).map(n=>`<option value="${n.id}">${escape(n.name)}</option>`).join('')}</optgroup>`).join('');
  from.innerHTML=options;to.innerHTML=options;from.value='xian';to.value='istanbul';
  function show(){
    if(!snapshot){result.innerHTML='<div class="estimate-empty">Loading the shared market dataset…</div>';return;}
    const r=engine.estimate({from:from.value,to:to.value,cargo:form.elements.cargo.value,weight:Number(form.elements.weight.value),container:form.elements.equipment.value},snapshot,live);
    const lastCheck=checked?new Date(checked).toLocaleTimeString('en-GB',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit'}):null;
    status.textContent=feedState==='live'?`Shared pricing feed · checked ${lastCheck||'recently'} Rome`:feedState==='offline'?'Live check unavailable · using latest saved references':'Using shared dataset · waiting for live pricing';
    if(!['assessment','model'].includes(r.kind)){
      result.innerHTML=`<div class="estimate-empty"><span class="estimate-badge">${r.kind==='invalid'?'Check shipment details':'Operator quotation required'}</span><h3>${escape(r.message)}</h3><p>No unsupported price is generated for this selection.</p></div>`;return;
    }
    const sourceHTML=r.sources.map(s=>{const url=safeURL(s.url);return `<li>${url?`<a href="${url}" target="_blank" rel="noopener">${escape(s.name)} ↗</a>`:escape(s.name)}<small>${escape(/^20\d{2}-\d{2}$/.test(s.period||'')?period(s.period):s.period)}</small></li>`;}).join('');
    result.innerHTML=`<div class="estimate-result-head"><span class="estimate-badge ${r.kind==='assessment'?'observed':'modelled'}">${escape(r.confidence)}</span><span class="estimate-period">Market anchor: ${period(r.period)}</span></div>
      <h3 class="estimate-price">${money(r.low)} <span>–</span> ${money(r.high)}</h3>
      <p class="estimate-unit">USD · one loaded 40HC · terminal-to-terminal reference</p>
      <p class="estimate-explanation">${escape(r.explanation)}</p>
      <div class="estimate-route" aria-label="Indicative route">${r.route.map(n=>`<span>${escape(n.name)}<small>${escape(n.country)}</small></span>`).join('<i aria-hidden="true">→</i>')}</div>
      ${r.components.length?`<div class="estimate-allocation"><h4>Model allocation at ${money(r.mid)}</h4><p>Allocation of the modelled midpoint, not separately bookable segment tariffs or additional charges.</p><dl>${r.components.map(c=>`<div><dt>${escape(c.label)}</dt><dd>${money(c.value)}</dd></div>`).join('')}</dl></div>`:'<p class="estimate-note">The source does not publish a segment-by-segment price breakdown.</p>'}
      <details class="estimate-details"><summary>Assumptions, exclusions and sources</summary>
        <h4>Before using this estimate</h4><ul>${r.warnings.map(w=>`<li>${escape(w)}</li>`).join('')}</ul>
        <h4>Excluded unless expressly included in the source</h4><ul>${r.exclusions.map(w=>`<li>${escape(w)}</li>`).join('')}</ul>
        <h4>References used</h4><ul class="estimate-sources">${sourceHTML}</ul>
        <p class="estimate-note">Model ${escape(r.modelVersion)}. Rail geometry uses great-circle distances × 1.25, not a measured railway tariff distance. Regional weights come from historical cost/tariff references. The Black Sea proxy scales the Caspian reference by the square root of the sea-distance ratio. Missing charges are not invented as separate verified fees. No capacity or booking availability is guaranteed.</p>
      </details>`;
  }
  form.addEventListener('input',show);form.addEventListener('change',show);form.addEventListener('submit',event=>{event.preventDefault();show();});
  document.getElementById('estimateSwap').addEventListener('click',()=>{const old=from.value;from.value=to.value;to.value=old;show();});
  document.querySelectorAll('[data-estimate-preset]').forEach(button=>button.addEventListener('click',()=>{const [a,b]=button.dataset.estimatePreset.split(':');from.value=a;to.value=b;show();}));
  window.MCI_ESTIMATOR_UI={update(data,pricing,meta={}){
    snapshot=data;live=pricing;
    if(meta.checked_at)checked=meta.checked_at;
    if(meta.feedState)feedState=meta.feedState;
    show();
  }};
})();
