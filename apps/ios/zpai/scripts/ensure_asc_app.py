#!/usr/bin/env python3
"""
确保 App Store Connect 侧 zpai app record 存在。
读取 env：ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH / APP_BUNDLE_ID / APP_NAME / APP_SKU。
输出到 stdout：ASC_APP_ID=<id>（供 shell 解析）。

注意：本脚本不处理证书/profile（由 package_and_upload.sh 侧 xcodegen + codesign 处理）。
ASC API 创建 bundleId 注册和 profile 需要额外权限；如权限不足，会明确报错，
提示用 Apple ID fallback 或人工创建。
"""
import os
import sys

from asc_common import api_request, env_required, env_or, print_kv


def find_bundle_id(bundle_id: str):
    status, data = api_request("GET", f"/bundleIds?filter[identifier]={bundle_id}")
    if status == 200 and data and data.get("data"):
        return data["data"][0]
    return None


def find_app(sku: str, bundle_id: str):
    # 按 bundleId 查 app
    status, data = api_request("GET", "/apps?limit=200")
    if status != 200 or not data:
        return None
    for app in data.get("data", []):
        attrs = app.get("attributes", {})
        if attrs.get("bundleId") == bundle_id:
            return app
    return None


def create_app(name: str, bundle_id: str, sku: str, primary_locale: str = "zh-CN"):
    body = {
        "data": {
            "type": "apps",
            "attributes": {
                "name": name,
                "bundleId": bundle_id,
                "sku": sku,
                "primaryLocale": primary_locale,
            },
        }
    }
    status, data = api_request("POST", "/apps", body)
    if status == 201 and data:
        return data["data"]
    print(f"FAIL: create app returned {status}", file=sys.stderr)
    if data:
        import json
        print(json.dumps(data, ensure_ascii=False), file=sys.stderr)
    print("提示：若 API key 无权创建 app record，请在 ASC 网页手动新建 zpai app。", file=sys.stderr)
    sys.exit(3)


def main():
    bundle_id = env_required("APP_BUNDLE_ID")
    name = env_or("APP_NAME", "zpai")
    sku = env_or("APP_SKU", "zpai001")

    app = find_app(sku, bundle_id)
    if not app:
        print(f"INFO: app not found, creating {name} ({bundle_id})", file=sys.stderr)
        app = create_app(name, bundle_id, sku)
        print("OK created app record", file=sys.stderr)
    else:
        print("OK app record exists", file=sys.stderr)

    app_id = app["id"]
    # 输出供 shell 解析
    print(f"ASC_APP_ID={app_id}")


if __name__ == "__main__":
    main()
