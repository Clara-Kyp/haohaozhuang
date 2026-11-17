import asyncio,json,struct,unittest,copy
from unittest.mock import patch,AsyncMock
from fastapi.testclient import TestClient
from backend.main import app
from backend.product_parser import parse_product,dimensions,quantity
from backend.product_io import clean_link,public_url,ProductError
from backend.products import geometry,read_product,analyze,similar_assets

HTML='''<html><h1>真实落地灯</h1><script type="application/ld+json">{"@type":"ProductGroup","name":"三脚落地灯","hasVariant":[{"@type":"Product","sku":"white-150","name":"白色150cm","color":"白色","width":{"value":40,"unitCode":"CMT"},"depth":{"value":40,"unitCode":"CMT"},"height":{"value":150,"unitCode":"CMT"},"image":"https://cdn.example.com/white.jpg"},{"@type":"Product","sku":"black-170","name":"黑色170cm","color":"黑色","width":"45 cm","depth":"45 cm","height":"170 cm","image":"https://cdn.example.com/black.jpg"}]}</script></html>'''
SHAPE={'parts':[{'type':'cylinder','position':[0,.85,0],'size':[.4,.5,.3],'material':'fabric','color':'#eeeeee'}]}
class ProductTests(unittest.TestCase):
 def test_generic_variants_without_default_are_not_silently_selected(self):
  p=parse_product(HTML,'https://shop.example.com/lamp')
  self.assertEqual(len(p['variants']),2);self.assertIsNone(p['selectedVariantId'])
 def test_url_default_changes_color_dimensions_and_image(self):
  p=parse_product(HTML,'https://shop.example.com/lamp?variant=black-170')
  self.assertEqual(p['selectedVariantId'],'black-170')
  v=next(v for v in p['variants'] if v['id']==p['selectedVariantId'])
  self.assertEqual(v['color'],'黑色');self.assertEqual(v['dimensions']['height'],1.7);self.assertIn('black.jpg',v['images'][0])
 def test_dom_default_is_read_from_selected_variant(self):
  p=parse_product(HTML,'https://shop.example.com/lamp',{'selectedVariantId':'white-150'})
  self.assertEqual(p['selectedVariantId'],'white-150')
 def test_no_sizes_are_invented_from_an_unlabelled_title(self):
  html='<script type="application/ld+json">{"@type":"Product","name":"高品质落地灯","image":"https://cdn.example.com/lamp.jpg"}</script>'
  p=parse_product(html,'https://shop.example.com/lamp')
  self.assertEqual(p['variants'][0]['dimensions'],{})
 def test_page_measurements_do_not_leak_into_other_skus(self):
  markup='<p>Width: 40 cm</p>'+HTML.replace('"width":{"value":40,"unitCode":"CMT"},','').replace('"width":"45 cm",','')
  p=parse_product(markup,'https://shop.example.com/lamp?variant=white-150')
  self.assertEqual(p['variants'][0]['dimensions']['width'],.4)
  self.assertNotIn('width',p['variants'][1]['dimensions'])
 def test_dimensions_exclude_cord_package_and_use_maximum_adjustable_height(self):
  dims,proof=dimensions('Shade width\n15 "\nMin. height\n47 "\nMax. height\n59 "\nBase diameter\n24 "\nCord length\n11 in\nPackaging\nWidth 5 cm')
  self.assertAlmostEqual(dims['width'],.6096);self.assertAlmostEqual(dims['depth'],.6096);self.assertAlmostEqual(dims['height'],1.4986)
  self.assertIn('可调',proof['height'])
  self.assertEqual(dimensions('长宽高：220×95×85cm')[0],{'width':2.2,'depth':.95,'height':.85})
 def test_taobao_sku_props_and_explicit_default(self):
  data={'item':{'title':'落地灯','images':['//img.example.com/main.jpg'],'defaultSkuId':'2'},'skuBase':{'props':[{'pid':'1','name':'颜色','values':[{'vid':'1','name':'白色','image':'//img.example.com/white.jpg'},{'vid':'2','name':'黑色','image':'//img.example.com/black.jpg'}]}],'skus':[{'skuId':'1','propPath':'1:1'},{'skuId':'2','propPath':'1:2'}]}}
  p=parse_product('', 'https://item.taobao.com/item.htm?id=123',extra=[data])
  self.assertEqual(p['selectedVariantId'],'2');self.assertEqual(p['variants'][1]['color'],'黑色');self.assertTrue(p['variants'][1]['images'][0].startswith('https://'))
 def test_share_link_and_private_network_rejection(self):
  self.assertEqual(clean_link('分享 https://shop.example.com/p?x=1&amp;y=2。'),'https://shop.example.com/p?x=1&y=2')
  for u in ['http://shop.example.com','https://a:b@shop.example.com/p','https://shop.example.com:8443/p']:
   with self.assertRaises(ValueError):clean_link(u)
  with self.assertRaises(ValueError):asyncio.run(public_url('https://127.0.0.1/a'))
 def test_model_geometry_is_bounded_and_no_arbitrary_scripts_or_urls(self):
  self.assertTrue(geometry(SHAPE));self.assertIsNone(geometry({'parts':[{'type':'script','url':'javascript:bad'}]}))
  invalid=copy.deepcopy(SHAPE);invalid['parts'][0]['position'][0]=300
  self.assertIsNone(geometry(invalid))
 def test_disconnected_parts_are_not_loaded_as_a_complete_model(self):
  parts=[{'type':'cylinder','position':[0,.15,0],'size':[.02,.02,.3],'material':'wood','color':'#aaaaaa'},SHAPE['parts'][0]]
  self.assertIsNone(geometry({'parts':parts}))
  parts[0]['position'][1]=.4;parts[0]['size'][2]=.8
  self.assertIsNotNone(geometry({'parts':parts}))
 def test_similar_models_preserve_furniture_function(self):
  self.assertEqual([a['id'] for a in similar_assets('armchair')],['armchair'])
  self.assertEqual([a['id'] for a in similar_assets('wardrobe')],['wardrobe'])
  self.assertEqual({a['id'] for a in similar_assets('sofa')},{'sofa','antique-sofa'})
 def test_import_task_needs_selection_without_calling_vision(self):
  record={'id':'test-selection','sourceUrl':'https://shop.example.com/lamp'}
  with patch('backend.products.fetch_public',new_callable=AsyncMock,return_value=(HTML.encode(),'https://shop.example.com/lamp','text/html')),patch('backend.products.save'),patch('backend.products.product_browser.read',new_callable=AsyncMock,side_effect=ProductError('登录')) as browser:
   model=AsyncMock();asyncio.run(read_product(record,model));self.assertEqual(record['status'],'needs_selection');model.assert_not_called();browser.assert_awaited_once()
 def test_apply_analysis_retains_image_and_spec_provenance(self):
  p=parse_product(HTML,'https://shop.example.com/lamp?variant=white-150');record={**p,'id':'test','resolvedUrl':p['sourceUrl'],'_pageText':'','_modelUrls':[]}
  model=AsyncMock(return_value={'assetId':'floor-lamp','color':'#eeeeee','geometry':SHAPE,'dimensionReadings':{}})
  image={'url':'/api/products/media/'+'a'*64+'.jpg','sourceUrl':'https://cdn.example.com/white.jpg'}
  from tempfile import TemporaryDirectory
  from pathlib import Path
  with TemporaryDirectory() as tmp,patch('backend.products.MEDIA',Path(tmp)),patch('backend.products.cache_image',new_callable=AsyncMock,return_value=image),patch('backend.products.save'):
   (Path(tmp)/('a'*64+'.jpg')).write_bytes(b'image-fixture')
   asyncio.run(analyze(record,model))
  self.assertEqual(record['status'],'ready');self.assertEqual(record['selectedVariant']['dimensions']['height'],1.5)
  self.assertEqual(record['models'][0]['type'],'image_reconstruction');self.assertEqual(record['images'][0]['url'],image['url'])
  self.assertIn('image_url',[v['type'] for v in model.call_args.args[1]])
 def test_media_route_only_serves_valid_cache_names(self):
  with TestClient(app) as client:
   self.assertEqual(client.get('/api/products/media/secret.env').status_code,404)
 def test_unreadable_images_never_produce_fake_ready_models(self):
  p=parse_product(HTML,'https://shop.example.com/lamp?variant=white-150');record={**p,'id':'test','resolvedUrl':p['sourceUrl']}
  with patch('backend.products.cache_image',new_callable=AsyncMock,side_effect=ProductError('登录')),patch('backend.products.product_browser.image_cookies',new_callable=AsyncMock,return_value=None),patch('backend.products.save'):
   model=AsyncMock();asyncio.run(analyze(record,model))
  self.assertEqual(record['status'],'needs_login');self.assertEqual(record['images'],[]);model.assert_not_called()
 def test_authenticated_image_retry_uses_only_backend_session(self):
  import httpx
  from tempfile import TemporaryDirectory
  from pathlib import Path
  p=parse_product(HTML,'https://shop.example.com/lamp?variant=white-150');record={**p,'id':'test','resolvedUrl':p['sourceUrl']}
  image={'url':'/api/products/media/'+'b'*64+'.jpg','sourceUrl':'https://cdn.example.com/white.jpg'}
  cookies=httpx.Cookies();cookies.set('session','fixture',domain='cdn.example.com')
  with TemporaryDirectory() as tmp,patch('backend.products.MEDIA',Path(tmp)),patch('backend.products.save'),patch('backend.products.cache_image',new_callable=AsyncMock,side_effect=[ProductError('登录'),image]) as fetch,patch('backend.products.product_browser.image_cookies',new_callable=AsyncMock,return_value=cookies):
   (Path(tmp)/('b'*64+'.jpg')).write_bytes(b'fixture');asyncio.run(analyze(record,AsyncMock(return_value={'assetId':'floor-lamp','geometry':SHAPE})))
  self.assertEqual(record['status'],'ready');self.assertIs(fetch.call_args.kwargs['cookies'],cookies)
  self.assertNotIn('session',json.dumps(record))

