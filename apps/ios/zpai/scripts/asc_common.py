#!/usr/bin/env python3
"""
zpai App Store Connect 公共工具：JWT 签名、API 请求封装。
被 ensure_asc_app.py / configure_testflight.py / check_status.py 复用。
"""
import json
import os
import sys
import subprocess
import time

import jwt  # PyJWT
from typing import Optional, Tuple


def env_required(name: str) -> str:
    v = os.environ.get(name, "").strip()
    if not v:
        print(f"FAIL: missing required env {name}", file=sys.stderr)
        sys.exit(2)
    return v


def env_or(name: str, default: str) -> str:
    return os.environ.get(name, default).strip()


def make_jwt() -> str:
    key_id = env_required("ASC_KEY_ID")
    issuer_id = env_required("ASC_ISSUER_ID")
    key_path = env_required("ASC_KEY_PATH")
    with open(key_path, "rb") as f:
        private_key = f.read()
    now = int(time.time())
    payload = {
        "iss": issuer_id,
        "iat": now,
        "exp": now + 19 * 60,
        "aud": "appstoreconnect-v1",
    }
    headers = {"alg": "ES256", "kid": key_id, "typ": "JWT"}
    return jwt.encode(payload, private_key, algorithm="ES256", headers=headers)


API_BASE = "https://api.appstoreconnect.apple.com/v1"


def api_request(method: str, path: str, body: Optional[dict] = None) -> Tuple[int, Optional[dict]]:
    """用 curl 子进程发请求（urllib 在某些网络环境被 reset，curl 更稳）。"""
    token = make_jwt()
    url = path if path.startswith("http") else f"{API_BASE}{path}"
    cmd = [
        "curl", "-sS", "-m", "60", "-X", method,
        "-H", f"Authorization: Bearer {token}",
        "-H", "Accept: application/vnd.api+json",
        "-w", "\n%{http_code}",
    ]
    if body is not None:
        cmd += ["-H", "Content-Type: application/vnd.api+json", "-d", json.dumps(body)]
    cmd.append(url)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=70)
    except subprocess.TimeoutExpired:
        return 0, {"_error": "curl timeout"}
    output = result.stdout
    # 最后一行是 http_code
    parts = output.rsplit("\n", 1)
    if len(parts) == 2:
        body_text, code_str = parts
    else:
        body_text, code_str = output, "0"
    try:
        code = int(code_str.strip())
    except ValueError:
        code = 0
        body_text = output
    if not body_text.strip():
        return code, None
    try:
        return code, json.loads(body_text)
    except Exception:
        return code, {"_raw": body_text[:500]}


def new_id() -> str:
    import uuid
    return str(uuid.uuid4())


def print_kv(label: str, value) -> None:
    """打印键值对，不打印 secret。"""
    print(f"{label}: {value}")
