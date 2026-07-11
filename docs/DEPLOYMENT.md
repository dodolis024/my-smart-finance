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

## 部署帳(prod 狀態的單一事實來源)

> 慣例:任何改變 prod 狀態的動作(執行 scripts/*.sql、重跑 database/*.sql、
> deploy edge function、改 cron)完成後,在對應表格記一行。前端 release 不用記
> (GitHub Pages 自動部署,git log 即紀錄)。

### 一次性 SQL 腳本執行紀錄

| 腳本 | 用途摘要 | prod 執行日期 |
|---|---|---|
| scripts/fix-cron-http-extension.sql | 修正 cron 的 HTTP 呼叫語法 | 2026-07-08 前(已結清,精確日不可考) |
| scripts/setup-auto-exchange-rates.sql | 建立每日匯率更新排程 | 同上 |
| scripts/update-cron-schedule.sql | 匯率排程改 UTC 02:00 | 同上 |
| scripts/fix-security-hardening.sql | REVOKE/ownership trigger/search_path | 同上 |
| scripts/fix-data-integrity.sql | push UPDATE policy/原子更新 RPC/匯率回 NULL | 同上 |
| scripts/fix-query-optimization.sql | 範圍查詢/批次頭像 RPC | 同上 |
| scripts/fix-drop-current-balance-formula.sql | 移除死欄位 | 同上 |
| scripts/fix-user-emails-rpc.sql | get_user_emails RPC | 2026-07-08 |
| scripts/fix-split-atomic-add-and-rate-guard.sql | add_split_expense/成員歸屬檢查/匯率守門/重同步日期 | 2026-07-11 |
| scripts/fix-split-error-codes.sql | 分帳 6 個 RPC 的 RAISE 訊息改為錯誤碼(供前端 i18n 對映) | 2026-07-11 |

### 正式定義檔重跑紀錄

| 檔案 | 內容 | 執行日期 |
|---|---|---|
| database/streak-freeze-migration.sql + supabase-functions.sql | 凍結卡表 + reconcile RPC(v1.20) | 約 2026-07-09 |
| database/subscriptions-migration.sql | FK 行為與 prod 核對一致(`ON DELETE SET NULL`),檔頭聲明已更新 | 2026-07-11(核對,非重跑) |
| database/supabase-functions.sql | freeze 最長連續改合併分段 | 2026-07-11 |

### Edge Functions 部署紀錄

| 函式 | 最後部署 | version | 備註 |
|---|---|---|---|
| update-exchange-rates | 2026-07-07 | v16 | |
| send-streak-reminder | 2026-07-11 | v24 | 通知多語化(`47f7b9b`)重新部署,取代先前記錄的 2026-07-08 v22 |
| send-split-notification | 2026-07-11 | v8 | 同上 |
| send-credit-card-reminder | 2026-07-11 | v4 | 同上,repo 自 2026-03-26 起僅此次改動 |
| send-credit-usage-alert | 2026-07-11 | v4 | 同上 |
| process-subscriptions | 2026-07-10 | v6 | 匯率查無改跳過該筆 |

(以 `supabase functions list` 的 updated_at/version 為準;2026-07-11 已核對)

### pg_cron 排程

| jobname | schedule | active |
|---|---|---|
| process-subscriptions-daily | `0 1 * * *` | true |
| send-streak-reminder-hourly | `*/5 * * * *` | true |
| update-exchange-rates-daily | `0 2 * * *` | true |

> 2026-07-11 核對。注意:`send-streak-reminder-hourly` 命名為 hourly,但實際排程是每 5 分鐘一次——命名與實際排程不符,先如實記錄,是否改名或改頻率待你決定,本次不動它。
> command 欄位不記錄於此(內含 anon key)。

### 落後偵測方法

懷疑 prod 落後 repo 時:
- Edge functions:`supabase functions list` 的 updated_at 對照 `git log -- supabase/functions/<name>/` 最後改動日。
- SQL:本表最後一行對照 `git log -- database/ scripts/`;必要時在 SQL Editor 以 `\df` 或 pg_proc 查函式定義抽查。
