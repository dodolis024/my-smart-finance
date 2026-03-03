#!/bin/bash
# 一鍵安裝 Cursor Skills（macOS / Linux）
# 在 cursor-skills-backup 目錄下執行: ./install.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$HOME/.cursor/skills"

mkdir -p "$TARGET_DIR"

cp -r "$SCRIPT_DIR/commit-and-push-dev" "$TARGET_DIR/"
cp -r "$SCRIPT_DIR/release-to-main" "$TARGET_DIR/"

echo "✅ Skills 已安裝到 $TARGET_DIR"
echo ""
echo "已安裝："
echo "  - commit-and-push-dev"
echo "  - release-to-main"
echo ""
echo "請重啟 Cursor 或開啟新對話，即可使用。"
