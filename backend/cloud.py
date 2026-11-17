"""Hosted entry point for the invite-only planning API."""
from collections import deque
from hashlib import sha256
from hmac import compare_digest
import os
from time import monotonic

from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.main import app, provider_settings


WEB_ORIGIN = os.environ["HAOHAO_WEB_ORIGIN"]
ACCESS_CODE = os.environ.get("HAOHAO_ACCESS_CODE", "").encode()
if len(ACCESS_CODE) < 20:
    raise RuntimeError("HAOHAO_ACCESS_CODE must contain at least 20 characters")
ACCESS_CODE_HASHES = (
    sha256(ACCESS_CODE).hexdigest().encode("ascii"),
    *os.environ.get("HAOHAO_INVITE_HASHES", "").encode().split(),
)

AI_ROUTES = {"/api/plan", "/api/layouts", "/api/furnishings"}
MAX_BODY_BYTES = 32_000_000
REQUESTS_PER_HOUR = 30
MAX_ACTIVE_REQUESTS = 2
starts = deque()
active = 0


def error(status, detail):
    return JSONResponse({"detail": detail}, status_code=status)


@app.get("/api/access", include_in_schema=False)
async def access():
    key, *_ = provider_settings(None)
    if not key:
        return error(503, "线上 AI 尚未配置。")
    return {"enabled": True}


@app.middleware("http")
async def protect_cloud_api(request: Request, call_next):
    global active
    route = (request.method, request.url.path)
    if route == ("GET", "/api/health"):
        return await call_next(request)

    checking = route == ("GET", "/api/access")
    if not checking and (request.method != "POST" or request.url.path not in AI_ROUTES):
        return error(404, "此接口未在线上开放。")

    supplied = request.headers.get("X-Access-Code", "").encode()
    supplied_hash = sha256(supplied).hexdigest().encode("ascii")
    if not any(compare_digest(supplied_hash, expected) for expected in ACCESS_CODE_HASHES):
        return error(401, "邀请码无效。")
    if checking:
        return await call_next(request)

    size = request.headers.get("Content-Length")
    if size is None or not size.isdecimal():
        return error(411, "请求缺少有效的内容长度。")
    if int(size) > MAX_BODY_BYTES:
        return error(413, "图片和参考图总大小超过限制，请缩小图片后重试。")

    now = monotonic()
    while starts and starts[0] <= now - 3600:
        starts.popleft()
    if len(starts) >= REQUESTS_PER_HOUR or active >= MAX_ACTIVE_REQUESTS:
        return error(429, "线上 AI 暂时达到使用上限，请稍后再试。")

    starts.append(now)
    active += 1
    try:
        return await call_next(request)
    finally:
        active -= 1


app.add_middleware(
    CORSMiddleware,
    allow_origins=[WEB_ORIGIN],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Access-Code"],
)
