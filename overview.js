/* Overview composition. Uses the same dated assessment dataset as the index. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const usd=n=>Number.isFinite(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n):'—';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const month=p=>/^\d{4}-\d{2}$/.test(p||'')?new Date(Number(p.slice(0,4)),Number(p.slice(5))-1,1).toLocaleDateString('en-GB',{month:'short',year:'numeric'}):'—';
  const ordinal=p=>Number(p.slice(0,4))*12+Number(p.slice(5))-1;
  const percent=(value,base)=>Number.isFinite(value)&&Number.isFinite(base)&&base>0?(value/base-1)*100:null;
  const pct=n=>n===null?'—':(n>=0?'+':'−')+Math.abs(n).toFixed(2)+'%';
  const rowsOf=data=>(data?.mcfi_monthly||[]).filter(r=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(r.period||'')&&Number.isFinite(Number(r.mcfi_usd))&&Number(r.mcfi_usd)>0).map(r=>({...r,value:Number(r.mcfi_usd)})).sort((a,b)=>a.period.localeCompare(b.period));
  let dataset=null,range='all';
  function text(id,value){const el=$(id);if(el)el.textContent=value;}
  function metrics(data){
    const q=data?.headline?.latest_mcfi_core;
    if(!q||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(q.period||''))return null;
    const low=Number(q.low_usd),high=Number(q.high_usd),value=Number(q.value_usd);
    if(![low,high,value].every(Number.isFinite)||low<=0||high<low||value<low||value>high)return null;
    const rows=rowsOf(data).filter(r=>r.period<q.period);
    const previous=rows.at(-1)||null;
    const priorYear=Number(q.period.slice(0,4))-1;
    const december=rows.find(r=>r.period===priorYear+'-12');
    const annual=rows.find(r=>r.period===priorYear+q.period.slice(4));
    return {q,value,low,high,previous,change:previous?value-previous.value:null,changePct:previous?percent(value,previous.value):null,ytd:december?percent(value,december.value):null,yoy:annual?percent(value,annual.value):null};
  }
  function update(data){
    dataset=data;
    const m=metrics(data);
    if(!m){text('overviewPeriod','No comparable full-route assessment');drawChart();return;}
    const sign=m.change!==null&&m.change<0?'−':'+';
    text('overviewChange',m.change===null?'No prior observation':(m.change>=0?'↗ ':'↘ ')+sign+usd(Math.abs(m.change))+' ('+pct(m.changePct)+')');
    text('overviewChangeMeta',m.previous?'vs '+month(m.previous.period)+' assessment':'');
    text('overviewPeriod','Latest assessment · '+month(m.q.period));
    text('overviewRange',usd(m.low)+' – '+usd(m.high));
    text('overviewRangeLow',usd(m.low));text('overviewRangeHigh',usd(m.high));
    text('overviewPreviousLabel',m.previous?'Previous · '+month(m.previous.period):'Previous observation');
    text('overviewPrevious',m.previous?usd(m.previous.value):'—');
    text('overviewYtd',pct(m.ytd));text('overviewYoy',pct(m.yoy));
    text('overviewSnapshotPeriod',month(m.q.period));
    const yearButton=document.querySelector('[data-overview-range="year"]');
    if(yearButton)yearButton.textContent=m.q.period.slice(0,4);
    const track=document.querySelector('.instrument-range-track');
    if(track){
      const position=m.high>m.low?100*(m.value-m.low)/(m.high-m.low):50;
      track.style.setProperty('--range-position',position+'%');
      track.title='Index midpoint within the published range';
    }
    drawChart();
  }
  function svgNode(tag,attributes={},value){
    const e=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [key,val] of Object.entries(attributes))e.setAttribute(key,String(val));
    if(value!==undefined)e.textContent=value;
    return e;
  }
  function visibleRows(){
    const m=metrics(dataset);
    let rows=rowsOf(dataset).filter(r=>!m||r.period<=m.q.period);
    if(!rows.length)return rows;
    const last=rows.at(-1),lastOrdinal=ordinal(last.period);
    if(range==='year')rows=rows.filter(r=>r.period.slice(0,4)===last.period.slice(0,4));
    const length={'3m':3,'6m':6,'1y':12}[range];
    if(length)rows=rows.filter(r=>ordinal(r.period)>=lastOrdinal-length+1);
    return rows;
  }
  function hideTip(){const t=$('overviewTooltip');if(t)t.hidden=true;}
  function showTip(event,row){
    const tip=$('overviewTooltip'),shell=document.querySelector('.overview-chart-shell');
    if(!tip||!shell)return;
    tip.innerHTML='<strong>'+escape(usd(row.value))+' / 40HC</strong>'+escape(month(row.period))+'<span>Published range '+escape(usd(Number(row.low_usd)))+'–'+escape(usd(Number(row.high_usd)))+'</span>';
    tip.hidden=false;
    const box=shell.getBoundingClientRect();
    const point=event.currentTarget?.getBoundingClientRect?.();
    const x=Number.isFinite(event.clientX)?event.clientX:(point?.left||box.left)+8;
    const y=Number.isFinite(event.clientY)?event.clientY:(point?.top||box.top)+8;
    tip.style.left=Math.max(8,Math.min(box.width-tip.offsetWidth-8,x-box.left+12))+'px';
    tip.style.top=Math.max(4,Math.min(box.height-tip.offsetHeight-4,y-box.top-18))+'px';
  }
  function drawChart(){
    const svg=$('overviewChart');if(!svg)return;
    hideTip();
    while(svg.firstChild)svg.removeChild(svg.firstChild);
    const rows=visibleRows(),empty=$('overviewChartEmpty');
    if(empty)empty.hidden=rows.length>0;
    svg.hidden=rows.length===0;if(!rows.length)return;
    const narrow=window.matchMedia('(max-width:620px)').matches;
    const W=narrow?420:1000,H=narrow?290:290,pad={l:12,r:74,t:22,b:38};
    svg.setAttribute('viewBox','0 0 '+W+' '+H);
    const first=ordinal(rows[0].period),last=ordinal(rows.at(-1).period);
    const span=Math.max(1,last-first),width=W-pad.l-pad.r,height=H-pad.t-pad.b;
    const values=rows.map(r=>r.value),step=narrow?1000:500;
    const min=Math.max(0,Math.floor((Math.min(...values)-200)/step)*step);
    const max=Math.ceil((Math.max(...values)+200)/step)*step;
    const x=r=>pad.l+(rows.length===1?.5:(ordinal(r.period)-first)/span)*width;
    const y=v=>pad.t+(max-v)/(max-min||1)*height;
    for(let value=min;value<=max;value+=step){
      svg.appendChild(svgNode('line',{x1:pad.l,y1:y(value),x2:W-pad.r,y2:y(value),class:'overview-grid-line'}));
      svg.appendChild(svgNode('text',{x:W-pad.r+12,y:y(value)+4,class:'overview-axis'},value.toLocaleString('en-US')));
    }
    let group=[];
    const paint=()=>{
      if(group.length>1){
        const line=group.map((r,i)=>(i?'L':'M')+x(r).toFixed(2)+' '+y(r.value).toFixed(2)).join(' ');
        const area=line+' L '+x(group.at(-1)).toFixed(2)+' '+(H-pad.b)+' L '+x(group[0]).toFixed(2)+' '+(H-pad.b)+' Z';
        svg.appendChild(svgNode('path',{d:area,class:'overview-series-fill'}));
        svg.appendChild(svgNode('path',{d:line,class:'overview-series-line'}));
      }
      group=[];
    };
    rows.forEach((r,i)=>{if(i&&ordinal(r.period)-ordinal(rows[i-1].period)>1)paint();group.push(r);});paint();
    const current=rows.at(-1);
    svg.appendChild(svgNode('line',{x1:pad.l,y1:y(current.value),x2:W-pad.r,y2:y(current.value),class:'overview-chart-target'}));
    svg.appendChild(svgNode('rect',{x:W-pad.r+6,y:y(current.value)-12,width:66,height:24,rx:3,class:'overview-chart-tag'}));
    svg.appendChild(svgNode('text',{x:W-pad.r+39,y:y(current.value)+4,'text-anchor':'middle',class:'overview-chart-tag-text'},current.value.toLocaleString('en-US')));
    rows.forEach(r=>{
      const dot=svgNode('circle',{cx:x(r),cy:y(r.value),r:r===current?4:3,tabindex:0,role:'button',class:'overview-chart-point','aria-label':month(r.period)+': '+usd(r.value)+' per 40HC'});
      dot.addEventListener('mouseenter',event=>showTip(event,r));
      dot.addEventListener('mousemove',event=>showTip(event,r));
      dot.addEventListener('click',event=>showTip(event,r));
      dot.addEventListener('focus',event=>showTip(event,r));
      dot.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();showTip(event,r);}if(event.key==='Escape')hideTip();});
      dot.addEventListener('mouseleave',hideTip);dot.addEventListener('blur',hideTip);
      svg.appendChild(dot);
    });
    const totalTicks=narrow?3:5;
    const indices=[...new Set(Array.from({length:Math.min(totalTicks,rows.length)},(_,i)=>Math.round(i*(rows.length-1)/Math.max(1,Math.min(totalTicks,rows.length)-1))))];
    indices.forEach((index,i)=>{
      const r=rows[index],anchor=i===0?'start':i===indices.length-1?'end':'middle';
      svg.appendChild(svgNode('text',{x:x(r),y:H-10,'text-anchor':anchor,class:'overview-axis'},month(r.period)));
    });
    svg.setAttribute('aria-label','MCFI-40 monthly market assessments from '+month(rows[0].period)+' to '+month(current.period)+'. Missing months remain gaps.');
  }
  function updateNews(data){
    const target=$('overviewNews');if(!target)return;
    const now=Date.now();
    const items=(data?.items||[]).filter(item=>{
      const date=new Date(item.published_at).getTime();
      return Number.isFinite(date)&&date<=now&&now-date<=30*86400000;
    }).sort((a,b)=>new Date(b.published_at)-new Date(a.published_at)).slice(0,3);
    const safeURL=value=>{try{const u=new URL(value);return /^https?:$/.test(u.protocol)?escape(u.href):'#';}catch{return '#';}};
    target.innerHTML=items.length?items.map(item=>{
      const date=new Date(item.published_at);
      const stamp=date.toLocaleString('en-GB',{timeZone:'Europe/Rome',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});
      return '<article class="overview-news-item"><div class="overview-news-meta"><time datetime="'+escape(date.toISOString())+'">'+escape(stamp)+' Rome</time><span>'+escape(item.source||'News')+(data.status==='live'?'':' · cached reporting')+'</span></div><h3><a href="'+safeURL(item.url)+'" target="_blank" rel="noopener">'+escape(item.title)+'</a></h3></article>';
    }).join(''):'<p class="overview-placeholder">Recent reporting is temporarily unavailable. <a href="#news">Open news →</a></p>';
  }
  document.querySelectorAll('[data-overview-range]').forEach(button=>button.addEventListener('click',()=>{
    range=button.dataset.overviewRange;
    document.querySelectorAll('[data-overview-range]').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    drawChart();
  }));
  let resizeFrame=0;
  window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(drawChart);});
  window.MCI_OVERVIEW={update,updateNews};
})();
