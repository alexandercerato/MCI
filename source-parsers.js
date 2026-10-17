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
