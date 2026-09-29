import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8787);
const API_KEY = process.env.AISSTREAM_API_KEY || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const boundsParts = String(process.env.CASPIAN_BOUNDS || '39.0,48.0,45.2,53.0').split(',').map(Number);
const BOUNDS = boundsParts.length === 4 && boundsParts.every(Number.isFinite)
  ? { south: boundsParts[0], west: boundsParts[1], north: boundsParts[2], east: boundsParts[3] }
  : { south: 39.0, west: 48.0, north: 45.2, east: 53.0 };

const PORTS = {
  Aktau: { lat: 43.64, lon: 51.17, radiusNm: 15 },
  Kuryk: { lat: 43.18, lon: 51.66, radiusNm: 15 },
  Alat:  { lat: 39.95, lon: 49.39, radiusNm: 15 },
  Baku:  { lat: 40.30, lon: 49.92, radiusNm: 15 }
};

const EAST_ZONES = new Set(['Aktau','Kuryk']);
const WEST_ZONES = new Set(['Alat','Baku']);
const STALE_MS = 30 * 60 * 1000;
const HARD_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_PUBLIC_VESSELS = 50;

fs.mkdirSync(DATA_DIR, { recursive: true });
const crossingFile = path.join(DATA_DIR, 'crossings.json');
let crossings = readJson(crossingFile, []);
if (!Array.isArray(crossings)) crossings = [];

const vessels = new Map();
const journeyStarts = new Map();
const trackerSince = new Date().toISOString();
let wsState = API_KEY ? 'connecting' : 'not_configured';
let lastMessageAt = null;
let reconnectTimer = null;
let reconnectAttempt = 0;

function readJson(file, fallback){
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function persistCrossings(){
  try { fs.writeFileSync(crossingFile, JSON.stringify(crossings.slice(-1000), null, 2)); } catch {}
}
function toRad(d){ return d * Math.PI / 180; }
function distanceNm(aLat,aLon,bLat,bLon){
  const R = 3440.065;
  const dLat = toRad(bLat-aLat), dLon=toRad(bLon-aLon);
  const q = Math.sin(dLat/2)**2 + Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(q));
}
function zoneFor(lat,lon){
  for(const [name,p] of Object.entries(PORTS)){
    if(distanceNm(lat,lon,p.lat,p.lon) <= p.radiusNm) return name;
  }
  return null;
}
function normalizeCourse(cog){
  const n=Number(cog); if(!Number.isFinite(n)) return null;
  return ((n%360)+360)%360;
}
function courseDirection(cog,sog){
  if(!Number.isFinite(Number(sog)) || Number(sog)<1.5) return 'Stationary';
  const c=normalizeCourse(cog); if(c===null) return 'Underway';
  if(c>=190 && c<=330) return 'Westbound';
  if(c>=10 && c<=150) return 'Eastbound';
  return 'Underway';
}
function corridorCandidate(v){
  if(v.zone) return true;
  const dest=(v.destination||'').toUpperCase();
  if(/AKTAU|KURYK|ALAT|BAKU|BAKI/.test(dest)) return true;
  const d=courseDirection(v.cog,v.sog);
  return Number(v.sog)>=3 && (d==='Westbound'||d==='Eastbound') && v.lat>=39.3 && v.lat<=44.8 && v.lon>=48.4 && v.lon<=52.7;
}
function median(nums){
  const a=nums.filter(Number.isFinite).sort((x,y)=>x-y); if(!a.length) return null;
  const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function inferCrossing(mmsi, prevZone, newZone, now){
  if(!newZone || newZone===prevZone) return;
  const side = EAST_ZONES.has(newZone) ? 'east' : WEST_ZONES.has(newZone) ? 'west' : null;
  if(!side) return;
  const start=journeyStarts.get(mmsi);
  if(start && start.side!==side){
    const hours=(now-start.at)/3600000;
    if(hours>=4 && hours<=72){
      crossings.push({mmsi:String(mmsi), from:start.zone, to:newZone, departed_at:new Date(start.at).toISOString(), arrived_at:new Date(now).toISOString(), hours:Number(hours.toFixed(2))});
      persistCrossings();
    }
    journeyStarts.delete(mmsi);
  }
  journeyStarts.set(mmsi,{side,zone:newZone,at:now});
}
function parsePosition(event){
  const meta=event?.MetaData||{};
  const body=event?.Message?.[event.MessageType]||{};
  const lat=Number(meta.Latitude ?? body.Latitude), lon=Number(meta.Longitude ?? body.Longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)) return null;
  const mmsi=String(meta.MMSI ?? body.UserID ?? '');
  if(!mmsi) return null;
  return {
    mmsi,
    name: String(meta.ShipName || '').trim() || null,
    lat, lon,
    sog: Number.isFinite(Number(body.Sog)) ? Number(body.Sog) : null,
    cog: Number.isFinite(Number(body.Cog)) ? Number(body.Cog) : null,
    heading: Number.isFinite(Number(body.TrueHeading)) ? Number(body.TrueHeading) : null
  };
}
function applyStatic(event){
  const meta=event?.MetaData||{};
  const body=event?.Message?.[event.MessageType]||{};
  const mmsi=String(meta.MMSI ?? body.UserID ?? '');
  if(!mmsi) return;
  const old=vessels.get(mmsi)||{mmsi};
  const destination=body.Destination || body.DestinationName || old.destination || null;
  const next={...old,
    name:String(meta.ShipName || body.Name || old.name || '').trim()||null,
    destination:destination ? String(destination).trim() : null,
    imo:body.ImoNumber || body.IMO || old.imo || null,
    call_sign:body.CallSign || old.call_sign || null,
    ship_type:body.Type ?? body.ShipType ?? old.ship_type ?? null
  };
  vessels.set(mmsi,next);
}
function handleEvent(event){
  lastMessageAt=new Date().toISOString();
  if(event?.MessageType==='SubscriptionConfirmation') { wsState='live'; reconnectAttempt=0; return; }
  if(event?.MessageType==='ShipStaticData' || event?.MessageType==='StaticDataReport'){ applyStatic(event); return; }
  if(!['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport','LongRangeAisBroadcastMessage'].includes(event?.MessageType)) return;
  const pos=parsePosition(event); if(!pos) return;
  const now=Date.now(), old=vessels.get(pos.mmsi)||{};
  const newZone=zoneFor(pos.lat,pos.lon), prevZone=old.zone||null;
  inferCrossing(pos.mmsi,prevZone,newZone,now);
  const next={...old,...pos,zone:newZone,last_seen:new Date(now).toISOString()};
  next.direction=courseDirection(next.cog,next.sog);
  next.corridor_candidate=corridorCandidate(next);
  vessels.set(pos.mmsi,next);
}
function cleanup(){
  const cutoff=Date.now()-HARD_TTL_MS;
  for(const [m,v] of vessels){ if(!v.last_seen || new Date(v.last_seen).getTime()<cutoff) vessels.delete(m); }
}
function connectAIS(){
  if(!API_KEY){wsState='not_configured';return;}
  if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
  wsState='connecting';
  const ws=new WebSocket('wss://stream.aisstream.io/v0/stream',{perMessageDeflate:true});
  ws.on('open',()=>{
    ws.send(JSON.stringify({
      APIKey:API_KEY,
      BoundingBoxes:[[[BOUNDS.south,BOUNDS.west],[BOUNDS.north,BOUNDS.east]]],
      FilterMessageTypes:['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport','LongRangeAisBroadcastMessage','ShipStaticData','StaticDataReport']
    }));
  });
  ws.on('message',raw=>{
    try{ handleEvent(JSON.parse(raw.toString('utf8'))); }catch{}
  });
  ws.on('error',()=>{ wsState='offline'; });
  ws.on('close',()=>{
    wsState='offline';
    const delay=Math.min(60000,1000*(2**Math.min(reconnectAttempt++,6)))+Math.floor(Math.random()*500);
    reconnectTimer=setTimeout(connectAIS,delay);
  });
}

