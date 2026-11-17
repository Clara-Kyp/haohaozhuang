import base64,json,struct,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,AsyncMock
from fastapi.testclient import TestClient
from backend.main import app
from backend.inventory import parse_rows,listing
from backend.bakes import validate_glb
from backend.product_io import product_key
from backend.product_parser import parse_product

def glb(doc):
 data=json.dumps(doc).encode();data+=b' '*((-len(data))%4)
 return b'glTF'+struct.pack('<II',2,len(data)+20)+struct.pack('<II',len(data),0x4e4f534a)+data
class InventoryTests(unittest.TestCase):
 def test_cache_deduplicates_tracking_but_not_other_skus(self):
  self.assertEqual(product_key('https://detail.tmall.com/item.htm?id=1&skuId=2&spm=abc'),product_key('https://detail.tmall.com/item.htm?skuId=2&id=1'))
  self.assertNotEqual(product_key('https://detail.tmall.com/item.htm?id=1&skuId=2'),product_key('https://detail.tmall.com/item.htm?id=1&skuId=3'))
 def test_table_import_retains_real_price_intro_reviews_and_missing_candidates(self):
  rows=[['类别','商品名称','商品链接','价格','评论数','评分','产品介绍','评论情况'],['椅子','真实椅子','https://shop.example.com/chair',199,'1.2万+',4.8,'实木扶手','表中评价摘要']]
  values,warnings=parse_rows(rows,'items.xlsx');e=values[0]
  self.assertEqual(e['price'],'199');self.assertEqual(e['reviews']['count'],12000);self.assertEqual(e['reviews']['rating'],4.8);self.assertEqual(e['description'],'实木扶手');self.assertFalse(warnings)
  with tempfile.TemporaryDirectory() as tmp,patch('backend.inventory.FILE',Path(tmp)/'inventory.json'),patch('backend.inventory.ROOT',Path(tmp)):
   (Path(tmp)/'inventory.json').write_text(json.dumps(values));result=listing()
  self.assertEqual(result['groups'][0]['missing'],2);self.assertEqual(len(result['groups'][0]['candidates']),1)
 def test_wide_three_candidate_urls_are_independent(self):
  rows=[['类别','候选1名称','候选1链接','候选2名称','候选2链接','候选3链接'],['沙发','A','https://shop.example.com/a','B','https://shop.example.com/b','']]
  values,_=parse_rows(rows,'list.csv');self.assertEqual(len(values),2);self.assertNotEqual(values[0]['id'],values[1]['id']);self.assertIsNone(values[0]['price']);self.assertIsNone(values[0]['reviews']['rating'])
 def test_bake_rejects_external_dependencies_and_invalid_binary(self):
  with self.assertRaises(ValueError):validate_glb(b'not a model')
  with self.assertRaises(ValueError):validate_glb(glb({'meshes':[{}],'images':[{'uri':'https://private.example/asset.png'}]}))
  validate_glb(glb({'meshes':[{}]}))
 def test_successful_product_cache_does_not_reopen_browser_or_call_model(self):
  from uuid import uuid4
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);(root/'imports').mkdir();(root/'media').mkdir();name='a'*64+'.jpg';(root/'media'/name).write_bytes(b'fixture')
   record={'id':str(uuid4()),'status':'ready','sourceUrl':'https://detail.tmall.com/item.htm?id=1&skuId=2','selectedVariantId':'2','images':[{'url':'/api/products/media/'+name}],'variants':[],'models':[]}
   (root/'imports'/('cache.json')).write_text(json.dumps(record))
   with patch('backend.products.ROOT',root),patch('backend.products.MEDIA',root/'media'),patch('backend.products.read_product',new_callable=AsyncMock) as reader,TestClient(app) as client:
    r=client.post('/api/products/import',json={'url':'https://detail.tmall.com/item.htm?id=1&skuId=2&spm=tracking'});self.assertEqual(r.status_code,202);self.assertTrue(r.json()['fromCache']);reader.assert_not_awaited()
 def test_bake_manifest_cannot_inject_a_local_asset_path(self):
  status={'id':'test','status':'queued'}
  with patch('backend.bakes.create_job',return_value=(Path('/tmp/test'),status,False)) as create,TestClient(app) as client:
   r=client.post('/api/bakes',json={'source':base64.b64encode(glb({'meshes':[{}]})).decode(),'manifest':{'mode':'asset','assetPath':'/private/secret','items':[],'scene':{'width':4,'height':2.7,'depth':3}}})
   self.assertEqual(r.status_code,202);self.assertEqual(create.call_args.args[0]['mode'],'scene');self.assertNotIn('assetPath',create.call_args.args[0])
 def test_jsonld_review_data_is_factual_and_not_model_generated(self):
  html='<script type="application/ld+json">'+json.dumps({'@type':'Product','name':'椅子','image':'https://cdn.example.com/p.jpg','aggregateRating':{'ratingValue':'4.8','reviewCount':'120'}})+'</script>'
  p=parse_product(html,'https://shop.example.com/a');self.assertEqual(p['reviews']['rating'],4.8);self.assertEqual(p['reviews']['count'],120);self.assertIsNone(p['reviews']['summary'])
