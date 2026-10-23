/* Shared map rules: a retrieval timestamp never substitutes for an AIS timestamp. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MCI_CASPIAN_DATA=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const bounds={south:36,west:46,north:47.5,east:55};
  const ports=[
    {id:'Aktau',name:'Aktau',country:'Kazakhstan',lat:43.64,lon:51.17},
    {id:'Kuryk',name:'Kuryk',country:'Kazakhstan',lat:43.18,lon:51.66},
    {id:'Alat',name:'Port of Baku · Alat',country:'Azerbaijan',lat:39.95,lon:49.39},
    {id:'Baku',name:'Baku bay',country:'Azerbaijan',lat:40.30,lon:49.92}
  ];
  const areas=[
    {id:'east-gateways',name:'Aktau / Kuryk discovery',lat:43.4,lon:51.4,radiusKm:50},
    {id:'west-gateways',name:'Baku / Alat discovery',lat:40.2,lon:49.7,radiusKm:50}
  ];
  function number(value){return value===null||value===undefined||String(value).trim()===''?null:Number.isFinite(Number(value))?Number(value):null;}
  function valid(value,min,max){const n=number(value);return n!==null&&n>=min&&n<max?n:null;}
  function inside(lat,lon){return number(lat)!==null&&number(lon)!==null&&lat>=bounds.south&&lat<=bounds.north&&lon>=bounds.west&&lon<=bounds.east;}
  function distanceKm(a,b){
    const rad=x=>x*Math.PI/180,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
    const q=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
    return 12742*Math.asin(Math.min(1,Math.sqrt(q)));
  }
  function zoneFor(lat,lon){return ports.map(p=>({id:p.id,d:distanceKm({lat,lon},p)})).sort((a,b)=>a.d-b.d).find(p=>p.d<=15*1.852)?.id||null;}
  function positionTime(value,now=Date.now()){
    const s=String(value||'').trim();
    const iso=s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/);
    const human=s.match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{2}):(\d{2})(?::(\d{2}))? UTC$/);
    if(!iso&&!human)return null;
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const [y,m,d,h,min,sec]=iso?[+iso[1],+iso[2],+iso[3],+iso[4],+iso[5],+(iso[6]||0)]:[+human[3],months.indexOf(human[1])+1,+human[2],+human[4],+human[5],+(human[6]||0)];
    const calendar=new Date(Date.UTC(y,m-1,d,h,min,sec));
    if(y<1970||calendar.getUTCFullYear()!==y||calendar.getUTCMonth()!==m-1||calendar.getUTCDate()!==d||h>23||min>59||sec>59)return null;
    const stamp=iso?Date.parse(s):calendar.getTime();
    return Number.isFinite(stamp)&&stamp<=now?new Date(stamp).toISOString():null;
  }
  function classify(v,now=Date.now()){
    const stamp=positionTime(v?.last_seen,now);
    if(!stamp)return 'unverified';
    const age=now-Date.parse(stamp);
    return age<=30*60000?'recent':age<=24*3600000?'last_known':'historical';
  }
  function normalizeDataDocked(row,{kind='area',observedAt,now=Date.now(),expectedMmsi}={}){
    const mmsi=String(row?.mmsi||expectedMmsi||'').trim(),lat=number(row?.latitude),lon=number(row?.longitude);
    if(!/^[1-9]\d{8}$/.test(mmsi)||expectedMmsi&&mmsi!==String(expectedMmsi)||!inside(lat,lon))return null;
    const speed=number(row.speed);
    return {mmsi,name:String(row.name||mmsi).trim(),lat,lon,
      sog:valid(speed===null?null:kind==='area'?speed/10:speed,0,102.3),
      cog:valid(row.course,0,360),heading:valid(row.heading,0,360),
      last_seen:positionTime(row.positionReceived,now),observed_at:observedAt||new Date(now).toISOString(),
      destination:row.destination?String(row.destination):null,ship_type:row.typeSpecific||null,
      nav_status:row.navigationalStatus||null,source:'Data Docked',data_source:row.dataSource||null,zone:zoneFor(lat,lon)};
  }
  function mergePosition(previous,next){
    if(!previous)return next;
    const a=Date.parse(previous.last_seen||''),b=Date.parse(next.last_seen||'');
    if(Number.isFinite(a)&&(!Number.isFinite(b)||b<a))return previous;
    return next;
  }
  return {bounds,ports,areas,number,inside,distanceKm,zoneFor,positionTime,classify,normalizeDataDocked,mergePosition};
});
