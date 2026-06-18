#!/usr/bin/env python3
"""
查询 zpai 在 ASC 的 app、最新 build、TestFlight 组状态。只报告 OK/FAIL，不打印 secret。
"""
import os
import sys

from asc_common import api_request, env_required, print_kv


def main():
    bundle_id = env_required("APP_BUNDLE_ID")
    status, data = api_request("GET", "/apps?limit=200")
    if status != 200 or not data:
        print("FAIL: cannot list apps")
        sys.exit(1)

    app = None
    for a in data.get("data", []):
        if a.get("attributes", {}).get("bundleId") == bundle_id:
            app = a
            break
    if not app:
        print(f"FAIL: app with bundleId {bundle_id} not found")
        sys.exit(1)

    print_kv("app", f"{app['attributes'].get('name')} ({app['id']})")

    status, data = api_request("GET", f"/apps/{app['id']}/builds?limit=1")
    if status == 200 and data and data.get("data"):
        b = data["data"][0]
        attrs = b.get("attributes", {})
        print_kv("latest build", f"version={attrs.get('version')} state={attrs.get('processingState')}")

    status, data = api_request("GET", f"/apps/{app['id']}/betaGroups?limit=10")
    if status == 200 and data:
        for g in data.get("data", []):
            print_kv("beta group", f"{g['attributes'].get('name')} (id={g['id']})")

    print("OK")


if __name__ == "__main__":
    main()
