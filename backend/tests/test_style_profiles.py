import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend.main import app, PALETTE
from backend.style_profiles import STYLE_NAMES, style_profile


class StyleProfileTests(unittest.TestCase):
    def test_each_standalone_prompt_is_documented_and_has_supported_finishes(self):
        doc = (Path(__file__).resolve().parents[2] / "docs/STYLE_PROMPTS.md").read_text(encoding="utf-8")
        self.assertEqual(len(STYLE_NAMES), 12)
        prompts = set()
        for name in STYLE_NAMES:
            with self.subTest(name=name):
                profile = style_profile(name)
                prompts.add(profile["systemPrompt"])
                self.assertIn(profile["systemPrompt"], doc)
                self.assertTrue(set(profile["materials"]) <= set(PALETTE.split("、")))
                self.assertTrue(set(profile["faces"].values()) <= set(PALETTE.split("、")))
        self.assertEqual(len(prompts), 12)

    def test_design_uses_one_profile_only_when_command_names_it(self):
        profile = style_profile("侘寂")["systemPrompt"]
        with TestClient(app) as client:
            for command, should_include in [("换成侘寂风", True), ("地面换浅灰微水泥", False)]:
                with self.subTest(command=command), patch(
                    "backend.main.complete", new_callable=AsyncMock,
                    side_effect=[{}, {"patch": {}, "summary": "改动说明"}],
                ) as model:
                    result = client.post("/api/design", json={"command": command, "scene": {}})
                    self.assertEqual(result.status_code, 200, result.text)
                    system = model.call_args.args[0]
                    self.assertEqual(profile in system, should_include)
                    self.assertNotIn(style_profile("工业混凝土")["systemPrompt"], system)
