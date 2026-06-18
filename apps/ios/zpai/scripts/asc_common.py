#!/usr/bin/env python3
"""
zpai App Store Connect 公共工具：JWT 签名、API 请求封装。
被 ensure_asc_app.py / configure_testflight.py / check_status.py 复用。
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
import uuid

import jwt  # PyJWT
from typing import Optional, Tuple, Any


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
    token = make_jwt()
    url = path if path.startswith("http") else f"{API_BASE}{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.api+json",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/vnd.api+json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"_raw": raw}
    except Exception as e:
        return 0, {"_error": str(e)}


def new_id() -> str:
    return str(uuid.uuid4())


def print_kv(label: str, value) -> None:
    """打印键值对，不打印 secret。"""
    print(f"{label}: {value}")
