#!/usr/bin/env python3
import json, os, urllib.parse, urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data.json'
API='https://api.vesselfinder.com'
KEY=os.getenv('VESSELFINDER_API_KEY','').strip()

def get(path, params):
    q=urllib.parse.urlencode(params)
    req=urllib.request.Request(f'{API}/{path}?{q}',headers={'User-Agent':'MCI-Aktau-Monitor/0.7'})
    with urllib.request.urlopen(req,timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))

def vessel_type(code):
    try: c=int(code or 0)
    except: c=0
    if 70<=c<=79:return 'cargo'
    if 80<=c<=89:return 'tanker'
    if 60<=c<=69:return 'passenger'
    if c in (51,52):return 'tug'
    if 40<=c<=49:return 'high-speed'
    return 'other'

def main():
    d=json.loads(DATA.read_text())
    d['meta']['published_at']=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
    ais=d.setdefault('ais',{})
    if not KEY:
        ais['status']='not_configured' if not ais.get('updated_at') else 'stale'
        DATA.write_text(json.dumps(d,indent=2,ensure_ascii=False)+'\n')
        return
    try:
        # LiveData area is configured in the VesselFinder subscription. Do not expose the API key client-side.
        live=get('livedata',{'userkey':KEY,'format':'json','interval':30})
        records=live if isinstance(live,list) else []
        stopped=0; mix={}
        for row in records:
            a=row.get('AIS',{})
            speed=float(a.get('SPEED') or 0)
            nav=int(a.get('NAVSTAT') or -1)
            if speed<=0.5 or nav in (1,5): stopped+=1
            k=vessel_type(a.get('TYPE')); mix[k]=mix.get(k,0)+1
        pc7=get('portcalls',{'userkey':KEY,'format':'json','interval':10080,'locode':'KZAAU','anchorage':1,'limit':1000})
        calls=pc7 if isinstance(pc7,list) else []
        now=datetime.now(timezone.utc); cutoff=now-timedelta(hours=24)
        a24=d24=a7=d7=0
        for row in calls:
            p=row.get('PORTCALL',{})
            ev=str(p.get('EVENT','')).lower(); ts=p.get('TIMESTAMP','').replace(' UTC','')
            try: dt=datetime.strptime(ts,'%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
            except: dt=None
            if ev=='arrival': a7+=1
            elif ev=='departure': d7+=1
            if dt and dt>=cutoff:
                if ev=='arrival': a24+=1
                elif ev=='departure': d24+=1
        ais.update({'provider':'VesselFinder','port_locode':'KZAAU','status':'live','updated_at':now.isoformat().replace('+00:00','Z'),'vessels_in_area':len(records),'stopped_or_anchored':stopped,'arrivals_24h':a24,'departures_24h':d24,'arrivals_7d':a7,'departures_7d':d7,'vessel_mix':mix})
    except Exception as e:
        ais['status']='stale' if ais.get('updated_at') else 'error'
        ais['last_error']=type(e).__name__
    DATA.write_text(json.dumps(d,indent=2,ensure_ascii=False)+'\n')
if __name__=='__main__': main()
