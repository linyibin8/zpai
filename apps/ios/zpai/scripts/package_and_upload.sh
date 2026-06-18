#!/usr/bin/env bash
#
# zpai 一键 TestFlight 发布脚本（在 macstar 发布机执行）。
#
# 流程：
#   1. source ios-publish.env（ASC key/team/profile/testflight 配置）
#   2. 解锁专用 keychain
#   3. 生成 app icon
#   4. ensure ASC app record 存在
#   5. xcodegen 生成工程
#   6. xcodebuild archive（未签名）
#   7. 嵌入 profile + codesign
#   8. 打包 IPA
#   9. altool 上传 TestFlight
#  10. configure_testflight（出口合规/测试组/说明）
#
# 用法：cd <remote-ios-project-dir> && ./scripts/package_and_upload.sh
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"
SCHEME="zpai"

ENV_FILE="${IOS_PUBLISH_ENV:-/Users/macstar/testflight-auto/ios-publish.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi

: "${APP_BUNDLE_ID:=com.linyibin8.zpai}"
: "${APP_NAME:=zpai}"
: "${APP_VERSION:=0.1.0}"
: "${APP_BUILD_NUMBER:=$(date +%Y%m%d%H%M)}"
: "${APPLE_TEAM_ID:=N3G45G5H74}"
: "${ASC_KEY_ID:?ASC_KEY_ID required (set in ios-publish.env)}"
: "${ASC_ISSUER_ID:?ASC_ISSUER_ID required}"
: "${ASC_KEY_PATH:?ASC_KEY_PATH required (.p8)}"
: "${SIGNING_CERTIFICATE:?SIGNING_CERTIFICATE required}"
: "${SIGNING_KEYCHAIN:?SIGNING_KEYCHAIN required}"

echo "=== [1/10] unlock keychain ==="
if [[ -n "${SIGNING_KEYCHAIN_PASSWORD:-}" ]]; then
  security unlock-keychain -p "$SIGNING_KEYCHAIN_PASSWORD" "$SIGNING_KEYCHAIN" || true
  security list-keychains -d user -s "$SIGNING_KEYCHAIN" login.keychain-db || true
fi

echo "=== [2/10] copy ASC key + generate icon ==="
mkdir -p private_keys
cp -f "$ASC_KEY_PATH" "private_keys/AuthKey_${ASC_KEY_ID}.p8"
mkdir -p "$HOME/.private_keys"
cp -f "$ASC_KEY_PATH" "$HOME/.private_keys/AuthKey_${ASC_KEY_ID}.p8"
python3 scripts/generate_app_icons.py "$PROJECT_DIR"

echo "=== [3/10] ensure ASC app record ==="
eval "$(python3 scripts/ensure_asc_app.py)"
: "${ASC_APP_ID:?failed to obtain ASC_APP_ID}"
echo "ASC_APP_ID=$ASC_APP_ID"

echo "=== [4/10] xcodegen ==="
xcodegen generate 2>/dev/null || xcodegen generate --spec project.yml

echo "=== [5/10] archive (unsigned) ==="
rm -rf build
xcodebuild archive \
  -project "$SCHEME.xcodeproj" \
  -scheme "$SCHEME" \
  -configuration Release \
  -archivePath "build/$SCHEME.xcarchive" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  PRODUCT_BUNDLE_IDENTIFIER="$APP_BUNDLE_ID" \
  MARKETING_VERSION="$APP_VERSION" \
  CURRENT_PROJECT_VERSION="$APP_BUILD_NUMBER"

echo "=== [6/10] embed profile + extract entitlements ==="
PROFILE_NAME="${PROFILE_NAME:-}"
if [[ -z "$PROFILE_NAME" ]]; then
  # 取最新 App Store profile
  PROFILE_PATH="$(ls -t "$HOME/Library/MobileDevice/Provisioning Profiles/"*.mobileprovision 2>/dev/null | head -1 || true)"
else
  PROFILE_PATH="$HOME/Library/MobileDevice/Provisioning Profiles/${PROFILE_NAME}.mobileprovision"
fi
: "${PROFILE_PATH:?no provisioning profile found}"
cp -f "$PROFILE_PATH" "build/embedded.mobileprovision"

APP_PATH="build/$SCHEME.xcarchive/Products/Applications/$SCHEME.app"
ENTITLEMENTS="build/zpai.entitlements"
security cms -D -d "$PROFILE_PATH" > build/profile.plist
/usr/libexec/PlistBuddy -x -c "Print :Entitlements" build/profile.plist > "$ENTITLEMENTS" || true

echo "=== [7/10] codesign frameworks + app ==="
if [[ -d "$APP_PATH/Frameworks" ]]; then
  find "$APP_PATH/Frameworks" -name "*.framework" -o -name "*.dylib" | while read -r fw; do
    codesign --force --sign "$SIGNING_CERTIFICATE" --keychain "$SIGNING_KEYCHAIN" --timestamp=none "$fw"
  done
fi
codesign --force --sign "$SIGNING_CERTIFICATE" \
  --keychain "$SIGNING_KEYCHAIN" \
  --entitlements "$ENTITLEMENTS" \
  --timestamp=none \
  "$APP_PATH"

codesign --verify --deep --strict "$APP_PATH" && echo "OK codesign verified"

echo "=== [8/10] package IPA ==="
mkdir -p build/export/Payload
cp -R "$APP_PATH" "build/export/Payload/"
# SwiftSupport
if [[ -d "$APP_PATH/Frameworks" ]]; then
  mkdir -p "build/export/SwiftSupport"
  cp -R "$APP_PATH/Frameworks/"* "build/export/SwiftSupport/" 2>/dev/null || true
fi
cd build/export
zip -qr "$SCHEME.ipa" Payload SwiftSupport 2>/dev/null || zip -qr "$SCHEME.ipa" Payload
cd "$PROJECT_DIR"
echo "IPA: build/export/$SCHEME.ipa"

echo "=== [9/10] upload to TestFlight (altool) ==="
xcrun altool --upload-app \
  -f "build/export/$SCHEME.ipa" \
  -t ios \
  --apiKey "$ASC_KEY_ID" \
  --apiIssuer "$ASC_ISSUER_ID" \
  --type ios || { echo "FAIL altool upload"; exit 5; }
echo "OK uploaded"

echo "=== [10/10] configure testflight ==="
python3 scripts/configure_testflight.py || { echo "WARN testflight configure failed (can retry)"; }

echo ""
echo "==============================="
echo "FULL PIPELINE COMPLETED"
echo "build=$APP_VERSION ($APP_BUILD_NUMBER)"
echo "==============================="