class CartPreparationTests(unittest.TestCase):
 def test_cart_prepares_cached_images_once_without_reading_storefront(self):
  from backend.products import prepare_cached_model
  from fastapi import BackgroundTasks
  from tempfile import TemporaryDirectory
  from pathlib import Path
  record={'id':'cart-prepare','status':'ready','images':[{'url':'/cached.jpg'}],'models':[{'type':'similar'}]}
  tasks=BackgroundTasks()
  with TemporaryDirectory() as tmp,patch('backend.products.MEDIA',Path(tmp)),patch('backend.products.save'),patch('backend.products.read_product',new_callable=AsyncMock) as read:
   prepare_cached_model(record,tasks,AsyncMock());prepare_cached_model(record,tasks,AsyncMock())
  self.assertEqual(len(tasks.tasks),1);self.assertEqual(record['modelBuild']['status'],'queued');read.assert_not_called()
 def test_cart_reuses_existing_glb_and_does_not_build_before_product_ready(self):
  from backend.products import prepare_cached_model
  from fastapi import BackgroundTasks
  from tempfile import TemporaryDirectory
  from pathlib import Path
  with TemporaryDirectory() as tmp,patch('backend.products.MEDIA',Path(tmp)),patch('backend.products.save') as save:
   (Path(tmp)/'model.glb').write_bytes(b'cached')
   tasks=BackgroundTasks();prepare_cached_model({'id':'cached','status':'ready','models':[{'type':'reference_model','url':'/api/products/media/model.glb'}]},tasks,AsyncMock())
   prepare_cached_model({'id':'reading','status':'processing'},tasks,AsyncMock())
   self.assertEqual(len(tasks.tasks),0);save.assert_not_called()

class RugPreviewTests(unittest.TestCase):
 def test_missing_rug_thickness_is_only_a_scene_assumption(self):
  from backend.product_models import model_dimensions
  record={'assetId':'rug','selectedVariantId':'rug','variants':[{'id':'rug','dimensions':{'width':1.6,'depth':2.3}}]}
  self.assertEqual(model_dimensions(record),{'width':1.6,'depth':2.3,'height':.012})
  self.assertNotIn('height',record['variants'][0]['dimensions'])
  self.assertNotIn('height',model_dimensions({**record,'assetId':'armchair'}))
  self.assertEqual(model_dimensions(record,{'width':1.6,'depth':2.3,'height':.02})['height'],.02)
 def test_planar_rug_recipe_is_valid_and_does_not_require_furniture_parts(self):
  from backend.product_models import rug_preview
  from backend.model_fidelity import recipe
  spec=recipe(rug_preview({'color':'#D7CEC0'})['recipe'])
  self.assertEqual(len(spec['parts']),1);self.assertEqual(spec['parts'][0]['material'],'fabric')