function publicSnapshot(){
  cleanup();
  const cutoff=Date.now()-STALE_MS;
  const recent=[...vessels.values()].filter(v=>v.last_seen && new Date(v.last_seen).getTime()>=cutoff);
  recent.forEach(v=>{v.direction=courseDirection(v.cog,v.sog);v.corridor_candidate=corridorCandidate(v);});
  recent.sort((a,b)=>Number(b.corridor_candidate)-Number(a.corridor_candidate) || Number(b.sog||0)-Number(a.sog||0));
  const sum={
    vessels_30m:recent.length,
    underway:recent.filter(v=>Number(v.sog)>=1.5).length,
    near_aktau:recent.filter(v=>v.zone==='Aktau').length,
    near_kuryk:recent.filter(v=>v.zone==='Kuryk').length,
    near_alat:recent.filter(v=>v.zone==='Alat').length,
    near_baku:recent.filter(v=>v.zone==='Baku').length,
    westbound:recent.filter(v=>v.corridor_candidate&&v.direction==='Westbound').length,
    eastbound:recent.filter(v=>v.corridor_candidate&&v.direction==='Eastbound').length
  };
  const cutoff7=Date.now()-7*86400000;
  const c7=crossings.filter(c=>new Date(c.arrived_at).getTime()>=cutoff7);
  return {
    status:wsState,
    provider:'AISStream',
    updated_at:lastMessageAt,
    tracker_since:trackerSince,
    bounds:BOUNDS,
    summary:sum,
    crossings:{count:c7.length,median_hours:median(c7.map(c=>Number(c.hours)))},
    vessels:recent.slice(0,MAX_PUBLIC_VESSELS).map(v=>({
      mmsi:v.mmsi,name:v.name,lat:v.lat,lon:v.lon,sog:v.sog,cog:v.cog,heading:v.heading,
      zone:v.zone,direction:v.direction,corridor_candidate:v.corridor_candidate,destination:v.destination||null,last_seen:v.last_seen
    }))
  };
}

const app=express();
app.disable('x-powered-by');
app.use(cors({origin:ALLOWED_ORIGIN==='*'?true:ALLOWED_ORIGIN}));
app.get('/api/health',(_req,res)=>res.json({ok:true,status:wsState,provider:'AISStream',last_message_at:lastMessageAt}));
app.get('/api/caspian',(_req,res)=>{res.set('Cache-Control','no-store');res.json(publicSnapshot());});
app.get('/',(_req,res)=>res.type('text').send('MCFI Caspian AIS backend'));

app.listen(PORT,()=>{
  console.log(`MCFI AIS backend listening on :${PORT}`);
  connectAIS();
});

setInterval(cleanup,5*60*1000).unref();
