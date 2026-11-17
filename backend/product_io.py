"""商品外部资源：仅访问公开 HTTPS 地址，逐跳校验并限制响应大小。"""
import asyncio,hashlib,ipaddress,json,os,socket,struct
from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit,urljoin,parse_qsl,urlencode,urlunsplit
import httpx
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]/'.runtime/products'
MEDIA=ROOT/'media';MEDIA.mkdir(parents=True,exist_ok=True)
USER_AGENT='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
class ProductError(ValueError):pass

def product_key(url):
    """缓存按商品+SKU去重，移除营销参数；不合并不同款式。"""
    import re
    p=urlsplit(clean_link(url));query=parse_qsl(p.query,keep_blank_values=True)
    if re.search(r'(?:^|\.)(?:taobao|tmall)\.com$',p.hostname or ''):
        query=[(k,v) for k,v in query if k in ('id','skuId','sku_id')]
    else:query=[(k,v) for k,v in query if not k.lower().startswith('utm_') and k.lower() not in ('gclid','fbclid','spm')]
    return urlunsplit((p.scheme,p.netloc.lower(),p.path,urlencode(sorted(query)),''))

def clean_link(text):
    import re,html
    match=re.search(r'https://[^\s<>"「」]+',text or '')
    if not match:raise ProductError('请粘贴 HTTPS 商品详情链接或含链接的分享文本。')
    value=html.unescape(match.group()).rstrip('，。；、）)】]')
    parsed=urlsplit(value)
    if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None,443):raise ProductError('商品链接地址无效。')
    return value

async def public_url(url):
    p=urlsplit(url)
    if p.scheme!='https' or not p.hostname or p.username or p.password or p.port not in (None,443):raise ProductError('仅支持公开 HTTPS 商品资源。')
    host=p.hostname.rstrip('.').lower()
    if host=='localhost' or host.endswith(('.local','.localhost','.internal')):raise ProductError('不能读取本机或内网地址。')
    try:
        entries=await asyncio.get_running_loop().getaddrinfo(host,443,type=socket.SOCK_STREAM)
        if not entries or any(not ipaddress.ip_address(x[4][0]).is_global for x in entries):raise ProductError('不能读取本机或内网地址。')
    except socket.gaierror:raise ProductError('商品域名暂时无法解析，请重试。')
    return url

async def fetch_public(url,limit=5_000_000,referer=None,cookies=None):
    headers={'User-Agent':USER_AGENT,'Accept-Language':'zh-CN,zh;q=0.9,en;q=0.7'}
    if referer:headers['Referer']=referer
    async with httpx.AsyncClient(timeout=httpx.Timeout(22,connect=10),follow_redirects=False,trust_env=False,cookies=cookies) as client:
        for _ in range(7):
            await public_url(url)
            async with client.stream('GET',url,headers=headers) as r:
                if r.status_code in (301,302,303,307,308):
                    location=r.headers.get('location')
                    if not location:raise ProductError('商品跳转地址缺失。')
                    url=urljoin(url,location);continue
                if r.status_code in (401,403,429):raise ProductError('商品站要求登录、验证或稍后重试。')
                if r.status_code>=400:raise ProductError(f'商品页面暂不可用（{r.status_code}）。')
                data=bytearray()
                async for chunk in r.aiter_bytes():
                    data.extend(chunk)
                    if len(data)>limit:raise ProductError('商品资源超过大小限制。')
                return bytes(data),str(r.url),r.headers.get('content-type','')
    raise ProductError('商品链接跳转次数过多。')

async def cache_image(url,referer=None,cookies=None):
    data,actual,ctype=await fetch_public(url,10_000_000,referer,cookies=cookies)
    try:
        with Image.open(BytesIO(data)) as img:
            if img.width*img.height>40_000_000 or min(img.size)<80:raise ProductError('图片尺寸不适合作为商品主图。')
            img=img.convert('RGB');img.thumbnail((1600,1600));out=BytesIO();img.save(out,'JPEG',quality=90);data=out.getvalue()
    except (OSError,ValueError):raise ProductError('商品图片无法读取，请在商品浏览器中登录后重试。')
    key=hashlib.sha256(data).hexdigest()+'.jpg';path=MEDIA/key
    if not path.exists():path.write_bytes(data)
    return {'url':'/api/products/media/'+key,'sourceUrl':actual,'width':img.width,'height':img.height}

async def cache_model(url,referer=None):
    data,actual,_=await fetch_public(url,35_000_000,referer)
    if len(data)<20 or data[:4]!=b'glTF' or struct.unpack_from('<I',data,4)[0]!=2 or struct.unpack_from('<I',data,8)[0]!=len(data):raise ProductError('商品页提供的文件不是有效的 GLB 2.0 模型。')
    length,kind=struct.unpack_from('<II',data,12)
    if kind!=0x4E4F534A or length>len(data)-20:raise ProductError('商品模型结构无效。')
    try:doc=json.loads(data[20:20+length])
    except ValueError:raise ProductError('商品模型结构无效。')
    if any(item.get('uri') and not item['uri'].startswith('data:') for item in doc.get('buffers',[])+doc.get('images',[])):raise ProductError('商品模型包含外部依赖，当前不能安全完整导入。')
    if not doc.get('meshes') or len(doc.get('nodes',[]))>5000:raise ProductError('商品模型无法在当前场景中加载。')
    key=hashlib.sha256(data).hexdigest()+'.glb';(MEDIA/key).write_bytes(data)
    return {'id':'source-model','type':'source_model','label':'商品页提供的3D模型','url':'/api/products/media/'+key,'sourceUrl':actual,'note':'来源为此商品页，款式、比例及材质仍需与商品图核对。'}
