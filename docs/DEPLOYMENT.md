# 部署與維運文件

## Supabase 專案
- 方案:Free tier(**無自動備份**,需自行備份)
- Project ref:rlahfuzsxfbocmkecqvg
- Postgres:17.x

## 資料備份

### 機制
- 腳本:`scripts/backup-db.sh`,dump prod 全部 13 張表(結構 + 資料)到 `backup/`(已 gitignore)。
- 自動:macOS launchd `com.smartfinance.backup.plist`,每週日 10:00 自動跑一次。
- 手動:任何時候可執行 `bash scripts/backup-db.sh` 立即備份(例如危險操作前)。
- 密碼:存在 `~/.smart-finance-backup.env`(chmod 600,不進 git)。

### 前置需求
- `supabase db dump --linked` 需要 **Docker**(本機用 OrbStack)來跑對應 Postgres 版本的映像檔,確保 `pg_dump` 版本一致。腳本會自動偵測 Docker 是否在跑,沒開的話會自動 `open -a OrbStack` 並等待 daemon 就緒(最多 60 秒),不需要手動確保 OrbStack 常駐背景。
- 若剛在 Dashboard 重設過 Database password,**pooler 可能需要約 1 分鐘才會同步新密碼**,期間執行備份會出現 `password authentication failed`,屬正常現象,稍等後重試即可。
- **`/bin/bash` 需要「完整磁碟取用權限」**:專案在 `~/Documents` 底下,launchd 背景任務預設會被 macOS 隱私保護(TCC)擋下讀寫權限,手動在 Terminal 執行不受影響、只有 launchd 自動觸發時才會出現 `Operation not permitted`。設定路徑:系統設定 → 隱私權與安全性 → 完整磁碟取用權限 → 加入 `/bin/bash`。換機或重裝系統後若自動備份突然失效,先檢查這個設定。

### 還原步驟(把 dump 灌回一個 Supabase 專案)
1. 準備目標資料庫連線字串(Dashboard → Settings → Database → Connection string,URI 格式)。
2. 先還原結構:
   `psql "<connection-string>" -f backup/<日期>_schema.sql`
   (若本機沒有 psql:`brew install libpq` 後把 `/opt/homebrew/opt/libpq/bin` 加進 PATH)
3. 再還原資料:
   `psql "<connection-string>" -f backup/<日期>_data.sql`
4. 驗證:登入 App 或用 SQL 檢查 `transactions`、`accounts` 等表筆數是否正確。

### 備份紀錄
> 每次「手動」備份在此記一行日期(自動備份的紀錄看 backup/ 內檔名時間戳即可)。

- 2026-07-09:首次建立備份機制,手動驗證成功(13 張表 schema + data 皆正確 dump)。
