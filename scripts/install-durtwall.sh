#!/usr/bin/env sh
set -eu

version="${DURTWALL_VERSION:-latest}"
base_url="${DURTWALL_RELEASE_BASE_URL:?Set DURTWALL_RELEASE_BASE_URL to the trusted release host}"
arch="$(uname -m)"
case "$arch" in
  x86_64) target="amd64" ;;
  aarch64|arm64) target="arm64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

asset="durtwall-linux-${target}"
tmp="$(mktemp)"
trap 'rm -f "$tmp" "$tmp.sha256"' EXIT
curl --fail --location --proto '=https' --tlsv1.2 "${base_url}/${version}/${asset}" -o "$tmp"
curl --fail --location --proto '=https' --tlsv1.2 "${base_url}/${version}/${asset}.sha256" -o "$tmp.sha256"
expected="$(awk '{print $1}' "$tmp.sha256")"
actual="$(sha256sum "$tmp" | awk '{print $1}')"
[ "$expected" = "$actual" ] || { echo "Checksum verification failed" >&2; exit 1; }
install -m 0755 "$tmp" "${DURTWALL_INSTALL_PATH:-/usr/local/bin/durtwall}"
echo "Installed durtwall ${version} (${target})"
