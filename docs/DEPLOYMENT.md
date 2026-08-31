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
| scripts/fix-split-join-auth-and-decimal-list.sql | join/link RPC 加登入檢查/零小數幣別清單對齊前端/DETAIL 分隔符改 ", " | 2026-07-11 |
| scripts/fix-add-transaction-time.sql | transactions 新增 time 欄位,既有資料以 created_at 回填 | 2026-08-25 |
| scripts/fix-cron-exchange-rate-url.sql | 匯率排程 command 內的 placeholder URL 改實際 URL,並手動觸發補回匯率 | 2026-08-26 |
| scripts/fix-cron-streak-reminder-timeout.sql | 提醒排程的 HTTP 逾時 5 秒放寬為 30 秒(以 alter_job 只覆寫 command,不重建 job) | 2026-08-27 |
| scripts/add-cron-secret-header.sql | 匯率／提醒兩個排程的 command 加上 `x-cron-secret` header(搭配 Edge Function 驗證) | 2026-08-27 |
| scripts/fix-split-member-access.sql | 分帳成員存取權收斂:加入群組一律需通過邀請碼驗證,成員查詢範圍限本人相關群組 | 2026-08-31 |
| scripts/fix-split-avatar-rpc.sql | 批次頭像 RPC 的呼叫者權限檢查 | 2026-08-31 |
| scripts/fix-cron-auth-and-credit-card-schedule.sql | 訂閱排程的 command 加上 `x-cron-secret` header;補建從未建立的 credit-card-reminder-daily 排程 | 2026-08-31 |
| scripts/fix-invite-code-hardening.sql | 邀請碼查詢加登入檢查;產生器改 10 碼 gen_random_bytes;既有 5 組邀請碼一次性輪換 | 2026-08-31 |

> 2026-08-31:`fix-invite-code-hardening.sql` 的第 4 段把當時全部 5 個群組的邀請碼
> 換掉了,**舊的邀請連結與代碼自此失效**,使用者若回報「連結打不開」是這個原因,
> 請他到群組明細頁重新複製。已加入的成員不受影響(成員資格存在 split_members,
> 與邀請碼無關)。舊碼刻意未留副本——留一份對照表等於把剛換掉的鑰匙抄在門口。
>
> 輪換必須暫停 `protect_split_group_ownership` trigger:該 trigger 在
> `auth.uid() IS NULL` 時就擋 invite_code 變更,而 SQL Editor 裡 auth.uid() 正是 NULL。
> 日後任何在 SQL Editor 直接改 split_groups.owner_id 或 invite_code 的操作都會撞到,
> 記得包在 DO 區塊內停用再還原(單一交易,中途失敗會連同停用一起 rollback)。
>
> 另注意 Supabase SQL Editor **執行多段 SQL 時只顯示最後一句的輸出**,
> 驗證查詢要合併成單一句,否則前面幾項等於沒驗(與 RAISE NOTICE 不顯示同類)。

### 正式定義檔重跑紀錄

| 檔案 | 內容 | 執行日期 |
|---|---|---|
| database/streak-freeze-migration.sql + supabase-functions.sql | 凍結卡表 + reconcile RPC(v1.20) | 約 2026-07-09 |
| database/subscriptions-migration.sql | FK 行為與 prod 核對一致(`ON DELETE SET NULL`),檔頭聲明已更新 | 2026-07-11(核對,非重跑) |
| database/supabase-functions.sql | freeze 最長連續改合併分段 | 2026-07-11 |
| database/supabase-functions.sql | get_dashboard_data 回傳 time 欄位,排序改 date+time+created_at | 2026-08-25 |

> 2026-08-25 這次重跑有副作用:當時檔內的 exchange_rates 種子是
> `ON CONFLICT DO UPDATE`,把 TWD/USD/JPY/EUR/GBP 五個幣別的真實匯率覆寫回種子值
> (USD 30/EUR 32/GBP 38),並蓋上新的 updated_at,看起來像剛更新過。
> 已於 2026-08-26 將兩個定義檔的種子改為 `DO NOTHING`,重跑不會再踩到既有匯率。

### Edge Functions 部署紀錄

| 函式 | 最後部署 | version | 備註 |
|---|---|---|---|
| update-exchange-rates | 2026-08-27 | v19 | 加 `x-cron-secret` 驗證(取代 2026-08-26 v17 的陳舊值例外版,該邏輯保留) |
| send-streak-reminder | 2026-08-27 | v26 | 加 `x-cron-secret` 驗證(取代 2026-07-11 v24 的通知多語化版,該邏輯保留) |
| send-split-notification | 2026-07-11 | v9 | 同上 |
| send-credit-card-reminder | 2026-08-31 | v6 | 加 `x-cron-secret` 驗證;繳款提醒改為未設定過即視同未啟用 |
| send-credit-usage-alert | 2026-08-31 | v6 | 額度警告改為未設定過即視同未啟用(呼叫端是前端,不加 cron 密鑰) |
| process-subscriptions | 2026-08-31 | v9 | 加 `x-cron-secret` 驗證 |

(以 `supabase functions list` 的 updated_at/version 為準;2026-08-31 已核對)

### Edge Function 的 cron 密鑰(CRON_SECRET)

2026-08-27 起,`update-exchange-rates` 與 `send-streak-reminder`;2026-08-31 起再加上
`process-subscriptions` 與 `send-credit-card-reminder`,只接受帶正確
`x-cron-secret` header 的請求(`supabase/functions/_shared/cronAuth.ts`)。
四支的呼叫端都只有 pg_cron,密鑰同時存在兩個地方:

