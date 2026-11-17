"""本地商品浏览器：动态详情与用户自行登录后的续读，不自动处理登录/验证码。"""
import asyncio,json,os,re,time
from urllib.parse import urlsplit,parse_qs
from playwright.async_api import async_playwright,TimeoutError as BrowserTimeout,Error as BrowserError
from backend.product_io import ROOT,public_url,ProductError,USER_AGENT
from backend.product_parser import parse_product

class ProductBrowserError(ProductError):
    def __init__(self,code,message,diagnostics=None):
        super().__init__(message);self.code=code;self.diagnostics=diagnostics or {}

def same_product(left,right):
    a,b=urlsplit(left),urlsplit(right)
    merchant=lambda host:bool(re.search(r'(?:^|\.)(?:taobao|tmall)\.com$',host or ''))
    if merchant(a.hostname) and merchant(b.hostname):
        x,y=parse_qs(a.query),parse_qs(b.query)
        return bool(x.get('id') and x.get('id')==y.get('id') and (not y.get('skuId') or not x.get('skuId') or x['skuId']==y['skuId']))
    return (a.scheme,a.netloc,a.path,a.query)==(b.scheme,b.netloc,b.path,b.query)

def read_diagnostics(snapshot,url,payloads):
    p=urlsplit(url);state=snapshot.get('pageState',{})
    codes=[str(code)[:180] for payload in payloads for code in (payload.get('ret',[]) if isinstance(payload.get('ret'),list) else [])][:12]
    return {'host':p.hostname,'path':p.path,'loginPage':bool(re.search(r'^(?:login|passport|reg)\.',p.hostname or '') or state.get('loginVisible')),'verificationPage':bool(state.get('verificationVisible') or any(re.search('VALIDATE|CAPTCHA|RGV587',code,re.I) for code in codes)),'apiCodes':codes,'productHeading':bool(snapshot.get('title')),'visibleTextChars':len(snapshot.get('text','')),'capturedProductResponses':len(payloads)}

