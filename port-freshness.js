/* The source bulletin date and a successful retrieval are separate clocks. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MCI_PORT_FRESHNESS=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const dayMs=86400000;
  function bulletinDay(value){
    const m=String(value||'').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\.?$/);
    if(!m)return null;
    const [d,month,y]=m.slice(1).map(Number),stamp=Date.UTC(y,month-1,d),date=new Date(stamp);
    return date.getUTCFullYear()===y&&date.getUTCMonth()===month-1&&date.getUTCDate()===d?stamp:null;
  }
  function evaluatePortReport(report,now=Date.now()){
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
    const today=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day));
    const day=bulletinDay(report?.traffic_date),age=day===null?null:Math.round((today-day)/dayMs);
    const date_status=age===null?'unknown':age<0?'future':age===0?'current':age===1?'previous_day':'stale';
    const fetched=Date.parse(report?.fetched_at||''),fetch_age_ms=now-fetched;
    const fetch_recent=Number.isFinite(fetched)&&fetch_age_ms>=0&&fetch_age_ms<=15*60000&&!report?.fetch_error;
    const is_current=date_status==='current'&&fetch_recent;
    const can_display=day!==null&&age>=0;
    const label=is_current?'Today’s official bulletin':date_status==='current'?'Today’s bulletin · cached / source unavailable':date_status==='previous_day'?'Previous-day bulletin':date_status==='stale'?'Historical bulletin':date_status==='future'?'Future-dated bulletin · unverified':'Bulletin date unverified';
    return {date_status,age_days:age,fetch_recent,is_current,can_display,label};
  }
  return {bulletinDay,evaluatePortReport};
});
