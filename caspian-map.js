(function(){
  const model=window.MCI_CASPIAN_DATA;
  let map=null,layer=null,coverage=null,snapshot=null,requestPending=false,feedError=false,selected='all';
  let markers=new Map();
  const $=id=>document.getElementById(id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stamp=value=>model.positionTime(value)?new Date(value).toLocaleString('en-GB',{timeZone:'Europe/Rome',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})+' Rome':'AIS timestamp unavailable';
  const stateLabel={recent:'Recent · within 30 min',last_known:'Last known · within 24 h',historical:'Historical position',unverified:'Position time unverified'};
  function rows(){
    const dedup=new Map();
    const reports=Array.isArray(snapshot?.all_vessels)?snapshot.all_vessels:Array.isArray(snapshot?.vessels)?snapshot.vessels:[];
    for(const row of reports){
      if(!row||typeof row!=='object')continue;
      const lat=model.number(row.lat),lon=model.number(row.lon),mmsi=String(row.mmsi||'');
      if(!/^[1-9]\d{8}$/.test(mmsi)||!model.inside(lat,lon))continue;
      const v={...row,lat,lon,mmsi,zone:model.zoneFor(lat,lon),freshness:model.classify(row)};
      dedup.set(mmsi,model.mergePosition(dedup.get(mmsi),v));
    }
    return [...dedup.values()].sort((a,b)=>(Date.parse(b.last_seen)||0)-(Date.parse(a.last_seen)||0)||String(a.name||a.mmsi).localeCompare(String(b.name||b.mmsi)));
  }
  function matchesPort(row){return selected==='all'||selected==='west'?selected==='all'||['Alat','Baku'].includes(row.zone):row.zone===selected;}
  function visibleRows(all){
    const period=$('caspianPositionAge').value,query=$('caspianVesselSearch').value.trim().toLowerCase();
    return all.filter(v=>matchesPort(v)&&(period==='all'||v.freshness==='recent'||period==='day'&&v.freshness==='last_known')&&(!query||String(v.name||'').toLowerCase().includes(query)||v.mmsi.includes(query)));
  }
  function draw(){
    if(!map)return;
    const all=rows(),recent=all.filter(v=>v.freshness==='recent'),visible=visibleRows(all);
    $('caspianMapStatus').textContent=feedError?'Feed unavailable':recent.length?'Recent AIS available':'Awaiting recent AIS';
    $('caspianMapStatus').className='caspian-status'+(!feedError&&recent.length?' has-data':'');
    $('caspianMapSource').textContent=snapshot?.provider?`Sources · ${snapshot.provider}`:'AIS source not connected';
    $('caspianReportCount').textContent=String(recent.length);
    $('caspianRecentMeta').textContent=recent.length?'positions received within 30 min':'no recent reports · coverage unverified';
    for(const [id,zones] of [['caspianAktauCount',['Aktau']],['caspianKurykCount',['Kuryk']],['caspianBakuCount',['Baku','Alat']]]){
      const count=recent.filter(v=>zones.includes(v.zone)).length;
      $(id).textContent=count?String(count):'—';
    }
    const openVessel=[...markers].find(([,marker])=>marker.isPopupOpen())?.[0];
    layer.clearLayers();markers=new Map();
    for(const v of visible){
      const title=`${v.name||v.mmsi} · ${stateLabel[v.freshness]}`;
      const marker=L.circleMarker([v.lat,v.lon],{radius:7,weight:2,color:v.freshness==='recent'?'#365f51':v.freshness==='last_known'?'#9a762f':'#737b78',
        fillColor:v.freshness==='recent'?'#365f51':'#fcfdfc',fillOpacity:v.freshness==='recent'?.9:.75}).addTo(layer);
      const speed=model.number(v.sog);
      marker.bindTooltip(escape(title));
      marker.bindPopup(`<div class="caspian-popup"><strong>${escape(v.name||v.mmsi)}</strong><span>MMSI ${escape(v.mmsi)}</span><b>${escape(stateLabel[v.freshness])}</b><span>${escape(stamp(v.last_seen))}</span><span>${speed!==null?escape(speed.toFixed(1))+' kn':'Speed unavailable'}${v.destination?' · '+escape(v.destination):''}</span><small>${escape(v.source||'AIS provider')}${v.data_source?' · '+escape(v.data_source):''}</small></div>`);
      markers.set(v.mmsi,marker);
    }
    if(openVessel)markers.get(openVessel)?.openPopup();
    const listMarkup=visible.length?visible.map(v=>`<button type="button" class="caspian-ship" data-mmsi="${escape(v.mmsi)}"><span><strong>${escape(v.name||v.mmsi)}</strong><small>${escape(v.zone||'Caspian Sea')} · ${escape(v.source||'AIS')}</small></span><span class="caspian-ship-state ${v.freshness}">${escape(stateLabel[v.freshness])}<small>${escape(stamp(v.last_seen))}</small></span></button>`).join(''):`<div class="caspian-no-ships"><strong>${feedError?'The vessel feed is unavailable.':'No positions match this view.'}</strong><span>${all.length?'Change the time filter to inspect older reports.':'Port markers show reference locations; they are not vessel positions.'}</span></div>`;
    if($('caspianVesselList').innerHTML!==listMarkup)$('caspianVesselList').innerHTML=listMarkup;
    $('caspianVisibleCount').textContent=`${visible.length} shown${snapshot?.reports_truncated?' · feed limited to 500 reports':''}`;
    $('caspianMapNotice').hidden=visible.length>0;
    $('caspianMapNotice').textContent=feedError?'Vessel feed unavailable. Port locations remain visible.':recent.length?'No vessel positions match the selected filters.':'No recent AIS positions in this feed. This does not establish absence of traffic.';
    coverage.clearLayers();
    for(const area of snapshot?.datadocked?.areas||[]){
      if(!area.fetched_at||area.error)continue;
      L.circle([area.lat,area.lon],{radius:area.radiusKm*1000,color:'#647a70',weight:1,dashArray:'4 7',fillOpacity:.025}).addTo(coverage)
        .bindPopup(`<strong>${escape(area.name)}</strong><br>Data Docked discovery area · ${escape(area.radiusKm)} km<br>Retrieved ${escape(stamp(area.fetched_at))}<br>Receiver coverage can be incomplete.`);
    }
  }
  function focus(id){
    selected=id;
    document.querySelectorAll('[data-caspian-focus]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.caspianFocus===id)));
    if(id==='all')map.fitBounds([[model.bounds.south,model.bounds.west],[model.bounds.north,model.bounds.east]],{padding:[22,22]});
    else if(id==='west')map.fitBounds([[39.65,49.05],[40.65,50.25]],{padding:[28,28]});
    else {const port=model.ports.find(p=>p.id===id);map.setView([port.lat,port.lon],10);}
    draw();
  }
  async function load(){
    const base=String(window.MCFM_CONFIG?.aisApiBase||'').replace(/\/$/,'');
    if(requestPending||!base)return;
    requestPending=true;
    try{
      const response=await fetch(`${base}/api/caspian`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('AIS feed unavailable');
      const data=await response.json();
      if(!Array.isArray(data.vessels))throw new Error('AIS payload invalid');
      snapshot=data;feedError=false;
    }catch{feedError=true;}finally{requestPending=false;draw();}
  }
  function init(){
    if(map){map.invalidateSize();draw();return;}
    if(!window.L||!model||!$('caspianInteractiveMap'))return;
    map=L.map('caspianInteractiveMap',{scrollWheelZoom:false,minZoom:5,maxZoom:12,zoomSnap:.25,
      maxBounds:[[30,30],[56,72]],maxBoundsViscosity:1});
    map.createPane('caspianLand');map.getPane('caspianLand').style.zIndex=200;
    map.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/">Natural Earth</a> · regional basemap');
    L.control.scale({imperial:false,position:'bottomleft',maxWidth:110}).addTo(map);
    fetch('assets/caspian-basemap.geojson').then(response=>{if(!response.ok)throw new Error('Basemap unavailable');return response.json();}).then(data=>{
      L.geoJSON(data,{pane:'caspianLand',interactive:false,style:{color:'#c9d1cc',weight:1,fillColor:'#f2f3ef',fillOpacity:1}}).addTo(map);
      const labels=L.layerGroup();
      for(const feature of data.features){const p=feature.properties;if(p.label_lat){
        L.marker([p.label_lat,p.label_lon],{interactive:false,keyboard:false,icon:L.divIcon({className:'caspian-country-label',html:escape(p.name),iconSize:[110,18],iconAnchor:[55,9]})}).addTo(labels);
      }}
      L.marker([41.6,50.8],{interactive:false,keyboard:false,icon:L.divIcon({className:'caspian-sea-label',html:'CASPIAN SEA',iconSize:[130,20],iconAnchor:[65,10]})}).addTo(labels);
      const showLabels=()=>{if(map.getZoom()<8)labels.addTo(map);else labels.remove();};map.on('zoomend',showLabels);showLabels();
    }).catch(()=>{$('caspianMapNotice').textContent='Regional basemap unavailable. Vessel coordinates remain independent of the map background.';});
    coverage=L.layerGroup().addTo(map);layer=L.layerGroup().addTo(map);
    for(const port of model.ports){
      L.circleMarker([port.lat,port.lon],{radius:4,color:'#242a27',fillColor:'#242a27',fillOpacity:1,weight:1}).addTo(map)
        .bindTooltip(escape(port.name),{permanent:true,direction:port.id==='Alat'?'bottom':'right',className:'caspian-port-label'})
        .bindPopup(`<strong>${escape(port.name)}</strong><br>${escape(port.country)}<br>Reference port location · not a vessel`);
    }
    document.querySelectorAll('[data-caspian-focus]').forEach(button=>button.addEventListener('click',()=>focus(button.dataset.caspianFocus)));
    $('caspianPositionAge').addEventListener('change',draw);$('caspianVesselSearch').addEventListener('input',draw);
    $('caspianVesselList').addEventListener('click',event=>{const id=event.target.closest('[data-mmsi]')?.dataset.mmsi,marker=markers.get(id);if(marker){map.setView(marker.getLatLng(),11);marker.openPopup();}});
    focus('all');load();
    setInterval(()=>{if(!$('caspian-live').hidden)load();},30000);
    setInterval(()=>{if(!$('caspian-live').hidden)draw();},15000);
  }
  window.MCI_CASPIAN_MAP={init};
})();
