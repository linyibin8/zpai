#!/usr/bin/env python3
"""
为 zpai 创建 provisioning profile：
1. 注册 bundleId（com.linyibin8.zpai）到 ASC
2. 找到 Distribution 证书
3. 创建 App Store profile
4. 下载并安装到 ~/Library/MobileDevice/Provisioning Profiles/

读取 ios-publish.env 的 ASC_* + APPLE_TEAM_ID + APP_BUNDLE_ID。
输出 PROFILE_NAME（供 package_and_upload.sh 使用）。
"""
import base64
import os
import sys
import plistlib
import subprocess
import urllib.parse

from asc_common import api_request, env_required, env_or


def register_bundle_id(bundle_id: str, name: str, team_id: str):
    # 先查是否存在（filter 在某些 curl 场景不生效，用全量遍历兜底）
    bid = find_bundle_id(bundle_id)
    if bid:
        return bid
    # 创建
    body = {
        "data": {
            "type": "bundleIds",
            "attributes": {
                "identifier": bundle_id,
                "name": name,
                "platform": "IOS",
            },
        }
    }
    status, data = api_request("POST", "/bundleIds", body)
    if status == 201 and data:
        return data["data"]
    if status == 409:
        # 已存在，重新查
        bid = find_bundle_id(bundle_id)
        if bid:
            return bid
    print(f"WARN register bundleId returned {status}", file=sys.stderr)
    if data:
        import json
        print(json.dumps(data, ensure_ascii=False)[:300], file=sys.stderr)
    return None


def find_bundle_id(bundle_id: str):
    """全量遍历查找 bundleId（filter 在 curl 下不可靠）。"""
    status, data = api_request("GET", "/bundleIds?limit=200")
    if status == 200 and data:
        for b in data.get("data", []):
            if b.get("attributes", {}).get("identifier") == bundle_id:
                return b
    return None


def list_certificates():
    status, data = api_request("GET", "/certificates?limit=100")
    if status == 200 and data:
        return data.get("data", [])
    return []


def create_profile(bundle_id_obj, cert_ids, name, team_id):
    # 先查同名 profile
    status, data = api_request("GET", f"/profiles?filter[name]={urllib.parse.quote(name)}&limit=50")
    if status == 200 and data:
        for p in data.get("data", []):
            if p.get("attributes", {}).get("name") == name:
                # 删除旧的重建
                api_request("DELETE", f"/profiles/{p['id']}")
    body = {
        "data": {
            "type": "profiles",
            "attributes": {
                "name": name,
                "profileType": "IOS_APP_STORE",
            },
            "relationships": {
                "bundleId": {"data": {"type": "bundleIds", "id": bundle_id_obj["id"]}},
                "certificates": {"data": [{"type": "certificates", "id": c} for c in cert_ids]},
                "devices": {"data": []},
            },
        }
    }
    status, data = api_request("POST", "/profiles", body)
    if status == 201 and data:
        return data["data"]
    print(f"FAIL create profile returned {status}", file=sys.stderr)
    if data:
        import json
        print(json.dumps(data, ensure_ascii=False)[:500], file=sys.stderr)
    return None


def install_profile(profile_obj, profile_name: str):
    content = profile_obj.get("attributes", {}).get("profileContent")
    if not content:
        print("FAIL: profileContent missing", file=sys.stderr)
        sys.exit(5)
    profile_bytes = base64.b64decode(content)
    # mobileprovision 是 CMS 签名的 plist，用 security cms -D 解出 UUID
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".mobileprovision", delete=False) as tf:
        tf.write(profile_bytes)
        tmp_path = tf.name
    try:
        result = subprocess.run(
            ["security", "cms", "-D", "-i", tmp_path],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            print(f"FAIL: cannot decode profile plist: {result.stderr[:200]}", file=sys.stderr)
            sys.exit(6)
        import plistlib
        plist = plistlib.loads(result.stdout.encode("utf-8"))
        uuid = plist.get("UUID", "")
    finally:
        os.unlink(tmp_path)
    if not uuid:
        print("FAIL: cannot parse profile UUID", file=sys.stderr)
        sys.exit(6)
    dest_dir = os.path.expanduser("~/Library/MobileDevice/Provisioning Profiles")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, f"{uuid}.mobileprovision")
    with open(dest, "wb") as f:
        f.write(profile_bytes)
    print(f"OK installed profile {profile_name} -> {dest}", file=sys.stderr)
    return uuid


def main():
    bundle_id = env_required("APP_BUNDLE_ID")
    team_id = env_required("APPLE_TEAM_ID")
    profile_name = env_or("PROFILE_NAME", "zpai_appstore_profile")
    name = env_or("APP_NAME", "zpai")

    print(f"INFO bundle_id={bundle_id} profile_name={profile_name}", file=sys.stderr)

    # 1. 注册 bundleId
    bid = register_bundle_id(bundle_id, name, team_id)
    if not bid:
        print("FAIL: cannot register/find bundleId", file=sys.stderr)
        sys.exit(3)
    print(f"OK bundleId {bid['id']}", file=sys.stderr)

    # 2. 找 DISTRIBUTION 证书
    certs = list_certificates()
    dist_certs = [c for c in certs if c.get("attributes", {}).get("certificateType") == "DISTRIBUTION"]
    if not dist_certs:
        # 兜底：取所有证书
        dist_certs = certs
    if not dist_certs:
        print("FAIL: no certificates found", file=sys.stderr)
        sys.exit(4)
    cert_ids = [c["id"] for c in dist_certs]
    print(f"OK found {len(cert_ids)} distribution cert(s)", file=sys.stderr)

    # 3. 创建 profile
    profile = create_profile(bid, cert_ids, profile_name, team_id)
    if not profile:
        sys.exit(7)

    # 4. 安装
    install_profile(profile, profile_name)

    # 输出供 shell 解析
    print(f"PROFILE_NAME={profile_name}")
    print(f"PROFILE_UUID={profile_obj_uuid(profile)}", file=sys.stderr)


def profile_obj_uuid(profile):
    # profileContent 是 base64 plist，UUID 在安装时已解析；这里返回 name 兜底
    return profile.get("id", "")


if __name__ == "__main__":
    main()