DOM_SCRIPT='''() => {
 const root=document.querySelector('main,[role="main"],#J_DetailMeta,[class*="ProductDetail"],[class*="ItemDetail"]')||document.body;
 const selected=document.querySelector('input[name="id"][value],input[name="skuId"][value],input[name="sku_id"][value],[data-sku-id][aria-selected="true"],[data-sku-id][aria-pressed="true"]');
 const h=document.querySelector('h1,[class*="ItemTitle"],[class*="mainTitle"]');
 const visible=n=>!!n&&(n.getClientRects().length>0);
 return {title:h?.innerText?.slice(0,300)||'',text:root.innerText.slice(0,65000),selectedVariantId:selected?.value||selected?.getAttribute('data-sku-id')||null,
  pageState:{loginVisible:[...document.querySelectorAll('input[type="password"],input[name="fm-login-id"]')].some(visible),verificationVisible:[...document.querySelectorAll('#nc_1_wrapper,#baxia-dialog-content,[id*="captcha"]')].some(visible)},
  variantLabel:[...document.querySelectorAll('[aria-checked="true"],[aria-selected="true"],select[name*="option"] option:checked')].slice(0,12).map(n=>n.innerText||n.getAttribute('aria-label')||'').join(' / ')};
}'''
class ProductBrowser:
    def __init__(self):
        self.driver=None;self.context=None;self.headful=False;self.pages={};self.lock=asyncio.Lock();self.save_lock=asyncio.Lock();self.payloads={};self.pending=set();self.autosave=None
    async def persist_session(self):
        async with self.save_lock:
            context=self.context
            if not context:return
            try:
                state=await context.storage_state();folder=ROOT/'session';folder.mkdir(parents=True,exist_ok=True);os.chmod(folder,0o700)
                path=folder/'state.json';temp=folder/'state.tmp';temp.write_text(json.dumps(state));os.chmod(temp,0o600);temp.replace(path)
            except BrowserError:pass
    async def save_loop(self):
        try:
            while self.context:
                await self.persist_session();await asyncio.sleep(3)
        except (asyncio.CancelledError,OSError):pass
    async def restore_session(self):
        path=ROOT/'session/state.json'
        if not path.exists():return
        try:
            state=json.loads(path.read_text());cookies=[c for c in state.get('cookies',[]) if c.get('expires',-1)<0 or c.get('expires',0)>time.time()]
            if cookies:await self.context.add_cookies(cookies)
            origins={o['origin']:o.get('localStorage',[]) for o in state.get('origins',[]) if str(o.get('origin','')).startswith('https://')}
            if origins:await self.context.add_init_script('(()=>{const saved='+json.dumps(origins)+';for(const item of saved[location.origin]||[]){if(localStorage.getItem(item.name)===null)localStorage.setItem(item.name,item.value);}})();')
        except (OSError,ValueError,KeyError,BrowserError):pass
    def watch(self,page):
        if page in self.payloads:return
        self.payloads[page]=[]
        async def collect(response):
            path=urlsplit(response.url).path
            if not re.search(r'mtop\.[^/]*(?:detail\.(?:getdetail|getdesc)|pcdetail|sku)|/products/[^/]+\.js$',path,re.I):return
            try:
                body=await response.body()
                if len(body)>2_000_000:return
                raw=body.decode('utf-8');start,end=raw.find('{'),raw.rfind('}')
                value=json.loads(raw[start:end+1])
                if isinstance(value,dict):
                    cached=self.payloads.setdefault(page,[]);api=value.get('api')
                    if api:cached[:]=[p for p in cached if p.get('api')!=api]
                    cached.append(value);cached.sort(key=lambda p:0 if re.search('getdetail|pcdetail',str(p.get('api','')),re.I) else 1)
                    self.payloads[page]=cached[:10]
            except Exception:pass
        def response_handler(response):
            task=asyncio.create_task(collect(response));self.pending.add(task);task.add_done_callback(self.pending.discard)
        page.on('response',response_handler)
        page.on('close',lambda:self.payloads.pop(page,None))
    async def ensure(self,headful=False):
        if self.context and (self.headful or not headful):return
        if self.context:await self.persist_session();await self.context.close();self.context=None;self.pages={}
        if not self.driver:self.driver=await async_playwright().start()
        profile=ROOT/'browser-profile';profile.mkdir(parents=True,exist_ok=True);os.chmod(profile,0o700)
        try:self.context=await self.driver.chromium.launch_persistent_context(str(profile),headless=not headful,user_agent=USER_AGENT,viewport={'width':1280,'height':900},locale='zh-CN',accept_downloads=False)
        except Exception:raise ProductError('商品浏览器未就绪，请安装 Playwright Chromium 后重试。')
        self.context.on("close",lambda: self.reset_context())
        self.headful=headful
        async def guard(route):
            url=route.request.url
            if url.startswith(('data:','blob:','about:')):await route.continue_();return
            try:await public_url(url);await route.continue_()
            except (ValueError,OSError):await route.abort()
        await self.context.route('**/*',guard)
        await self.restore_session()
        self.context.on('page',self.watch)
        for page in self.context.pages:self.watch(page)
        self.autosave=asyncio.create_task(self.save_loop())
    def reset_context(self):
        self.context=None;self.pages={};self.headful=False;self.payloads={}
        if self.autosave:self.autosave.cancel();self.autosave=None
    async def image_cookies(self,url):
        """仅取此图片域名适用的登录凭证，在后端续读，不返回前端。"""
        import httpx
        if not self.context:return None
        await public_url(url)
        jar=httpx.Cookies()
        for cookie in await self.context.cookies([url]):
            jar.set(cookie['name'],cookie['value'],domain=cookie['domain'],path=cookie.get('path','/'))
        return jar if len(jar) else None
    async def park(self,key):
        """提取完成后仅收起本应用的商品窗口，不重新导航，也不关闭登录会话。"""
        if not self.headful or not self.context:return
        page=self.pages.get(key)
        if not page or page.is_closed():return
        session=None
        try:
            session=await self.context.new_cdp_session(page)
            window=await session.send('Browser.getWindowForTarget')
            await session.send('Browser.setWindowBounds',{'windowId':window['windowId'],'bounds':{'windowState':'minimized'}})
        except BrowserError:pass
        finally:
            if session:await session.detach()
    async def open(self,key,url):
        async with self.lock:
            await public_url(url);await self.ensure(True)
            page=self.pages.get(key)
            matching=next((p for p in self.context.pages if not p.is_closed() and same_product(p.url,url)),None)
            if matching:page=matching
            elif not page or page.is_closed():page=await self.context.new_page()
            self.pages[key]=page
            self.watch(page)
            if page.url=='about:blank':await page.goto(url,wait_until='domcontentloaded',timeout=30000)
            await page.bring_to_front();await self.persist_session()
            return {'opened':True,'message':'已打开商品浏览器。请自行登录或完成验证，返回后点击“重新读取”。'}
    async def read(self,key,url):
        async with self.lock:
            await public_url(url);await self.ensure()
            page=self.pages.get(key)
            matching=next((p for p in self.context.pages if not p.is_closed() and same_product(p.url,url)),None)
            if matching:page=matching
            elif not page or page.is_closed():page=await self.context.new_page()
            self.pages[key]=page
            self.watch(page)
            try:
                # 续读已登录页面，而不是每次刷新登录流程；监听从open开始，不漏掉登录后的详情响应。
                previous=await page.evaluate(DOM_SCRIPT) if page.url!='about:blank' else {}
                blocked=read_diagnostics(previous,page.url,[])
                if page.url=='about:blank' or (not same_product(page.url,url) and not blocked['loginPage'] and not blocked['verificationPage']):await page.goto(url,wait_until='domcontentloaded',timeout=30000)
                deadline=time.monotonic()+12
                while True:
                    snapshot=await page.evaluate(DOM_SCRIPT);markup=await page.content();payloads=list(self.payloads.get(page,[]))
                    diagnostics=read_diagnostics(snapshot,page.url,payloads);snapshot['diagnostics']=diagnostics
                    if parse_product(markup,page.url,snapshot,payloads)['recognized'] or diagnostics['loginPage'] or diagnostics['verificationPage'] or time.monotonic()>=deadline:break
                    await asyncio.sleep(.4)
                await self.persist_session()
                return markup[:5_000_000],page.url,snapshot,payloads
            except BrowserTimeout:raise ProductBrowserError('page_timeout','商品页面加载超时，尚未读取到详情；原场景保留。')
            except BrowserError:raise ProductBrowserError('browser_closed' if page.is_closed() or not self.context else 'browser_error','商品浏览器已关闭或页面加载异常，未完成读取；这不是“未登录”的判断。')
    async def close(self):
        if self.context:await self.persist_session();await self.context.close();self.context=None
        if self.driver:await self.driver.stop();self.driver=None

product_browser=ProductBrowser()
