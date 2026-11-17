#!/usr/bin/env python3
"""好好装 · MiniMax 连通性自检

用法（在项目根目录执行）：
    .venv/bin/python backend/check_llm.py

作用：依次测试中国区/国际区端点与候选模型，找出第一个可用组合，
并打印应该写进 .env 的配置。密钥只从 .env 读取，不打印、不写入日志。
"""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASES = ["https://api.minimaxi.com/v1", "https://api.minimax.cn/v1", "https://api.minimax.io/v1"]
MODELS = ["MiniMax-M3", "MiniMax-M3.1-Flash"]


def read_env():
    path = ROOT / ".env"
    if not path.is_file():
        return {}
    cfg = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        cfg[key.strip()] = value.strip()
    return cfg


def probe(base, model, key):
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": '只输出 JSON：{"ok":true}'}],
        "max_completion_tokens": 64,
    }
    if "M3.1-Flash" in model or "Preview" in model:
        payload["reasoning_effort"] = "low"
    else:
        payload["thinking"] = {"type": "disabled"}
    req = urllib.request.Request(
        base + "/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            body = json.load(resp)
            content = body["choices"][0]["message"]["content"]
            return True, "返回 " + str(content)[:60].replace("\n", " ")
    except urllib.error.HTTPError as err:
        if err.code == 402:
            return False, "余额不足（密钥与端点均有效）"
        return False, "HTTP %s %s" % (err.code, err.read().decode()[:110])
    except Exception as err:
        return False, type(err).__name__ + ": " + str(err)[:90]


def main():
    cfg = read_env()
    key = cfg.get("MINIMAX_API_KEY", "").strip()
    if not key:
        print("请先把官方密钥填进 .env 的 MINIMAX_API_KEY=")
        return 1
    print("已读取密钥（长度 %d，内容不显示）" % len(key))
    configured = cfg.get("MINIMAX_BASE_URL", BASES[0])
    bases = [configured] + [b for b in BASES if b != configured]
    for base in bases:
        for model in MODELS:
            ok, info = probe(base, model, key)
            print("%s | %s | %s | %s" % (base, model, "可用" if ok else "不可用", info))
            if "余额不足" in info:
                print("\n结论：密钥有效、中国区端点正确、模型名可用，只差账户余额。")
                print("请到 https://platform.minimaxi.com 充值（或领取新用户额度）后重试，配置无需改动。")
                return 3
            if ok:
                print("\n推荐写入 .env：")
                print("  MINIMAX_BASE_URL=" + base)
                print("  MINIMAX_TEXT_MODEL=" + model)
                print("  MINIMAX_VISION_MODEL=MiniMax-M3  # 实测 M3.1-Flash 带图时无 content，M3 可用")
                print("改完重启 uvicorn 即可生效。")
                return 0
    print("\n全部失败，常见原因：密钥区域不匹配 / 未实名 / 余额不足 / 密钥已失效。")
    return 2


if __name__ == "__main__":
    sys.exit(main())
