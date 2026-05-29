#!/usr/bin/env bash
# 构建 Go sidecar 二进制供 Tauri 桌面端使用
#
# 用法:
#   bash desktop/scripts/build-sidecar.sh             # dev 构建（当前平台）
#   bash desktop/scripts/build-sidecar.sh --production # release 构建（当前平台）
#
# 产物：desktop/bin/nowen-video-<target>

set -euo pipefail

PRODUCTION=false
for arg in "$@"; do
    case $arg in
        --production|-p)
            PRODUCTION=true
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$DESKTOP_ROOT/.." && pwd)"

normalize_version() {
    local raw="${1:-}"
    raw="${raw#refs/tags/}"
    raw="${raw#v}"
    if [[ "$raw" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
        echo "$raw"
    fi
}

resolve_app_version() {
    local candidate
    for candidate in "${NOWEN_VERSION:-}" "${APP_VERSION:-}" "${GITHUB_REF_NAME:-}"; do
        normalized="$(normalize_version "$candidate")"
        if [[ -n "$normalized" ]]; then echo "$normalized"; return; fi
    done

    if tag="$(git -C "$PROJECT_ROOT" describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null)"; then
        normalized="$(normalize_version "$tag")"
        if [[ -n "$normalized" ]]; then echo "$normalized"; return; fi
    fi

    echo "0.1.0"
}

APP_VERSION_RESOLVED="$(resolve_app_version)"
export NOWEN_VERSION="$APP_VERSION_RESOLVED"

echo "====================================="
echo " 构建 nowen-video Go sidecar"
echo "====================================="
echo "项目根: $PROJECT_ROOT"
echo "产物目录: $DESKTOP_ROOT/bin"
echo "应用版本: $APP_VERSION_RESOLVED"

BIN_DIR="$DESKTOP_ROOT/bin"
mkdir -p "$BIN_DIR"

GO_OS="$(go env GOOS)"
GO_ARCH="$(go env GOARCH)"

case "${GO_OS}/${GO_ARCH}" in
    linux/amd64)   TRIPLE="x86_64-unknown-linux-gnu"  ;;
    linux/arm64)   TRIPLE="aarch64-unknown-linux-gnu" ;;
    darwin/amd64)  TRIPLE="x86_64-apple-darwin"       ;;
    darwin/arm64)  TRIPLE="aarch64-apple-darwin"      ;;
    windows/amd64) TRIPLE="x86_64-pc-windows-msvc"    ;;
    windows/arm64) TRIPLE="aarch64-pc-windows-msvc"   ;;
    *)
        echo "❌ 未识别的平台: ${GO_OS}/${GO_ARCH}"
        exit 1
        ;;
esac

EXT=""
if [[ "$GO_OS" == "windows" ]]; then
    EXT=".exe"
fi

OUT_NAME="nowen-video-${TRIPLE}${EXT}"
OUT_PATH="${BIN_DIR}/${OUT_NAME}"

VERSION_PACKAGE="github.com/nowen-video/nowen-video/internal/version.Version"
BUILD_ARGS=("-ldflags" "-s -w -X ${VERSION_PACKAGE}=${APP_VERSION_RESOLVED}" "-o" "$OUT_PATH")
if [[ "$PRODUCTION" == "true" ]]; then
    BUILD_ARGS+=("-trimpath")
fi
BUILD_ARGS+=("./cmd/server")

echo "go build ${BUILD_ARGS[*]}"

cd "$PROJECT_ROOT"
go build "${BUILD_ARGS[@]}"

# 同时复制一份不带 triple 的版本（dev 模式方便使用）
DEV_COPY="${BIN_DIR}/nowen-video${EXT}"
cp "$OUT_PATH" "$DEV_COPY"

# 复制默认配置（若 bin/ 下不存在 config.yaml）
CONFIG_EXAMPLE="${PROJECT_ROOT}/config.example.yaml"
CONFIG_TARGET="${BIN_DIR}/config.yaml"
if [[ -f "$CONFIG_EXAMPLE" && ! -f "$CONFIG_TARGET" ]]; then
    cp "$CONFIG_EXAMPLE" "$CONFIG_TARGET"
    echo "  已复制默认配置: $CONFIG_TARGET"
fi

SIZE=$(du -h "$OUT_PATH" | cut -f1)
echo ""
echo "✅ 构建完成"
echo "  $OUT_PATH"
echo "  $DEV_COPY"
echo "  大小: $SIZE"
