import asyncio,json,os,tempfile,time,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock,Mock,patch
from backend.product_browser import ProductBrowser,ProductBrowserError,same_product,read_diagnostics
from backend.products import read_product
from backend.product_parser import parse_product

PRODUCT='<h1>测试商品</h1><script type="application/ld+json">{"@type":"Product","name":"测试椅子","image":"https://cdn.example.com/chair.jpg","sku":"A"}</script>'
class PageStub(SimpleNamespace):
 __hash__=object.__hash__

class SessionTests(unittest.IsolatedAsyncioTestCase):
 def test_ice_ssr_local_json_assignment_is_parsed_without_executing_script(self):
  data={'loaderData':{'item':{'data':{'item':{'title':'测试单人沙发','images':['https://cdn.example.com/main.jpg']},'skuBase':{'props':[{'pid':'1','name':'颜色分类','values':[{'vid':'2','name':'原野绿','image':'https://cdn.example.com/green.jpg'}]}],'skus':[{'skuId':'34','propPath':'1:2'}]},'skuCore':{'sku2info':{'34':{'price':{'priceText':'2210'}}}}}}}}
  script='window.__ICE_APP_CONTEXT__ = window.__ICE_APP_CONTEXT__ || {};var b = '+json.dumps(data)+';Object.assign(window.__ICE_APP_CONTEXT__,b);throw new Error("never execute");'
  result=parse_product('<script>'+script+'</script>','https://detail.tmall.com/item.htm?id=12&skuId=34')
  self.assertTrue(result['recognized']);self.assertEqual(result['selectedVariantId'],'34');self.assertEqual(result['variants'][0]['color'],'原野绿')
 def test_ice_json_parse_escaped_state_is_data_only(self):
  data={'product':{'@type':'Product','name':'测试灯','sku':'A','image':'https://cdn.example.com/lamp.jpg'}}
  text='<script>window.__ICE_APP_CONTEXT__=JSON.parse('+json.dumps(json.dumps(data))+');</script>'
  self.assertTrue(parse_product(text,'https://shop.example.com/p')['recognized'])
 async def test_product_response_is_not_evicted_by_unrelated_detail_referrer(self):
  handlers={};page=PageStub(on=lambda name,handler:handlers.update({name:handler}))
  reader=ProductBrowser();reader.watch(page)
  main=SimpleNamespace(url='https://h5api.m.tmall.com/h5/mtop.taobao.detail.getdetail/6.0/',body=AsyncMock(return_value=b'{"api":"mtop.taobao.detail.getdetail","data":{"item":{}},"ret":["SUCCESS"]}'))
  handlers['response'](main)
  unrelated=[]
  for _ in range(20):
   response=SimpleNamespace(url='https://h5api.m.tmall.com/h5/mtop.taobao.coupon.get/1.0/?referer=detail',body=AsyncMock(return_value=b'{}'));unrelated.append(response);handlers['response'](response)
  await asyncio.gather(*list(reader.pending))
  self.assertEqual(len(reader.payloads[page]),1);self.assertEqual(reader.payloads[page][0]['api'],'mtop.taobao.detail.getdetail')
  for response in unrelated:response.body.assert_not_awaited()
 async def test_session_cookie_survives_reader_restart_in_private_state(self):
  state={'cookies':[{'name':'session','value':'fixture-only','domain':'shop.example.com','path':'/','expires':-1,'httpOnly':True,'secure':True,'sameSite':'Lax'},{'name':'expired','value':'fixture','domain':'shop.example.com','path':'/','expires':time.time()-100}],'origins':[]}
  with tempfile.TemporaryDirectory() as tmp,patch('backend.product_browser.ROOT',Path(tmp)):
   first=ProductBrowser();first.context=SimpleNamespace(storage_state=AsyncMock(return_value=state));await first.persist_session()
   path=Path(tmp)/'session/state.json';self.assertEqual(os.stat(path).st_mode&0o777,0o600)
   second=ProductBrowser();second.context=SimpleNamespace(add_cookies=AsyncMock(),add_init_script=AsyncMock());await second.restore_session()
   restored=second.context.add_cookies.call_args.args[0];self.assertEqual([c['name'] for c in restored],['session'])
 async def test_read_reuses_logged_product_page_without_reloading(self):
  url='https://detail.tmall.com/item.htm?id=12&skuId=34'
  page=PageStub(url=url,is_closed=lambda:False,evaluate=AsyncMock(return_value={'title':'测试椅子','text':'商品详情'}),content=AsyncMock(return_value=PRODUCT),goto=AsyncMock())
  browser=ProductBrowser();browser.context=SimpleNamespace(pages=[page]);browser.pages['job']=page;browser.ensure=AsyncMock();browser.watch=Mock();browser.persist_session=AsyncMock()
  with patch('backend.product_browser.public_url',new_callable=AsyncMock):
   result=await browser.read('job',url)
  self.assertEqual(result[1],url);page.goto.assert_not_awaited()
 async def test_login_popup_product_page_is_used_instead_of_stale_login_tab(self):
  url='https://detail.tmall.com/item.htm?id=12'
  old=PageStub(url='https://login.taobao.com/login',is_closed=lambda:False,goto=AsyncMock())
  new=PageStub(url=url,is_closed=lambda:False,evaluate=AsyncMock(return_value={'title':'测试椅子','text':'商品详情'}),content=AsyncMock(return_value=PRODUCT),goto=AsyncMock())
  browser=ProductBrowser();browser.context=SimpleNamespace(pages=[old,new]);browser.pages['job']=old;browser.ensure=AsyncMock();browser.watch=Mock();browser.persist_session=AsyncMock()
  with patch('backend.product_browser.public_url',new_callable=AsyncMock):await browser.read('job',url)
  self.assertIs(browser.pages['job'],new);old.goto.assert_not_awaited();new.goto.assert_not_awaited()
 async def test_parser_failure_is_not_reported_as_login_failure(self):
  record={'id':'test','sourceUrl':'https://shop.example.com/p'}
  response=('<h1>商品页面</h1>','https://shop.example.com/p',{'diagnostics':{'loginPage':False,'verificationPage':False,'apiCodes':['SUCCESS::调用成功']}},[])
  with patch('backend.products.fetch_public',new_callable=AsyncMock,return_value=(b'<html/>',record['sourceUrl'],'text/html')),patch('backend.products.product_browser.read',new_callable=AsyncMock,return_value=response),patch('backend.products.save'):
   model=AsyncMock();await read_product(record,model)
  self.assertEqual(record['status'],'incomplete');self.assertEqual(record['failureCode'],'detail_unavailable');model.assert_not_called()
 async def test_closed_browser_is_not_reported_as_login_failure(self):
  record={'id':'test','sourceUrl':'https://shop.example.com/p'}
  with patch('backend.products.fetch_public',new_callable=AsyncMock,return_value=(b'<html/>',record['sourceUrl'],'text/html')),patch('backend.products.product_browser.read',new_callable=AsyncMock,side_effect=ProductBrowserError('browser_closed','商品浏览器已关闭')),patch('backend.products.save'):
   await read_product(record,AsyncMock())
  self.assertEqual(record['status'],'error');self.assertEqual(record['failureCode'],'browser_closed')
 async def test_browser_reads_original_product_not_static_login_redirect(self):
  record={'id':'test','sourceUrl':'https://shop.example.com/p'}
  with patch('backend.products.fetch_public',new_callable=AsyncMock,return_value=(b'<html/>','https://login.example.com/auth','text/html')),patch('backend.products.product_browser.read',new_callable=AsyncMock,side_effect=ProductBrowserError('browser_closed','关闭')) as reader,patch('backend.products.save'):
   await read_product(record,AsyncMock())
  self.assertEqual(reader.call_args.args[1],record['sourceUrl'])
 def test_same_product_handles_tracking_but_not_other_product_or_sku(self):
  self.assertTrue(same_product('https://detail.tmall.com/item.htm?id=1&skuId=2&spm=test','https://detail.tmall.com/item.htm?id=1&skuId=2'))
  self.assertFalse(same_product('https://detail.tmall.com/item.htm?id=1&skuId=2','https://detail.tmall.com/item.htm?id=1&skuId=3'))
  self.assertFalse(same_product('https://detail.tmall.com/item.htm?id=1','https://detail.tmall.com/item.htm?id=9'))
 def test_diagnostics_distinguish_login_verification_and_detail_without_credentials(self):
  self.assertTrue(read_diagnostics({},'https://login.taobao.com/login',[])['loginPage'])
  d=read_diagnostics({'title':'椅子','text':'商品','pageState':{}},'https://detail.tmall.com/item.htm?id=1',[{'ret':['FAIL_SYS_USER_VALIDATE::验证']}])
  self.assertFalse(d['loginPage']);self.assertTrue(d['verificationPage']);self.assertNotIn('cookie',json.dumps(d))
