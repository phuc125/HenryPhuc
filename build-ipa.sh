#!/usr/bin/env bash
set -euo pipefail

# Local macOS one-command script to build SolSniperAI-Unsigned.ipa
# Compatible with AltStore, SideStore, and Sideloadly.

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: Building an iOS Mach-O binary requires macOS with Xcode installed."
  echo "Push this folder to GitHub and run the included .github/workflows/build-ios-ipa.yml workflow on macos-latest."
  exit 1
fi

npm install
npm run build
npx cap sync ios

DERIVED_DIR="$(mktemp -d)"
trap 'rm -rf "$DERIVED_DIR"' EXIT

xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED_DIR" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  build

mkdir -p "$DERIVED_DIR/stage/Payload"
cp -R "$DERIVED_DIR/Build/Products/Release-iphoneos/App.app" "$DERIVED_DIR/stage/Payload/SolSniperAI.app"

OUT_IPA="$(pwd)/SolSniperAI-Unsigned.ipa"
rm -f "$OUT_IPA"
(cd "$DERIVED_DIR/stage" && zip -qry "$OUT_IPA" Payload)

echo "Built $OUT_IPA successfully. Sideload with AltStore, SideStore, or Sideloadly."