- Supabase secrets 的 `CRON_SECRET`(函式端比對用)
- 四個 cron job 的 command 內(呼叫端夾帶用,見 `scripts/add-cron-secret-header.sql`
  與 `scripts/fix-cron-auth-and-credit-card-schedule.sql`)

> **為什麼不是 verify_jwt**:cron 帶的 publishable key 同樣寫在前端 bundle 內人人可得,
> 改 true 只是把門檻從「知道網址」變成「知道網址＋抄一把公開 key」。防線在函式內,
> verify_jwt 是什麼值都不影響這個判斷——實際上這四支兩種值都有(前兩支 false、
> 後兩支 true),2026-08-31 實測後兩支帶上那把公開 key 即可長驅直入,佐證了這一點。
>
> ⚠️ **測試時務必帶 `Authorization`/`apikey`**:對 verify_jwt = true 的函式,完全不帶
> header 會被平台閘道擋在 `{"code":"UNAUTHORIZED_NO_AUTH_HEADER"}`,請求根本進不到
> 函式。那個 401 是閘道給的,證明不了 guard 有沒有裝上,很容易誤判成驗證通過。
> 看回應內容分辨:`{"success":false,"error":"unauthorized"}` 才是函式自己的 guard。
>
> ⚠️ **fail closed**:`CRON_SECRET` 被刪或改掉而 cron command 沒同步更新時,
> 兩支函式會回 401 拒絕**所有**請求——匯率停更、提醒信停寄,而 cron.job_run_details
> 仍記為 succeeded(HTTP 有回應)。匯率或提醒突然失效時,這裡是第一個該查的地方。
>
> 輪換順序:先改 cron command 內的密鑰,再 `supabase secrets set`(中間有短暫空窗,
> 詳見 `scripts/add-cron-secret-header.sql` 檔尾)。
>
> 已知缺口:`send-split-notification` 與 `send-credit-usage-alert` 的呼叫端是前端,
> 不適用此方案(密鑰放前端等於公開),待另外評估。

### pg_cron 排程

| jobname | schedule | active |
|---|---|---|
| credit-card-reminder-daily | `0 1 * * *` | true |
| process-subscriptions-daily | `0 1 * * *` | true |
| send-streak-reminder-hourly | `*/5 * * * *` | true |
| update-exchange-rates-daily | `0 2 * * *` | true |

> 2026-08-31 核對。注意:`send-streak-reminder-hourly` 命名為 hourly,但實際排程是每 5 分鐘一次——命名與實際排程不符,先如實記錄,是否改名或改頻率待你決定,本次不動它。
> command 欄位不記錄於此(內含 anon key)。
>
> 2026-08-26:`update-exchange-rates-daily` 的 command 內是未替換的
> `<YOUR_SUPABASE_URL>`,自 2026-07-03 前後起每天 Bad hostname 失敗,匯率停擺 53 天。
> 起因是 `scripts/update-cron-schedule.sql`(placeholder 模板)被原封執行,
> 而該腳本的驗證查詢只看 schedule/active、不看 command,壞掉時看起來一切正常。
> 已重建 job 並手動觸發補回匯率;兩個模板腳本的驗證查詢已補上 placeholder 檢查。
> **核對 cron 時務必連 command 一起看**,只看 active=true 不足以判斷排程是否真的有效。
>
> 2026-08-27:`send-streak-reminder-hourly` 每天數筆
> `Operation timed out after 5002 milliseconds` 是誤報——5002ms 是 http extension
> 的預設逾時,Edge Function 仍在雲端寄完信(已驗證 08-26 台北 21:50 那班 failed
> 但 reminder_last_sent 有寫入)。已在 command 最前面加
> `extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '30000')` 放寬為 30 秒
> (http_set_curlopt 是 session 層級,pg_cron 每次執行都是獨立 session,
> 必須寫進 command 內)。修的是**訊號可信度**,不是寄信本身。
> 逐封序列寄信(`send-streak-reminder/index.ts:204-240`)未改;
> 若日後收件者變多再度逾時,再考慮改平行寄送。
>
> 2026-08-31:`credit-card-reminder-daily` 是這次**補建**的——`send-credit-card-reminder`
> 自 2026-03 上線、2026-07-11 部署到 v4,但它的排程從來沒有被建立過
> (函式 README 那段 `cron.schedule` 未曾執行),`settings` 表
> `key='credit_card_reminder_last_sent'` 為 0 筆,佐證這支函式從未成功執行過,
> 使用者一次繳款提醒都沒收到。
> 前一則教訓是「只看 active=true 不足以判斷排程有效」,這則更前面一步:
> **job 根本不在表裡**。沒有任何監控會叫,因為沒東西在跑也就沒東西會失敗;
> 使用者也不會回報「我沒收到從來不知道存在的通知」。
> 新增 cron 型函式後,務必回頭 `SELECT * FROM cron.job` 確認排程真的存在——
> 光是 `functions deploy` 不會讓它跑起來。
> 建立時已一併設 `CURLOPT_TIMEOUT_MS = 30000`:這支逐張卡序列推播
> (`send-credit-card-reminder/index.ts:133-147`),與 send-streak-reminder 同樣結構,
> 預設 5 秒容易逾時,先設好免得一上線就天天留下誤報的 failed。

### 落後偵測方法

懷疑 prod 落後 repo 時:
- Edge functions:`supabase functions list` 的 updated_at 對照 `git log -- supabase/functions/<name>/` 最後改動日。
- SQL:本表最後一行對照 `git log -- database/ scripts/`;必要時在 SQL Editor 以 `\df` 或 pg_proc 查函式定義抽查。
