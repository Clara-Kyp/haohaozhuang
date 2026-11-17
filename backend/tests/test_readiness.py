import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.main import app,normalize_rooms

class ReadinessTests(unittest.TestCase):
    def test_health_does_not_depend_on_render_services(self):
        with TestClient(app) as client:
            result=client.get('/api/health').json()
            self.assertTrue(result['features']['furnishing'])
            self.assertFalse(result['features']['render'])
            self.assertNotIn('render_status',result)
    def test_removed_render_routes_return_gone(self):
        with TestClient(app) as client:
            self.assertEqual(client.post('/api/renders',json={}).status_code,410)
            self.assertEqual(client.get('/api/renders/old-job').status_code,410)
    def test_room_kind_survives_normalization(self):
        data=normalize_rooms({'rooms':[{'name':'厨餐区','kind':'kitchen','x':.1,'y':.2,'w':.4,'h':.3}]},100,100)
        self.assertEqual(data['rooms'][0]['kind'],'kitchen')
    def test_outside_room_is_not_returned_as_zero_area(self):
        self.assertEqual(normalize_rooms({'rooms':[{'name':'outside','x':1,'y':.2,'w':.4,'h':.3}]},100,100)['rooms'],[])
