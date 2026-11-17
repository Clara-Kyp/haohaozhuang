from io import BytesIO
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from backend.main import app, normalize_rooms
from backend.plan_edges import align_room_edges


class PlanEdgeTests(unittest.TestCase):
    def test_plan_recognition_uses_room_measurements_and_verified_scale(self):
        result = {"rooms": [{"name": "主卧", "edges_px": [20, 30, 145, 180]}]}
        with TestClient(app) as client, patch('backend.main.complete', AsyncMock(return_value=result)) as complete:
            payload = {'image': 'data:image/png;base64,AA==', 'width': 200, 'height': 250,
                       'room_sizes': [{'name': '主卧', 'width_m': 3.25, 'depth_m': 4.1}],
                       'plan_width_m': 8, 'plan_height_m': 10}
            response = client.post('/api/plan', json=payload)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['rooms'][0]['w'], .625)
            content = complete.await_args.args[1]
            self.assertIn('"width_m": 3.25', content[-1]['text'])
            self.assertIn('"verified_plan_metres": [8.0, 10.0]', content[-1]['text'])
            payload['room_sizes'][0]['depth_m'] = -1
            self.assertEqual(client.post('/api/plan', json=payload).status_code, 422)
            self.assertEqual(complete.await_count, 1)

    def test_explicit_pixel_edges_exclude_planter_and_reject_invalid_range(self):
        rooms = normalize_rooms({"rooms": [
            {"name": "主卧", "edges_px": [20, 30, 145, 180]},
            {"name": "花池", "edges_px": [150, 30, 195, 80]},
            {"name": "阳台", "edges_px": [20, 180, 145, 220], "kind": "other"},
            {"name": "越界", "edges_px": [150, 30, 201, 80]},
        ]}, 200, 250)["rooms"]
        self.assertEqual([room["name"] for room in rooms], ["主卧", "阳台"])
        self.assertEqual(rooms[0]["w"], .625)
        self.assertEqual(rooms[1]["kind"], "court")

    def test_snap_to_wall_inner_edges_without_using_a_thin_dimension_line(self):
        image = Image.new("RGB", (240, 240), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((19, 24, 190, 195), outline="black", width=6)
        draw.line((155, 37, 155, 180), fill="black")
        data = BytesIO()
        image.save(data, format="PNG")
        room = {"name": "主卧", "x": 26 / 240, "y": 34 / 240, "w": 140 / 240, "h": 160 / 240}
        self.assertEqual(align_room_edges(data.getvalue(), [room]), 1)
        self.assertAlmostEqual(room["x"] + room["w"], 185 / 240, places=4)
        self.assertAlmostEqual(room["y"], 30 / 240, places=4)


if __name__ == "__main__":
    unittest.main()
