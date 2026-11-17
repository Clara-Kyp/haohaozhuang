import copy,json,time,unittest,tempfile
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.main import app
from backend.model_fidelity import recipe,structural_checks,legacy_review
from backend.inventory import parse_rows

def cushion():return {'name':'实际座垫','role':'seat','type':'cushion','material':'leather','color':'#a86539','position':[0,.45,.1],'size':[.65,.14,.6],'rotation':[-8,0,0],'axis':'y','wrinkles':.7,'piping':True,'roundness':.38}
class FidelityTests(unittest.TestCase):
 def test_optional_generation_can_be_stopped_without_leaving_busy_state(self):
  import asyncio
  from backend.product_models import refine,WORKERS,ACTIVE
  async def scenario():
   event=asyncio.Event();record={'id':'cancel-test','title':'椅子','variants':[{'id':'one','dimensions':{'width':1,'depth':1,'height':1}}],'selectedVariantId':'one','images':[{'url':'cached'}],'status':'ready'}
   async def waiting(*args,**kwargs):event.set();await asyncio.Event().wait()
   with patch('backend.products.save'),patch('backend.product_models.image_content',return_value=[{'type':'text','text':'fixture'}]):
    task=asyncio.create_task(refine(record,waiting));await asyncio.wait_for(event.wait(),1);WORKERS[record['id']].cancel();await task
   self.assertEqual(record['modelBuild']['status'],'cancelled');self.assertNotIn(record['id'],ACTIVE);self.assertNotIn(record['id'],WORKERS)
  asyncio.run(scenario())
 def test_approximate_mode_unlocks_visual_differences_without_changing_product_spec(self):
  from backend.products import public
  r={'models':[{'id':'detail','type':'reference_model','url':'/api/products/media/'+'a'*64+'.glb','canApply':False,'quality':'needs_revision','dimensions':{'width':.98}}],'modelReview':{'status':'needs_revision','checks':[{'key':'颜色','result':'mismatch'}]}}
  d=public(r);self.assertTrue(d['models'][0]['canApply']);self.assertEqual(d['models'][0]['dimensions']['width'],.98);self.assertFalse(r['models'][0]['canApply']);self.assertEqual(d['modelReview']['status'],'approximate')
 def test_wrong_seat_axes_are_detected_instead_of_hidden_by_scaling(self):
  p=cushion();good=recipe({'parts':[p]});self.assertFalse(any(c['result']=='mismatch' for c in structural_checks(good,[],'armchair')))
  p['size']=[.65,.6,.14];bad=recipe({'parts':[p]});self.assertTrue(any(c['key']=='座垫比例' and c['result']=='mismatch' for c in structural_checks(bad,[],'armchair')))
 def test_softness_and_folds_require_actual_geometry_capabilities(self):
  p=cushion();p['type']='rounded_box';r=recipe({'parts':[p]})
  obs=[{'visible':True,'description':'皮革软包有明显褶皱'}];checks=structural_checks(r,obs,'armchair')
  self.assertTrue(any(c['key']=='软包曲线' and c['result']=='mismatch' for c in checks));self.assertTrue(any(c['key']=='褶皱' and c['result']=='mismatch' for c in checks))
 def test_rotation_checks_are_category_specific_and_reject_vertical_base_legs(self):
  p=cushion();r=recipe({'parts':[p]});obs=[{'visible':True,'description':'三脚支撑，不支持旋转'}]
  self.assertFalse(any(c['key']=='旋转底座' for c in structural_checks(r,obs,'floor-lamp')))
  obs=[{'visible':True,'description':'四爪旋转底座'}];self.assertTrue(any(c['result']=='mismatch' for c in structural_checks(r,obs,'armchair')))
 def test_non_upholstered_products_do_not_require_nonexistent_cushions_or_folds(self):
  p={'name':'灯罩','role':'shade','type':'cylinder','material':'fabric','color':'#ffffff','position':[0,.8,0],'size':[0,.25,.3],'rotation':[0,0,0],'open':True}
  r=recipe({'parts':[p]});checks=structural_checks(r,[{'visible':True,'description':'无明显褶皱，不属于软包结构，无旋转机构'}],'floor-lamp')
  self.assertFalse(any(c['result']=='mismatch' for c in checks))
 def test_geometry_is_safe_and_finite_and_shell_has_explicit_direction(self):
  with self.assertRaises(ValueError):recipe({'parts':[{**cushion(),'type':'script','code':'bad'}]})
  p=cushion();p['size'][0]=float('nan')
  with self.assertRaises(ValueError):recipe({'parts':[p]})
  p={**cushion(),'type':'shell','profile':[[-.4,.4,.3,0],[-.2,.4,.3,0],[.2,.4,.3,0],[.4,.4,.3,0]],'thickness':.02}
  with self.assertRaisesRegex(ValueError,'递减'):recipe({'parts':[p]})
 def test_legacy_proxy_is_clearly_withheld_while_similar_assets_remain_explicit(self):
  original={'models':[{'id':'image','type':'image_reconstruction','geometry':{'parts':[]}},{'id':'similar','type':'similar'}]};result=legacy_review(copy.deepcopy(original))
  self.assertFalse(result['models'][0]['canApply']);self.assertNotIn('quality',original['models'][0]);self.assertEqual(result['modelReview']['status'],'needs_refinement');self.assertNotIn('canApply',result['models'][1])
 def test_template_download_column_names_and_cm_roundtrip(self):
  import openpyxl,io
  with TestClient(app) as client:r=client.get('/api/inventory/template')
  self.assertEqual(r.status_code,200);self.assertIn('attachment',r.headers['content-disposition'])
  book=openpyxl.load_workbook(io.BytesIO(r.content),read_only=True,data_only=True);self.assertEqual(book.sheetnames,['商品清单','填写说明'])
  headers=next(book['商品清单'].iter_rows(max_row=1,values_only=True));book.close()
  values={'物品类别':'休闲椅','商品链接':'https://shop.example.com/one?skuId=123','商品名称':'测试用椅','颜色':'棕黄','款式':'旋转款','宽(cm)':83,'深(cm)':103,'高(cm)':90,'价格':1649,'币种':'CNY','评论数':120,'评分':4.8,'尺寸依据':'商品尺寸图'}
  rows,warnings=parse_rows([headers,[values.get(k) for k in headers]],'填好.xlsx');self.assertFalse(warnings);e=rows[0]
  self.assertEqual(e['dimensions'],{'width':.83,'depth':1.03,'height':.9});self.assertEqual(e['color'],'棕黄');self.assertEqual(e['style'],'旋转款');self.assertIn('商品尺寸图',e['dimensionEvidence']['height']);self.assertEqual(e['reviews']['count'],120)
 def test_empty_template_invalid_rows_and_missing_values_are_reported(self):
  with self.assertRaisesRegex(ValueError,'第2行'):parse_rows([['商品链接','价格'],['','']],'空表.xlsx')
  rows,warnings=parse_rows([['商品链接','宽(cm)','评分','评论数'],['not a link',83,4.8,20],['https://shop.example.com/a',-83,6,-2]],'bad.xlsx')
  self.assertTrue(any('第2行' in w for w in warnings));self.assertTrue(any('第3行宽' in w for w in warnings));self.assertEqual(rows[0]['dimensions'],{});self.assertIsNone(rows[0]['reviews']['rating']);self.assertIsNone(rows[0]['reviews']['count']);self.assertIsNone(rows[0]['price'])
 def test_stopped_native_task_does_not_poll_as_forever_processing(self):
  from uuid import uuid4
  from backend import bakes
  key=str(uuid4())
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);folder=root/key;folder.mkdir();(folder/'manifest.json').write_text(json.dumps({'items':[{'id':'one'}]}));(folder/'status.json').write_text(json.dumps({'id':key,'status':'processing','startedAt':time.time()-300}))
   with patch.object(bakes,'ROOT',root),patch.object(bakes,'find_worker',return_value=None),TestClient(app) as client:r=client.get('/api/bakes/'+key)
   self.assertEqual(r.json()['status'],'error');self.assertEqual(r.json()['completedItems'],0);self.assertEqual(r.json()['totalItems'],1)
 def test_completed_native_result_is_published_after_api_restart(self):
  from backend import bakes
  with tempfile.TemporaryDirectory() as tmp:
   folder=Path(tmp)/'bake';folder.mkdir();asset={'url':'/api/bakes/one/assets/product.glb','inventoryId':'real-product-key','signature':'mesh-version'}
   (folder/'manifest.json').write_text(json.dumps({'sourceSignature':'scene-version','roomSignature':'room-version'}));(folder/'result.json').write_text(json.dumps({'assets':{'one':asset}}))
   with patch.object(bakes,'PRODUCTS',Path(tmp)/'products'):result=bakes.publish_result(folder)
   self.assertEqual(result['sourceSignature'],'scene-version');self.assertEqual(json.loads((Path(tmp)/'products/baked-models.json').read_text())['real-product-key'],asset)
 def test_other_sku_never_inherits_previous_models_or_review_verdict(self):
  from unittest.mock import AsyncMock
  from uuid import uuid4
  original={'id':str(uuid4()),'status':'ready','sourceUrl':'https://shop.example.com/a?skuId=one','selectedVariantId':'one','variants':[{'id':'one','name':'棕色'},{'id':'two','name':'绿色','url':'https://shop.example.com/a?skuId=two'}],'modelBuild':{'status':'ready','modelId':'old-mesh'},'modelReview':{'status':'needs_confirmation','checks':[{'key':'旧款','result':'match'}]},'images':[{'url':'/old.jpg'}],'models':[{'id':'old-mesh','type':'reference_model'}]}
  with patch('backend.products.get_record',return_value=original),patch('backend.products.save'),patch('backend.products.analyze',new_callable=AsyncMock),TestClient(app) as client:r=client.post('/api/products/'+original['id']+'/variant',json={'variantId':'two'})
  self.assertEqual(r.status_code,202);d=r.json();self.assertEqual(d['selectedVariantId'],'two');self.assertNotIn('modelBuild',d);self.assertFalse(d['models']);self.assertFalse(any(c['key']=='旧款' for c in d['modelReview']['checks']));self.assertEqual(original['selectedVariantId'],'one');self.assertEqual(original['models'][0]['id'],'old-mesh')
