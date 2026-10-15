/* Route Cost Estimator v1.0 — pure model, shared by browser and Node checks.
   Modelled values are scenarios calibrated to public assessments, not offers. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.MCI_ESTIMATOR=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const nodes=[
    ['xian','Xi’an','China',34.34,108.94],['lanzhou','Lanzhou','China',36.06,103.83],
    ['urumqi','Ürümqi','China',43.82,87.62],['khorgos','Khorgos','China',44.21,80.41],
    ['altynkol','Altynkol','Kazakhstan',44.17,80.29],['dostyk','Dostyk','Kazakhstan',45.25,82.49],
    ['aktogay','Aktogay','Kazakhstan',46.95,79.67],['balkhash','Balkhash','Kazakhstan',46.85,74.98],
    ['zhezkazgan','Zhezkazgan','Kazakhstan',47.78,67.70],['saksaulsk','Saksaulsk','Kazakhstan',47.09,61.16],
    ['beineu','Beineu','Kazakhstan',45.32,55.20],['aktau','Aktau','Kazakhstan',43.65,51.17],
    ['kuryk','Kuryk','Kazakhstan',43.18,51.66],['alat','Baku / Alat','Azerbaijan',39.95,49.39],
    ['ganja','Ganja','Azerbaijan',40.68,46.36],['boyuk','Boyuk-Kesik','Azerbaijan',41.31,45.07],
    ['tbilisi','Tbilisi','Georgia',41.72,44.79],['akhalkalaki','Akhalkalaki','Georgia',41.41,43.49],
    ['kars','Kars','Türkiye',40.61,43.10],['erzurum','Erzurum','Türkiye',39.90,41.27],
    ['ankara','Ankara','Türkiye',39.93,32.86],['istanbul','Istanbul / Ambarli','Türkiye',41.01,28.97],
    ['mersin','Mersin','Türkiye',36.80,34.63],['poti','Poti','Georgia',42.15,41.67],
    ['constanta','Constanța','Romania',44.17,28.65]
  ].map(([id,name,country,lat,lon],rank)=>({id,name,country,lat,lon,rank}));
  const byId=Object.fromEntries(nodes.map(n=>[n.id,n]));
  const links=[
    ['xian','lanzhou','china'],['lanzhou','urumqi','china'],['urumqi','khorgos','china'],
    ['khorgos','altynkol','border'],['urumqi','dostyk','china'],['dostyk','aktogay','kazakhstan'],
    ['altynkol','aktogay','kazakhstan'],['aktogay','balkhash','kazakhstan'],
    ['balkhash','zhezkazgan','kazakhstan'],['zhezkazgan','saksaulsk','kazakhstan'],
    ['saksaulsk','beineu','kazakhstan'],['beineu','aktau','kazakhstan'],['beineu','kuryk','kazakhstan'],
    ['aktau','alat','caspian'],['kuryk','alat','caspian'],['alat','ganja','caucasus'],
    ['ganja','boyuk','caucasus'],['boyuk','tbilisi','caucasus'],['tbilisi','akhalkalaki','caucasus'],
    ['akhalkalaki','kars','turkiye'],['kars','erzurum','turkiye'],['erzurum','ankara','turkiye'],
    ['ankara','istanbul','turkiye'],['ankara','mersin','turkiye'],['tbilisi','poti','caucasus'],
    ['poti','constanta','blacksea']
  ];
  const labels={china:'China rail',border:'Border transfer',kazakhstan:'Kazakhstan rail',caspian:'Caspian crossing',caucasus:'Caucasus rail',turkiye:'Türkiye rail',blacksea:'Black Sea crossing'};
  const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
  function km(a,b){
    const rad=x=>x*Math.PI/180,dlat=rad(b.lat-a.lat),dlon=rad(b.lon-a.lon);
    const h=Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlon/2)**2;
    return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
  }
  function latest(a,b){return !a?b:!b?a:(b.period>a.period?b:a);}
  function assessment(q){
    if(!q||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(q.period||''))return null;
    if(q.container&&q.container!=='40HC')return null;
    const low=q.low_usd,high=q.high_usd;
    if(!positive(low)||!positive(high)||high<low)return null;
    const mid=positive(q.value_usd)?q.value_usd:(low+high)/2;
    return mid>=low&&mid<=high?{...q,low,high,mid}:null;
  }
  function references(data,live){
    const useLive=live?.status==='live'&&!live?.review_required;
    const h=data.headline||{},defaults=data.structural_benchmarks?.market_defaults||{};
    const historical=data.historical_observations||[];
    function saved(dest){
      return historical.filter(r=>r.evidence_type==='market assessment'&&r.origin?.replace('’',"'")==="Xi'an"&&(dest==='alat'?r.destination==='Baku':['Turkey','Türkiye'].includes(r.destination)))
        .map(assessment).filter(Boolean).sort((a,b)=>a.period.localeCompare(b.period)).pop()||null;
    }
    const baku=latest(latest(assessment(defaults.latest_comparable_assessment),saved('alat')),useLive?assessment(live.market?.assessment):null);
    const turkey=latest(latest(assessment(h.latest_mcfi_core),saved('turkey')),useLive?assessment(live.market?.turkey_assessment):null);
    const segments=data.structural_benchmarks?.segments||[];
    const segment=id=>segments.find(s=>s.id===id)||{};
    const kz=useLive&&positive(live.structural?.dostyk_aktau?.value_usd)?{...segment('dostyk_aktau'),...live.structural.dostyk_aktau}:segment('dostyk_aktau');
    const ferry=useLive&&positive(live.structural?.kuryk_alat?.value_usd)?{...segment('kuryk_alat'),...live.structural.kuryk_alat}:segment('kuryk_alat');
    const model=data.model?.theoretical_cost_model,parts=model?.components||[];
    const china=parts.find(p=>p.id==='china_rail');
    const border=parts.filter(p=>['border_transshipment','china_customs_admin'].includes(p.id)).reduce((n,p)=>n+(positive(p.value_usd)?p.value_usd:0),0);
    const integrated=data.structural_benchmarks?.integrated_official_reference||{},routes=integrated.routes||[];
    const b=routes.find(r=>/Baku/.test(r.route)),p=routes.find(r=>/Poti/.test(r.route)),t=routes.find(r=>/Istanbul/.test(r.route));
    const rate=(end,start,fallback)=>end&&start&&positive(end.value_usd-start.value_usd)&&positive(end.distance_km-start.distance_km)?(end.value_usd-start.value_usd)/(end.distance_km-start.distance_km):fallback;
    const weights={china:positive(china?.value_usd)?china.value_usd/3200:.53,kazakhstan:positive(kz.value_usd)?kz.value_usd/(kz.distance_km||3095):.40,
      border:border||40,caspian:positive(ferry.value_usd)?ferry.value_usd:1200,caucasus:rate(p,b,.61),turkiye:rate(t,b,.53)};
    const sources=[
      {name:'China rail / border cost-model reference',url:china?.source_urls?.[0]||'',period:'Historical model; not a current quote'},
      {name:kz.source_name||'Kazakhstan rail reference',url:kz.source_url||'',period:'Published reference; current validity not confirmed'},
      {name:ferry.source_name||'Caspian ferry reference',url:ferry.source_url||'',period:'Published reference; loading/discharging excluded'},
      {name:integrated.source_name||'TITR route weights',url:integrated.source_url||'',period:integrated.effective_period||'Historical reference'}
    ];
    return {baku,turkey,weights,ferry,sources,useLive};
  }
  function graph(weights){return links.map(([a,b,kind])=>{
    const distance=km(byId[a],byId[b])*(kind==='caspian'||kind==='blacksea'?1:1.25);
    let cost=kind==='border'?weights.border:kind==='caspian'?weights.caspian:kind==='blacksea'?weights.caspian*Math.sqrt(distance/km(byId.kuryk,byId.alat)):distance*weights[kind];
    if(a==='urumqi'&&b==='dostyk')cost+=weights.border;
    return {a,b,kind,km:distance,cost,key:[a,b].sort().join('|')};
  });}
  function path(from,to,edges){
    const dist={[from]:0},previous={},queue=new Set(nodes.map(n=>n.id));
    while(queue.size){
      const u=[...queue].filter(n=>Number.isFinite(dist[n])).sort((a,b)=>dist[a]-dist[b])[0];
      if(!u)break;queue.delete(u);if(u===to)break;
      for(const edge of edges){const v=edge.a===u?edge.b:edge.b===u?edge.a:null;if(!v||!queue.has(v))continue;
        const cost=dist[u]+edge.cost;if(cost<(dist[v]??Infinity)){dist[v]=cost;previous[v]={id:u,edge};}}
    }
    if(!Number.isFinite(dist[to]))return null;
    const result=[],cities=[to];let n=to;while(n!==from){const p=previous[n];if(!p)return null;result.unshift(p.edge);cities.unshift(p.id);n=p.id;}
    return {edges:result,cities,cost:dist[to],km:result.reduce((n,e)=>n+e.km,0)};
  }
  function estimate(input,data,live,now=new Date()){
    const fail=(message,kind='unavailable')=>({kind,message});
    if(!byId[input.from]||!byId[input.to])return fail('Choose both corridor locations.','invalid');
    if(input.from===input.to)return fail('Choose two different locations.','invalid');
    if(!['general','machinery','textiles','food','electronics','reefer','dangerous','oversize'].includes(input.cargo))return fail('Choose a cargo category.','invalid');
    if(!positive(input.weight))return fail('Enter a positive cargo weight in tonnes.','invalid');
    if(input.container!=='40HC')return fail('This model covers one loaded 40HC container. Other equipment requires a quotation.');
    if(['reefer','dangerous','oversize'].includes(input.cargo))return fail('This cargo requires an operator quotation. Refrigeration, dangerous-goods and out-of-gauge surcharges are not covered.');
    if(input.weight>24)return fail('The initial model covers standard dry cargo up to 24 tonnes. Request a weight-specific quotation for heavier cargo; this is a model limit, not a container loading limit.');
    if(['aktau','kuryk'].includes(input.from)&&['aktau','kuryk'].includes(input.to))return fail('For local repositioning between Aktau and Kuryk, request a port or road transfer quotation. The corridor rail model is not suitable.');
    if(!data)return fail('Loading the shared market dataset…');
    const refs=references(data,live),edges=graph(refs.weights),route=path(input.from,input.to,edges);
    if(!route)return fail('A connected corridor routing is not available.');
    if(route.km<80)return fail('This short terminal or border movement needs a local handling quotation. Long-distance freight allocation is not suitable here.');
    const warnings=['The displayed path is illustrative, not confirmation of a bookable service, terminal or sailing.',
      'One loaded dry 40HC container. Container ownership/provision is not specified in the market assessments; SOC/COC differences are not priced separately.',
      'Standard non-hazardous cargo categories share the same base model. No unsupported commodity or weight surcharge is applied within the model band.'];
    const common={route:route.cities.map(id=>byId[id]),warnings,weight:input.weight,cargo:input.cargo,modelVersion:'1.0 · 15 Oct 2026',feedLive:refs.useLive,
      exclusions:['First/last-mile trucking','Duties, VAT, cargo insurance and inspections','Storage, demurrage and exceptional handling','Any terminal or container-provision charges not included in the cited source']};
    let quote=input.from==='xian'&&input.to==='alat'?refs.baku:input.from==='xian'&&['istanbul','mersin'].includes(input.to)?refs.turkey:null;
    if(quote){
      if(input.to!=='alat')warnings.push('The published assessment groups Ambarli and Mersin; no separate port differential is available.');
      return {...common,kind:'assessment',low:quote.low,high:quote.high,mid:quote.mid,period:quote.period,confidence:'Published market range',
        explanation:'Exact corridor assessment, shown in its original range. It is not an executable booking quote and does not verify your cargo weight or terminal-specific extras.',
        sources:[{name:quote.source_name||'Published market assessment',url:quote.source_url,period:quote.period}],components:[]};
    }
    const reverse=byId[input.from].lon<byId[input.to].lon;
    const anchors=[['alat',refs.baku],['istanbul',refs.turkey]].filter(([,q])=>q).map(([destination,q])=>{
      const p=path('xian',destination,edges),keys=new Set(p.edges.map(e=>e.key));
      return {q,p,overlap:route.edges.filter(e=>keys.has(e.key)).reduce((n,e)=>n+e.cost,0)/route.cost};
    }).sort((a,b)=>b.overlap-a.overlap||b.q.period.localeCompare(a.q.period)||a.p.cost-b.p.cost);
    if(!anchors.length)return fail('No valid market assessment is available to calibrate the route model. Request a quotation.');
    const anchor=anchors[0],blacksea=route.edges.some(e=>e.kind==='blacksea');
    const monthDate=new Date(anchor.q.period+'-01T00:00:00Z'),age=Math.max(0,(now-monthDate)/86400000);
    const uncertainty=Math.min(.85,.35+(reverse?.15:0)+(blacksea?.20:0)+(anchor.overlap<.6?.10:0)+(age>90?.10:0));
    const mid=Math.max(50,Math.round((route.cost*anchor.q.mid/anchor.p.cost)/50)*50);
    const low=Math.max(50,Math.floor(mid*(1-uncertainty)/50)*50),high=Math.ceil(mid*(1+uncertainty)/50)*50;
    const grouped={};for(const e of route.edges)grouped[e.kind]=(grouped[e.kind]||0)+e.cost;
    const entries=Object.entries(grouped);let allocated=0;
    const components=entries.map(([kind,cost],i)=>{const value=i===entries.length-1?mid-allocated:Math.round(mid*cost/route.cost);allocated+=value;return {label:labels[kind],value};});
    if(reverse)warnings.push('Eastbound/reverse movement: calibrated from westbound prices. Direction-specific pricing is unavailable and the uncertainty band is wider.');
    if(blacksea)warnings.push('Black Sea crossing is an unverified sea-cost proxy; this branch has no direct market calibration. Port charges and service availability require confirmation.');
    if(route.edges.some(e=>e.a==='aktau'&&e.b==='alat'))warnings.push('Aktau–Alat sea cost is a proxy from the Kuryk ferry reference, not a published Aktau tariff.');
    if(age>90)warnings.push('The market anchor is over 90 days old. Its period is retained and the uncertainty band is widened.');
    return {...common,kind:'model',low,high,mid,period:anchor.q.period,confidence:'Low · modelled estimate',components,
      explanation:`Indicative path using rail-distance and sea-cost allocations, calibrated to the ${anchor.q.period} Xi’an–${byId[anchor.p.cities.at(-1)].name} market assessment. The ±${Math.round(uncertainty*100)}% model allowance is a scenario assumption, not a statistical confidence interval.`,
      sources:[{name:anchor.q.source_name||'Market calibration',url:anchor.q.source_url,period:anchor.q.period},...refs.sources]};
  }
  return {nodes,estimate,references,version:'1.0'};
});
