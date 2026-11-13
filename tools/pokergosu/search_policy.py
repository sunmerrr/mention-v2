"""Bounded, expiring keyword discovery using the site's public search pages."""
import json
import math
from urllib.parse import urlparse,parse_qs,unquote,quote,urlencode

ORIGIN='https://www.pokergosu.com'


def search_url(value):
    if not isinstance(value,str) or len(value)>600:raise ValueError('INVALID_SEARCH_URL')
    u=urlparse(value)
    if u.scheme!='https' or u.netloc!='www.pokergosu.com' or u.path!='/free/search' or u.fragment:raise ValueError('INVALID_SEARCH_URL')
    q=parse_qs(u.query,keep_blank_values=True)
    if set(q)!={'s','v'} or any(len(v)!=1 for v in q.values()) or q['s'][0] not in ('1','4'):raise ValueError('INVALID_SEARCH_URL')
    term=unquote(q['v'][0],errors='strict')
    if not 2<=len(term)<=20 or term!=term.strip() or any(ord(c)<32 for c in term):raise ValueError('INVALID_SEARCH_TERM')
    return {'term':term,'scope':q['s'][0],'url':value}


def strategy(directory,cycle,now):
    filename=directory/'search-policy.json'
    if not filename.exists():return {'mode':'board'}
    config=json.loads(filename.read_text())
    if not isinstance(config,dict):raise ValueError('INVALID_SEARCH_POLICY')
    if config.get('enabled') is not True:return {'mode':'board'}
    start,end=config.get('startsAt'),config.get('expiresAt')
    if any(type(v) not in (int,float) or not math.isfinite(v) for v in (start,end)) or not 0<end-start<=86400000:raise ValueError('INVALID_SEARCH_POLICY')
    if not start<=now*1000<end:return {'mode':'board'}
    terms=config.get('terms');first=config.get('startCycle')
    if not isinstance(terms,list) or not 1<=len(terms)<=30 or type(first) is not int or first<1 or len(set(terms))!=len(terms):raise ValueError('INVALID_SEARCH_POLICY')
    for term in terms:
        if not isinstance(term,str) or not 2<=len(term)<=20 or term!=term.strip() or any(ord(c)<32 for c in term):raise ValueError('INVALID_SEARCH_TERM')
    if cycle<first:return {'mode':'board'}
    offset=cycle-first;term=terms[offset%len(terms)];scope=('1','4')[(offset//len(terms))%2]
    url=ORIGIN+'/free/search?'+urlencode({'s':scope,'v':quote(term,safe="~!*'()")})
    return {'mode':'search',**search_url(url),'expiresAt':end}


def configure_today(directory,terms,cycle,now):
    import datetime,os
    kst=datetime.timezone(datetime.timedelta(hours=9))
    current=datetime.datetime.fromtimestamp(now,kst)
    midnight=datetime.datetime.combine(current.date()+datetime.timedelta(days=1),datetime.time(),kst)
    config={'enabled':True,'startsAt':now*1000,'expiresAt':midnight.timestamp()*1000,'terms':terms,'startCycle':cycle}
    # Validate before publishing a configuration atomically.
    temporary=directory/'search-policy.pending'
    temporary.write_text(json.dumps(config,ensure_ascii=False));os.chmod(temporary,0o600)
    # Term validation is independent of policy activation time.
    if not isinstance(terms,list) or not 1<=len(terms)<=30 or any(not isinstance(t,str) or not 2<=len(t)<=20 or t!=t.strip() or any(ord(c)<32 for c in t) for t in terms) or len(set(terms))!=len(terms):
        temporary.unlink();raise ValueError('INVALID_SEARCH_TERM')
    if type(cycle) is not int or cycle<1:temporary.unlink();raise ValueError('INVALID_SEARCH_CYCLE')
    os.replace(temporary,directory/'search-policy.json')
    return config
