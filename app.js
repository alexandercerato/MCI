const fmtInt=n=>Number(n).toLocaleString('en-US');
const money=n=>'$'+Number(n).toLocaleString('en-US',{maximumFractionDigits:0});
const pct=n=>(n>0?'+':'')+Number(n).toFixed(1)+'%';
let DATA=null;

async function load(){
  try{
    const r=await fetch('data.json?ts='+Date.now()); if(!r.ok) throw new Error('HTTP '+r.status);
    DATA=await r.json(); render();
  }catch(e){ document.getElementById('updateState').textContent='data file unavailable'; }
}
function render(){
  const ix=DATA.index,c=DATA.corridor,t=DATA.transit,ca=DATA.caspian;
  set('mciIndex',Number(ix.current_index).toFixed(1)); set('basePeriod',ix.base_period.toUpperCase());
  set('mciPrice',money(ix.current_usd_feu)); set('fixingPeriod',ix.current_period);
  const delta=document.getElementById('mciDelta');
  delta.textContent=ix.change_mom_pct==null?'BASE PERIOD':`${pct(ix.change_mom_pct)} MoM`;
  set('teuYtd',fmtInt(c.teu_ytd)+' TEU');set('teuPeriod',c.period);set('teuYoy',pct(c.yoy_pct));
  set('blockTrains',fmtInt(c.block_trains));set('trainGrowth',pct(c.block_trains_yoy_pct)+' YoY');
  set('transitDays',t.reference_days+' days');set('transitRoute',t.route);set('westShare',c.westbound_share_pct.toFixed(1)+'%');
  set('westTeu',fmtInt(c.westbound_teu)+' TEU');set('eastTeu',fmtInt(c.eastbound_teu)+' TEU');
  document.getElementById('westBar').style.width=c.westbound_share_pct+'%';document.getElementById('eastBar').style.width=(100-c.westbound_share_pct)+'%';
  set('caspianTeu',fmtInt(ca.aktau_alat_teu)+' TEU');set('caspianPeriod',ca.latest_month);set('caspianYoy','+'+ca.yoy_pct+'%');set('distance',fmtInt(t.distance_km)+' km');
  const dt=new Date(DATA.meta.generated_at); const stamp=isNaN(dt)?DATA.meta.generated_at:dt.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
  set('lastUpdated',stamp);set('footerUpdated','Source check '+stamp);
  const u=DATA.meta.update_results; set('updateState',u ? Object.entries(u).map(([k,v])=>`${k}: ${v===true?'ok':v===false?'no change':v}`).join(' · ') : 'verified snapshot');
  document.getElementById('componentStrip').innerHTML=ix.components.map(x=>`<div class="ref"><div class="top"><span>${x.code} · ${(x.weight*100).toFixed(0)}%</span><span>${x.period}</span></div><strong>${money(x.mid)} / FEU</strong><small>${x.lane}</small></div>`).join('');
  document.getElementById('laneRows').innerHTML=ix.components.map(x=>`<tr><td><strong>${x.code}</strong></td><td>${x.lane}</td><td>${(x.weight*100).toFixed(0)}%</td><td>${money(x.low)}–${money(x.high)}</td><td><strong>${money(x.mid)}</strong></td><td>${x.period}</td></tr>`).join('');
  renderLog(); drawIndex();
}
function set(id,v){const el=document.getElementById(id);if(el)el.textContent=v}
function renderLog(){if(!DATA)return; const q=(document.getElementById('searchBox').value||'').toLowerCase();const ty=document.getElementById('typeFilter').value;const rows=DATA.log.filter(r=>(ty==='all'||r.type===ty)&&Object.values(r).join(' ').toLowerCase().includes(q));document.getElementById('logRows').innerHTML=rows.map(r=>`<tr><td>${r.date}</td><td>${r.type}</td><td>${r.lane}</td><td><strong>${r.value}</strong></td><td>${r.source}</td></tr>`).join('')||'<tr><td colspan="5">No matching records.</td></tr>'}
function drawIndex(){const c=document.getElementById('indexChart');if(!c||!DATA)return;const xs=DATA.index.history;const dpr=devicePixelRatio||1,W=c.clientWidth||900,H=180;c.width=W*dpr;c.height=H*dpr;c.style.height=H+'px';const x=c.getContext('2d');x.scale(dpr,dpr);x.clearRect(0,0,W,H);const p={l:8,r:8,t:22,b:28};let vals=xs.map(d=>d.index);let lo=Math.min(...vals),hi=Math.max(...vals);if(lo===hi){lo-=4;hi+=4}else{lo-=2;hi+=2}x.strokeStyle='#c9c4b9';x.lineWidth=1;for(let i=0;i<4;i++){const y=p.t+(H-p.t-p.b)*i/3;x.beginPath();x.moveTo(p.l,y);x.lineTo(W-p.r,y);x.stroke()}const px=i=>p.l+(W-p.l-p.r)*(xs.length===1?.5:i/(xs.length-1));const py=v=>p.t+(hi-v)/(hi-lo)*(H-p.t-p.b);x.strokeStyle='#ef5a29';x.lineWidth=3;x.beginPath();xs.forEach((d,i)=>{const X=px(i),Y=py(d.index);i?x.lineTo(X,Y):x.moveTo(X,Y)});x.stroke();xs.forEach((d,i)=>{x.fillStyle='#151515';x.beginPath();x.arc(px(i),py(d.index),4,0,Math.PI*2);x.fill();x.font='10px DM Mono';x.textAlign='center';x.fillText(d.period,px(i),H-8);x.fillText(d.index.toFixed(1),px(i),py(d.index)-10)});x.textAlign='left'}
['searchBox','typeFilter'].forEach(id=>document.getElementById(id).addEventListener('input',renderLog));
window.addEventListener('resize',()=>{clearTimeout(window.__rz);window.__rz=setTimeout(drawIndex,100)});load();
