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

# 关键：source 共享 env 后，必须强制覆盖 zpai 专属身份变量。
# 用 := 只在变量为空时生效，会被共享 env 的 com.evowit.paicc46 等值覆盖，
# 导致 IPA 被打成别的 App。这里用 export 强制赋值，确保用 zpai 的身份。
export APP_BUNDLE_ID="com.linyibin8.zpai"
export APP_NAME="zpai"
export APP_SKU="zpai001"
export APP_VERSION="0.1.0"
export APP_BUILD_NUMBER="$(date +%Y%m%d%H%M)"
export APPLE_TEAM_ID="N3G45G5H74"
export PROFILE_NAME="zpai_appstore_profile"
export TESTFLIGHT_GROUP_NAME="zpai Internal"
# 共享凭据类变量仍从 env 读（不在项目里硬编码）
: "${ASC_KEY_ID:?ASC_KEY_ID required (set in ios-publish.env)}"
: "${ASC_ISSUER_ID:?ASC_ISSUER_ID required}"
: "${ASC_KEY_PATH:?ASC_KEY_PATH required (.p8)}"
: "${SIGNING_CERTIFICATE:?SIGNING_CERTIFICATE required}"
: "${SIGNING_KEYCHAIN:?SIGNING_KEYCHAIN required}"

echo "=== [0/10] 身份校验（必须全部是 zpai）==="
echo "  APP_BUNDLE_ID = $APP_BUNDLE_ID"
echo "  APP_NAME      = $APP_NAME"
echo "  PROFILE_NAME  = $PROFILE_NAME"
[[ "$APP_BUNDLE_ID" == "com.linyibin8.zpai" ]] || { echo "FAIL: bundle id 不是 zpai，终止"; exit 1; }

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

echo "=== [3/10] ensure ASC app record + profile ==="
eval "$(python3 scripts/ensure_asc_app.py)"
: "${ASC_APP_ID:?failed to obtain ASC_APP_ID}"
echo "ASC_APP_ID=$ASC_APP_ID"
# 创建/刷新 zpai 专属 App Store profile（注册 bundleId + 用现有证书）
python3 scripts/create_profile.py || { echo "FAIL create_profile"; exit 6; }

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
# 按 plist Name 字段匹配 PROFILE_NAME（create_profile 安装的用 UUID 命名）
PROFILE_PATH=""
for f in "$HOME/Library/MobileDevice/Provisioning Profiles/"*.mobileprovision; do
  [[ -f "$f" ]] || continue
  pname="$(security cms -D -i "$f" 2>/dev/null | grep -A1 '<key>Name</key>' | grep '<string>' | head -1 | sed 's/.*<string>//;s/<.*//')"
  if [[ "$pname" == "$PROFILE_NAME" ]]; then
    PROFILE_PATH="$f"
    break
  fi
done
# 兜底：取最新
if [[ -z "$PROFILE_PATH" ]]; then
  PROFILE_PATH="$(ls -t "$HOME/Library/MobileDevice/Provisioning Profiles/"*.mobileprovision 2>/dev/null | head -1 || true)"
fi
: "${PROFILE_PATH:?no provisioning profile found}"
echo "using profile: $PROFILE_PATH (name=$PROFILE_NAME)"
cp -f "$PROFILE_PATH" "build/embedded.mobileprovision"

APP_PATH="build/$SCHEME.xcarchive/Products/Applications/$SCHEME.app"
ENTITLEMENTS="build/zpai.entitlements"
security cms -D -i "$PROFILE_PATH" > build/profile.plist 2>/dev/null || security cms -D -d "$PROFILE_PATH" > build/profile.plist
/usr/libexec/PlistBuddy -x -c "Print :Entitlements" build/profile.plist > "$ENTITLEMENTS" || true

echo "=== [7/10] codesign frameworks + app ==="
# 优先用 rcodesign + PEM 证书（不依赖 keychain，绕开 unable to build chain）
RCODESIGN="/Users/macstar/Tools/apple-codesign/apple-codesign-0.29.0-macos-universal/rcodesign"
CERT_KEY_PEM="/Users/macstar/Desktop/p12/dist_cert_private_key.pem"
CERT_PEM="/Users/macstar/Desktop/p12/distribution-cert.pem"

sign_one() {
  local target="$1"
  if [[ -f "$RCODESIGN" && -f "$CERT_KEY_PEM" && -f "$CERT_PEM" ]]; then
    "$RCODESIGN" sign \
      --pem-file "$CERT_KEY_PEM" \
      --pem-file "$CERT_PEM" \
      --timestamp-url none \
      "$target" < /dev/null
  else
    /usr/bin/codesign --force --keychain "$SIGNING_KEYCHAIN" \
      --sign "$SIGNING_CERTIFICATE" --timestamp=none "$target"
  fi
}

if [[ -n "${SIGNING_KEYCHAIN_PASSWORD:-}" ]]; then
  security unlock-keychain -p "$SIGNING_KEYCHAIN_PASSWORD" "$SIGNING_KEYCHAIN" 2>/dev/null || true
  security list-keychains -d user -s "$SIGNING_KEYCHAIN" "/Library/Keychains/System.keychain" 2>/dev/null || true
fi

if [[ -d "$APP_PATH/Frameworks" ]]; then
  while IFS= read -r -d '' fw; do
    sign_one "$fw"
  done < <(find "$APP_PATH/Frameworks" \( -name '*.framework' -o -name '*.dylib' \) -print0)
fi

if [[ -f "$RCODESIGN" && -f "$CERT_KEY_PEM" && -f "$CERT_PEM" ]]; then
  "$RCODESIGN" sign \
    --pem-file "$CERT_KEY_PEM" \
    --pem-file "$CERT_PEM" \
    --timestamp-url none \
    --entitlements-xml-file "$ENTITLEMENTS" \
    "$APP_PATH" < /dev/null
else
  /usr/bin/codesign --force --keychain "$SIGNING_KEYCHAIN" \
    --sign "$SIGNING_CERTIFICATE" \
    --entitlements "$ENTITLEMENTS" \
    --generate-entitlement-der \
    "$APP_PATH"
fi

/usr/bin/codesign --verify --deep --strict "$APP_PATH" && echo "OK codesign verified"

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
