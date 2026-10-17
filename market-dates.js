/* Dated price freshness shared by the browser and regression checks. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MCI_MARKET_DATES=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function isRecentPrice(quote,now=Date.now(),days=45){
    let date;
    if(quote.published_at)date=Date.parse(quote.published_at);
    else if(/^20\d{2}-(0[1-9]|1[0-2])$/.test(quote.period||'')){
      // Month-only references remain conservative; no publication day is invented.
      date=Date.UTC(Number(quote.period.slice(0,4)),Number(quote.period.slice(5))-1,1);
    }else date=Date.parse(quote.date||quote.period);
    return Number.isFinite(date)&&date<=now&&now-date<=days*86400000;
  }
  return {isRecentPrice};
});
