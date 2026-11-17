"""Shared style profiles and composition with task-specific system prompts."""
import json
from pathlib import Path

_PROFILES = json.loads(
    (Path(__file__).resolve().parents[1] / "app/src/styleCatalog.json").read_text(encoding="utf-8")
)
STYLE_NAMES = tuple(profile["name"] for profile in _PROFILES)
_BY_NAME = {
    name.casefold(): profile
    for profile in _PROFILES
    for name in (profile["name"], *profile["aliases"])
}
_KEYWORDS = sorted(_BY_NAME, key=len, reverse=True)


def style_profile(name):
    return _BY_NAME.get(name.strip().casefold())


def style_from_text(text):
    text = text.casefold()
    for name in _KEYWORDS:
        if name in text:
            return _BY_NAME[name]["name"]
    return None


def with_style_prompts(system, names, scope):
    prompts = []
    for name in names:
        profile = style_profile(name)
        if profile:
            prompts.append(f'【对应风格：{name}】\n' + profile["systemPrompt"])
    if not prompts:
        return system
    return "\n\n".join([system, scope, *prompts])
