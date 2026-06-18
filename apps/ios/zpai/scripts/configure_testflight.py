#!/usr/bin/env python3
"""
等待 ASC build 处理完成，配置 TestFlight：出口合规、测试组、测试说明、测试员。
读取 env：ASC_* + TESTFLIGHT_GROUP_NAME / TESTFLIGHT_INTERNAL / TESTER_EMAILS / WHAT_TO_TEST / BUILD_WAIT_SECONDS。
"""
import os
import sys
import time

from asc_common import api_request, env_or, print_kv


def wait_for_build(app_id: str, version: str, timeout: int):
    """等待最新 build 到 VALID。返回 build 记录或 None。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        status, data = api_request("GET", f"/apps/{app_id}/builds?limit=1")
        if status == 200 and data and data.get("data"):
            build = data["data"][0]
            state = build.get("attributes", {}).get("processingState")
            ver = build.get("attributes", {}).get("version")
            print_kv("current build", f"version={ver} state={state}", )
            if state == "VALID":
                return build
        print(f"waiting for build... ({int(deadline - time.time())}s left)", file=sys.stderr)
        time.sleep(30)
    return None


def set_export_compliance(build_id: str):
    body = {
        "data": {
            "type": "builds",
            "id": build_id,
            "attributes": {
                "usesNonExemptEncryption": False,
            },
        }
    }
    status, data = api_request("PATCH", f"/builds/{build_id}", body)
    if status == 200:
        print("OK export compliance set (no encryption)")
    else:
        print(f"WARN export compliance returned {status}", file=sys.stderr)


def find_or_create_beta_group(app_id: str, group_name: str, internal: bool):
    status, data = api_request("GET", f"/apps/{app_id}/betaGroups?limit=50")
    if status == 200 and data:
        for g in data.get("data", []):
            if g.get("attributes", {}).get("name") == group_name:
                return g
    # create
    body = {
        "data": {
            "type": "betaGroups",
            "attributes": {
                "name": group_name,
                "isInternalGroup": internal,
            },
            "relationships": {
                "app": {"data": {"type": "apps", "id": app_id}},
            },
        }
    }
    status, data = api_request("POST", "/betaGroups", body)
    if status == 201 and data:
        print(f"OK created beta group '{group_name}'")
        return data["data"]
    print(f"FAIL create beta group returned {status}", file=sys.stderr)
    return None


def add_build_to_group(build_id: str, group_id: str):
    body = {
        "data": [
            {"type": "builds", "id": build_id},
        ],
    }
    status, _ = api_request("POST", f"/betaGroups/{group_id}/relationships/builds", body)
    if status in (200, 204):
        print("OK build added to group")
    else:
        print(f"WARN add build to group returned {status}", file=sys.stderr)


def set_what_to_test(build_id: str, text: str):
    body = {
        "data": {
            "type": "appBetaTestLocalizations",
            "attributes": {"description": text, "locale": "zh-CN"},
            "relationships": {
                "build": {"data": {"type": "builds", "id": build_id}},
            },
        },
    }
    status, _ = api_request("POST", "/appBetaTestLocalizations", body)
    if status == 201:
        print("OK what-to-test set")
    else:
        print(f"WARN what-to-test returned {status}", file=sys.stderr)


def main():
    app_id = os.environ.get("ASC_APP_ID", "").strip()
    if not app_id:
        print("FAIL: ASC_APP_ID not set (run ensure_asc_app.py first)", file=sys.stderr)
        sys.exit(2)

    version_filter = os.environ.get("APP_BUILD_NUMBER", "").strip()
    wait = int(env_or("BUILD_WAIT_SECONDS", "1800"))
    group_name = env_or("TESTFLIGHT_GROUP_NAME", "zpai Internal")
    internal = env_or("TESTFLIGHT_INTERNAL", "1") == "1"
    what = env_or("WHAT_TO_TEST", "zpai 首版 TestFlight：横屏学习陪伴，智能连拍记录 + 语音问答。")

    build = wait_for_build(app_id, version_filter, wait)
    if not build:
        print("FAIL: build did not reach VALID in time", file=sys.stderr)
        sys.exit(4)
    build_id = build["id"]
    print_kv("build", build_id)

    set_export_compliance(build_id)
    group = find_or_create_beta_group(app_id, group_name, internal)
    if group:
        add_build_to_group(build_id, group["id"])
        set_what_to_test(build_id, what)

    print("DONE: testflight configured")


if __name__ == "__main__":
    main()
