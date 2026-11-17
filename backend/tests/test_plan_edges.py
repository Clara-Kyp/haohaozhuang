from io import BytesIO
import unittest

from PIL import Image, ImageDraw

from backend.main import normalize_rooms
from backend.plan_edges import align_room_edges


class PlanEdgeTests(unittest.TestCase):
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
