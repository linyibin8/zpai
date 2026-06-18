#!/usr/bin/env python3
"""
zpai DNSPod API：为 zpai.evowit.com 创建 A 记录，指向广州 VPS 公网 IP。

凭据从环境变量读取（TENCENT_SECRET_ID / TENCENT_SECRET_KEY），不写入仓库。
使用 TC3-HMAC-SHA256 签名（腾讯云通用签名 v3）。

幂等：若同名记录已存在则跳过。

用法：
  export TENCENT_SECRET_ID=AKID...
  export TENCENT_SECRET_KEY=...
  python3 create_record.py
  # 或指定参数
  python3 create_record.py --domain evowit.com --sub zpai --ip 159.75.178.237
"""
import hashlib
import hmac
import json
import os
import sys
import time
import datetime
import urllib.request
import urllib.error
import argparse


SERVICE = "dnspod"
HOST = "dnspod.tencentcloudapi.com"
ENDPOINT = "https://" + HOST


def _hmac_sha256(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def sign_v3(secret_id: str, secret_key: str, action: str, payload: dict) -> dict:
    """构造腾讯云 TC3-HMAC-SHA256 签名请求。"""
    payload_str = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    timestamp = int(time.time())
    date = datetime.datetime.utcfromtimestamp(timestamp).strftime("%Y-%m-%d")

    # 1. 拼接规范请求串
    canonical_request = "\n".join([
        "POST",
        "/",
        "",
        "content-type:application/json; charset=utf-8",
        "host:" + HOST,
        "x-tc-action:" + action.lower(),
        "",
        "content-type;host;x-tc-action",
        _sha256_hex(payload_str),
    ])

    # 2. 拼接待签名串
    credential_scope = "/".join([date, SERVICE, "tc3_request"])
    hashed_canonical = _sha256_hex(canonical_request)
    string_to_sign = "\n".join([
        "TC3-HMAC-SHA256",
        str(timestamp),
        credential_scope,
        hashed_canonical,
    ])

    # 3. 计算签名
    secret_date = _hmac_sha256(("TC3" + secret_key).encode("utf-8"), date)
    secret_service = _hmac_sha256(secret_date, SERVICE)
    secret_signing = _hmac_sha256(secret_service, "tc3_request")
    signature = hmac.new(secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    # 4. Authorization 头
    authorization = (
        "TC3-HMAC-SHA256 "
        f"Credential={secret_id}/{credential_scope}, "
        f"SignedHeaders=content-type;host;x-tc-action, "
        f"Signature={signature}"
    )

    return {
        "url": ENDPOINT,
        "headers": {
            "Authorization": authorization,
            "Content-Type": "application/json; charset=utf-8",
            "Host": HOST,
            "X-TC-Action": action,
            "X-TC-Version": "2021-03-23",
            "X-TC-Timestamp": str(timestamp),
            "X-TC-Region": "",
        },
        "body": payload_str,
    }


def call(secret_id: str, secret_key: str, action: str, payload: dict) -> dict:
    req = sign_v3(secret_id, secret_key, action, payload)
    request = urllib.request.Request(
        req["url"],
        data=req["body"].encode("utf-8"),
        method="POST",
        headers=req["headers"],
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {"_http_status": e.code, "_body": e.read().decode("utf-8")}


def list_records(secret_id: str, secret_key: str, domain: str, sub: str, record_type: str = "A") -> list:
    payload = {"Domain": domain, "RecordType": record_type, "SubDomain": sub, "Limit": 100}
    res = call(secret_id, secret_key, "DescribeRecordList", payload)
    if "Response" in res and "RecordList" in res["Response"]:
        return res["Response"]["RecordList"]
    return []


def create_record(secret_id: str, secret_key: str, domain: str, sub: str, ip: str) -> dict:
    payload = {
        "Domain": domain,
        "SubDomain": sub,
        "RecordType": "A",
        "RecordLine": "默认",
        "Value": ip,
        "TTL": 300,
        "Remark": "zpai 学习陪伴工具",
    }
    return call(secret_id, secret_key, "CreateRecord", payload)


def main():
    parser = argparse.ArgumentParser(description="为 zpai 创建 DNSPod A 记录")
    parser.add_argument("--domain", default="evowit.com")
    parser.add_argument("--sub", default="zpai")
    parser.add_argument("--ip", default="159.75.178.237")
    args = parser.parse_args()

    secret_id = os.environ.get("TENCENT_SECRET_ID", "").strip()
    secret_key = os.environ.get("TENCENT_SECRET_KEY", "").strip()
    if not secret_id or not secret_key:
        print("FAIL: 请设置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY 环境变量", file=sys.stderr)
        sys.exit(2)

    # 幂等：先查是否已存在
    existing = list_records(secret_id, secret_key, args.domain, args.sub)
    if existing:
        for r in existing:
            if r.get("Value") == args.ip:
                print(f"OK: {args.sub}.{args.domain} -> {args.ip} 已存在，跳过")
                return
        print(f"WARN: {args.sub}.{args.domain} 已有记录但指向不同 IP：{[r.get('Value') for r in existing]}")

    res = create_record(secret_id, secret_key, args.domain, args.sub, args.ip)
    resp = res.get("Response", {})
    if "RecordId" in resp or "Error" not in resp:
        record_id = resp.get("RecordId", "?")
        print(f"OK: 已创建 {args.sub}.{args.domain} -> {args.ip} (RecordId={record_id})")
    else:
        err = resp.get("Error", {})
        print(f"FAIL: 创建失败 code={err.get('Code')} message={err.get('Message')}", file=sys.stderr)
        print(json.dumps(res, ensure_ascii=False, indent=2), file=sys.stderr)
        sys.exit(3)


if __name__ == "__main__":
    main()
