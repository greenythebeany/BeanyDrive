#!/usr/bin/env bash
# Creates BeanyDrive's permanent Android release signing key and stores it as
# the GitHub Actions secrets .github/workflows/android-release-build.yml reads.
# Run once, from Git Bash:   bash tools/create-android-key.sh
#
# The key is written to ../BeanyDrive-signing/ (outside the repo). Back that
# folder up: every future APK must be signed with this same key, or Android
# refuses to install the update over the existing app.
set -euo pipefail

REPO=greenythebeany/BeanyDrive
DIR="$(cd "$(dirname "$0")/../.." && pwd)/BeanyDrive-signing"
mkdir -p "$DIR"
if [ -f "$DIR/release.p12" ]; then
  echo "A key already exists in $DIR — not replacing it." >&2
  exit 1
fi

PASS=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-28)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# Git Bash rewrites anything that looks like a Unix path when it calls a
# Windows program — which mangles -subj — so path conversion is switched off
# for that call, and the temp paths it needs are handed over in Windows form.
if command -v cygpath >/dev/null; then TMPW=$(cygpath -m "$TMP"); else TMPW=$TMP; fi

MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:4096 -sha256 -days 18250 -nodes \
  -keyout "$TMPW/key.pem" -out "$TMPW/cert.pem" -subj "/CN=BeanyDrive/O=GreenyBeany" 2>/dev/null
openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name beanydrive \
  -out "$DIR/release.p12" -passout "pass:$PASS" \
  -keypbe AES-256-CBC -certpbe AES-256-CBC -macalg sha256

printf 'storeFile=release.p12\nstorePassword=%s\nkeyAlias=beanydrive\nkeyPassword=%s\n' "$PASS" "$PASS" > "$DIR/keystore.properties"

base64 -w0 "$DIR/release.p12" | gh secret set ANDROID_KEYSTORE_BASE64 -R "$REPO"
printf '%s' "$PASS" | gh secret set ANDROID_KEYSTORE_PASSWORD -R "$REPO"
printf '%s' "$PASS" | gh secret set ANDROID_KEY_PASSWORD -R "$REPO"
printf 'beanydrive' | gh secret set ANDROID_KEY_ALIAS -R "$REPO"

echo
echo "Key saved to $DIR — back this folder up somewhere private."
echo "Secrets set on $REPO. Rebuild the APK with:"
echo "  gh run rerun 40195394609 -R $REPO"
