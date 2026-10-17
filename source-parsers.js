// Pure parsers: source-specific sections must never leak into one another.
export function parseKurykText(text, splitNames) {
  const traffic_date = text.match(/Vessel traffic as of\s+([0-9.]+)/i)?.[1]?.replace(/\.$/, '') || null;
  const sections = text.split(/Vessels at anchorage|Approaching vessels|Port Kuryk:/i);
  const berthText = sections[0];
  const anchorStart = text.search(/Vessels at anchorage/i);
  const approachStart = text.search(/Approaching vessels/i);
  const end = text.search(/Port Kuryk:/i);
  const anchorageText = anchorStart < 0 ? '' : text.slice(anchorStart, approachStart > anchorStart ? approachStart : (end > anchorStart ? end : undefined));
  const approachText = approachStart < 0 ? '' : text.slice(approachStart, end > approachStart ? end : undefined);
  const berthed = [...berthText.matchAll(/Berth No\.\s+(.+?)\s+Vessel name\s+(.+?)\s+Berthing time\s+([0-9.]+\s*\/\s*[0-9:]+)\s+Operation type\s+(.+?)(?=Berth No\.|$)/gi)].map(m=>({berth:m[1].trim(),vessel_names:splitNames(m[2]),berthing_time:m[3].trim(),operation:m[4].trim()}));
  const anchored = [...anchorageText.matchAll(/Vessel name\s+(.+?)\s+Date and time\s+([0-9.]+\s*\/\s*[0-9:]+)/gi)].map(m=>({vessel_name:splitNames(m[1])[0]||m[1].trim(),reported_time:m[2].trim()}));
  const approaching = [...approachText.matchAll(/Vessel name\s+(.+?)\s+Date and time of vessel approach\s+([0-9.]+\s*\/\s*[0-9:]+)/gi)].map(m=>({vessel_name:splitNames(m[1])[0]||m[1].trim(),eta:m[2].trim()}));
  if (!traffic_date || (!berthed.length && !anchored.length && !approaching.length)) throw new Error('Port Kuryk dated vessel sections were not parsed');
  return {traffic_date,berthed,anchored,approaching};
}

export function wideSafeCard(text, periodFromText) {
  const block = text.match(/FCL\s+SOC\s+40HQ\s+Rates\s+to\s+Baku[\s\S]{0,7000}/i)?.[0];
  if (!block) return null; // Current redesigned listing has no published card.
  const period = periodFromText(block);
  if (!period) throw new Error('WideSafe price card has no explicit assessment month');
  return {block,period};
}

// Prefer the publisher's own article body and publication timestamp over
// unrelated headlines, navigation dates or the time our monitor checks it.
export function articleSnapshot(html, decode) {
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value=JSON.parse(match[1]);
      const nodes=Array.isArray(value)?value:value['@graph']||[value];
      const article=nodes.find(x=>[].concat(x['@type']||[]).some(t=>/^(NewsArticle|Article)$/.test(t))&&x.articleBody);
      if (article) return {text:decode(article.articleBody),published_at:validPublication(article.datePublished)};
    } catch { /* Try the next metadata block; invalid metadata is not evidence. */ }
  }
  const body=html.slice(Math.max(0,html.search(/<h1\b/i))).split(/Similar news/i)[0];
  return {text:decode(body),published_at:null};
}
function validPublication(value) {
  if (!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value||'')) return null;
  const date=new Date(value);
  return Number.isFinite(date.getTime())&&date.getTime()<=Date.now()?date.toISOString():null;
}
export function parseMarketRanges(text, periodFromText) {
  const period=periodFromText(text);
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period||'') || period>new Date().toISOString().slice(0,7)) throw new Error('Valid assessment month not found');
  const extract=re=>{
    const m=text.match(re); if(!m) return null;
    const low=Number(m[1].replace(/,/g,'')),high=Number(m[2].replace(/,/g,''));
    if (!(low>0&&high>=low)) throw new Error('Invalid market assessment range');
    return {period,low_usd:low,high_usd:high,midpoint_usd:(low+high)/2};
  };
  const baku=extract(/Alat\s+or\s+Absheron[\s\S]{0,350}?\$\s*([0-9,]+)\s*[–—-]\s*\$\s*([0-9,]+)/i);
  const turkey=extract(/Ambarli\s+and\s+Mersin[\s\S]{0,350}?\$\s*([0-9,]+)\s*[–—-]\s*\$\s*([0-9,]+)/i);
  if(!baku&&!turkey) throw new Error('No comparable route market range found');
  return {baku,turkey};
}
