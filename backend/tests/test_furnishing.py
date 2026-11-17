import unittest,copy,json
from unittest.mock import patch,AsyncMock
from fastapi.testclient import TestClient
from backend.main import app
from backend.furnishing import validate_plan,repair_placement
from backend.style_profiles import style_profile
SCENE={'width':5,'depth':4,'height':2.75,'roomType':'living'}
def plan():return {'summary':'分层搭配，保留通行。','circulation':'从右前入口进入，中央保持活动空间。','items':[
 {'id':'table','assetId':'coffee','x':0,'z':0,'reason':'作为会客中心，控制体量。'},
 {'id':'vase','assetId':'vase','x':.2,'z':0,'parentId':'table','reason':'在茶几台面增加陶瓷质感。'}]}
class FurnishingTests(unittest.TestCase):
 def test_hosted_accessory_elevation_is_derived(self):
  value=validate_plan(plan(),SCENE);self.assertEqual(value['items'][1]['elevation'],.408)
 def test_unknown_assets_collision_bounds_and_orphan_are_rejected(self):
  cases=[]
  v=plan();v['items'][0]['assetId']='https://fake/model.glb';cases.append(v)
  v=plan();v['items'][0]['x']=10;cases.append(v)
  v=plan();v['items'][1]['parentId']='absent';cases.append(v)
  v=plan();v['items'].append({**v['items'][0],'id':'other'});cases.append(v)
  v=plan();v['items'][1]['x']=1;cases.append(v)
  for value in cases:
   with self.subTest(value=value),self.assertRaises(ValueError):validate_plan(value,SCENE)
 def test_kitchen_cannot_receive_living_room_sofa(self):
  value=plan();value['items']=[{'id':'a','assetId':'sofa','x':0,'z':0,'reason':'错误用途'}]
  with self.assertRaisesRegex(ValueError,'用途'):validate_plan(value,{**SCENE,'roomType':'kitchen'})
 def test_reference_image_and_original_request_reach_visual_model(self):
  with patch('backend.main.complete',new_callable=AsyncMock,return_value=plan()) as model,TestClient(app) as client:
   result=client.post('/api/furnishings',json={'scene':SCENE,'instruction':'精致而且保留动线','style':'奶油风','references':['data:image/png;base64,AA==']})
   self.assertEqual(result.status_code,200,result.text)
   args,kwargs=model.call_args;self.assertEqual(kwargs['role'],'vision')
   self.assertEqual(args[1][0]['type'],'image_url')
   self.assertIn('精致而且保留动线',args[1][1]['text'])
   self.assertIn(style_profile('奶油风')['systemPrompt'],args[0])
   self.assertEqual(json.loads(args[1][1]['text'])['preferred_asset_ids'],
                    style_profile('奶油风')['preferredAssets'])
   self.assertEqual(result.json()['source'],'model')
 def test_model_is_given_one_correction_and_never_fake_success(self):
  invalid={'summary':'test','items':[]}
  with patch('backend.main.complete',new_callable=AsyncMock,side_effect=[invalid,invalid]) as model,TestClient(app) as client:
   result=client.post('/api/furnishings',json={'scene':SCENE,'instruction':'完整搭配','style':'意式'})
   self.assertEqual(result.status_code,502);self.assertEqual(model.await_count,2)
 def test_invalid_size_does_not_call_model(self):
  with patch('backend.main.complete',new_callable=AsyncMock) as model,TestClient(app) as client:
   self.assertEqual(client.post('/api/furnishings',json={'scene':{},'instruction':'完整搭配','style':'意式'}).status_code,422)
   model.assert_not_called()

 def test_geometry_repair_retains_items_and_reports_moves(self):
  raw=plan();raw['items'].append({'id':'plant','assetId':'plant','x':2.1,'z':1.6,'reason':'入口边增加绿意。'})
  repaired=validate_plan(repair_placement(raw,SCENE),SCENE)
  self.assertEqual(len(repaired['items']),3);self.assertTrue(repaired['adjustments'])
 def test_window_art_is_rejected_then_relocated_beside_window(self):
  value={'summary':'墙面装饰','items':[{'id':'art','assetId':'art','x':0,'z':-1.98,'elevation':1.2,'reason':'装饰会客区墙面。'}]}
  with self.assertRaisesRegex(ValueError,'窗洞'):validate_plan(value,SCENE)
  repaired=validate_plan(repair_placement(value,SCENE),SCENE)
  self.assertGreater(repaired['items'][0]['x'],1.8)
  self.assertTrue(repaired['adjustments'])
