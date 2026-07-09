#!/usr/bin/env bash
#
# Smart Finance — Supabase 資料備份腳本
#
# 用途:把 prod 全部資料表(結構 + 資料)dump 到 backup/,可完整還原。
# 手動執行:  bash scripts/backup-db.sh
# 自動執行:  由 ~/Library/LaunchAgents/com.smartfinance.backup.plist 每週呼叫。
#
# 注意:launchd 不繼承終端機環境變數,故此腳本自己設定 PATH 並從固定檔案讀密碼。

set -euo pipefail

# --- 固定設定 ---------------------------------------------------------------
PROJECT_DIR="/Users/doris/Documents/my-smart-finance"
SECRETS_FILE="$HOME/.smart-finance-backup.env"   # 內含 SUPABASE_DB_PASSWORD=...
BACKUP_DIR="$PROJECT_DIR/backup"
KEEP=8                                            # 保留最近幾組備份(每週一組 ≈ 兩個月)

# launchd 的 PATH 不含 homebrew,必須自己補
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# --- 前置檢查 ---------------------------------------------------------------
cd "$PROJECT_DIR"   # --linked 需要在專案目錄下讀 supabase/.temp/

if [ ! -f "$SECRETS_FILE" ]; then
  echo "[備份失敗] 找不到密碼檔:$SECRETS_FILE" >&2
  echo "請建立該檔並填入:SUPABASE_DB_PASSWORD=你的DB密碼" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$SECRETS_FILE"

if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "[備份失敗] $SECRETS_FILE 內沒有 SUPABASE_DB_PASSWORD" >&2
  exit 1
fi

# supabase db dump 需要 Docker 來跑對應版本的 pg_dump,launchd 自動觸發時 OrbStack
# 不一定在跑,所以自動幫忙開啟並等待 daemon 就緒(最多等 60 秒)。
if ! docker info >/dev/null 2>&1; then
  echo "[備份] Docker 未啟動,嘗試開啟 OrbStack..."
  open -a OrbStack
  for i in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then
      echo "[備份] Docker daemon 已就緒(等了 ${i} 秒)"
      break
    fi
    sleep 1
  done
  if ! docker info >/dev/null 2>&1; then
    echo "[備份失敗] 等待 60 秒後 Docker daemon 仍未就緒" >&2
    exit 1
  fi
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
SCHEMA_FILE="$BACKUP_DIR/${STAMP}_schema.sql"
DATA_FILE="$BACKUP_DIR/${STAMP}_data.sql"

echo "[備份] 開始 $(date '+%Y-%m-%d %H:%M:%S')"

# --- 1) 結構(schema)------------------------------------------------------
supabase db dump --linked -p "$SUPABASE_DB_PASSWORD" -f "$SCHEMA_FILE"

# --- 2) 資料(data-only,用 COPY 較快且較穩)-------------------------------
supabase db dump --linked -p "$SUPABASE_DB_PASSWORD" --data-only --use-copy -f "$DATA_FILE"

# --- 3) 基本健檢:檔案要存在且非空 -----------------------------------------
for f in "$SCHEMA_FILE" "$DATA_FILE"; do
  if [ ! -s "$f" ]; then
    echo "[備份失敗] 產出檔為空:$f" >&2
    exit 1
  fi
done

echo "[備份] 完成:"
echo "  結構 → $SCHEMA_FILE ($(du -h "$SCHEMA_FILE" | cut -f1))"
echo "  資料 → $DATA_FILE ($(du -h "$DATA_FILE" | cut -f1))"

# --- 4) 輪替:只保留最近 KEEP 組(schema/data 各自算)-----------------------
prune() {
  local pattern="$1"
  ls -1t "$BACKUP_DIR"/*"$pattern".sql 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    echo "[備份] 刪除舊檔:$old"
    rm -f "$old"
  done
}
prune "_schema"
prune "_data"

echo "[備份] 全部完成 $(date '+%Y-%m-%d %H:%M:%S')"
