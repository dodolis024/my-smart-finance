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
| scripts/fix-split-sync-ownership.sql | 分帳同步補擁有權檢查:交易 UPDATE 比對 user_id、p_account_id 驗證擁有者,split_ledger_syncs 加 assert_sync_tx_owned trigger | 2026-08-31 |
| database/split-pin-migration.sql | 分帳群組置頂:新增 split_group_pins 表(user_id+group_id),4 條 RLS 均限 user_id = auth.uid();INSERT 另以 can_access_split_group 擋住對他人群組的探測,UPDATE 為前端 upsert 走 ON CONFLICT DO UPDATE 所必需(缺了跨裝置置頂會被擋) | 2026-09-02 |
| database/split-member-delete-guard-migration.sql | 移除成員的守門:split_expense_shares.member_id 與 split_settlements 的 from/to_member 三個外鍵由 ON DELETE CASCADE 改為 ON DELETE RESTRICT。原本刪成員會連分攤與還款紀錄一起消失,那些費用的分攤加總不再等於金額,代墊者永遠少收且畫面看不出來。前端已擋,這層是防漏。已以 pg_constraint 驗證三列 confdeltype = r | 2026-09-05 |
| scripts/fix-split-sync-decimal-regression.sql | sync_split_to_ledger 補回被 fix-split-sync-ownership.sql 洗掉的兩處:零小數幣別清單對齊 src/lib/constants.js 的 ZERO_DECIMAL_CURRENCIES、SPLIT_RATE_UNAVAILABLE 的 DETAIL 分隔符改回 ", "。擁有權檢查與匯率守門原樣保留,定義已與 database/split-sync-migration.sql 逐字一致 | 2026-09-09 |
| database/exchange-rate-history-migration.sql | 匯率歷史:新增 exchange_rate_history 表(主鍵 currency_code+date,故不另建索引),RLS 只給 authenticated SELECT、不開寫入 policy(寫入走 update-exchange-rates 的 service role);建表時以現值種一列今日;新增 get_exchange_rate_on(p_currency, p_date) RPC,查「<= 該日期的最新一筆」而非精準比對(週末與排程停擺會留洞),查無回 NULL 以區分「真的 1:1」。**只能從此日起累積,過去補不回來** | 2026-09-09 |
| database/split-expense-rate-migration.sql | 分帳凍結匯率:split_expenses 與 split_settlements 各加 exchange_rate(語意同 transactions,1 單位=多少 TWD)與 exchange_rate_estimated;BEFORE INSERT OR UPDATE trigger(set_split_row_rate)依費用日期以 get_exchange_rate_on 凍結,查無(早於 2026-09-09 或超過 400 天)退回現值並標記補記,幣別與日期未變則沿用原值(直接 PATCH 會被還原,要手動改需先 DISABLE TRIGGER)。用 trigger 而非改 RPC,是因為還款由前端與 CLI 直接 INSERT,舊版 CLI 寫入的也要涵蓋。既有外幣費用以執行當下現值補值並標補記(53 筆),台幣填 1;get_split_sync_status 與 sync_split_to_ledger 換算改用凍結值、前置匯率檢查略過已凍結者,定義與 database/split-sync-migration.sql 一致 | 2026-09-10 |
| database/split-sync-per-expense-migration.sql | 分帳同步改逐筆:split_ledger_syncs 加 expense_id(ON DELETE SET NULL,不用 CASCADE——費用被刪時要留線索才找得到該收掉哪筆交易),UNIQUE 由 (user_id, group_id) 改為 (user_id, expense_id) 的 partial index。sync_split_to_ledger 改逐筆建立/更新/收掉交易,日期=費用日期、分類=群組名稱、備註=費用備註(沒寫則留空)、金額=分攤額(費用原幣,用凍結匯率);不再換算到群組幣別,故不再需要零小數清單。get_split_sync_status 的 needs_update 改比對費用集合與帳本內容(金額相等但日期/名稱/備註改過也會偵測到)。內建遷移把既有彙總交易拆成逐筆並刪除原交易(支付方式與帳戶沿用),第 5 節回填備註。可重複執行 | 2026-09-16 |
| database/split-shares-balance-guard-migration.sql | 分攤總和守門:split_expenses 與 split_expense_shares 各掛一個 DEFERRABLE INITIALLY DEFERRED 的 constraint trigger(assert_split_shares_balanced),commit 時檢查 SUM(share) = amount(精確相等,不留容差),不平就拋 SPLIT_SHARES_SUM_MISMATCH。放表上而不是 RPC 裡,是因為 RLS 讓群組成員能直接 INSERT/DELETE shares 與 UPDATE expenses.amount,RPC 內的檢查擋不到;要延遲是因為 add/update RPC 的寫入順序本身會經過不平的中間狀態。另加 share >= 0(NOT VALID + VALIDATE)。既有不平的舊費用不動,驗證查詢第 7、8 列會列出。prod 執行時第 7 列為 1(35b91a6f…,31300 vs 31299.99,台幣舊制 2 位小數分攤),在 App 重存該筆即可補平 | 2026-09-17 |
| database/transaction-amount-guard-migration.sql | transactions.amount 加 CHECK (amount >= 0)(NOT VALID + VALIDATE)。是 >= 0 不是 > 0:sync_split_to_ledger 在成員分攤全被刪掉後重新同步會寫 0,這是正常操作走得到的路;> 0 的驗證仍由前端與 CLI 做。只防自己的帳本被寫進負數,無跨使用者影響。VALIDATE 通過,prod 無負數金額 | 2026-09-17 |
| (SQL Editor 直接執行)`DROP FUNCTION join_split_group_as_new_member(uuid, text)` | 移除只存在於 prod 的孤兒多載:收 p_group_id 的舊版加入函式,無邀請碼、封存、登入檢查,SECURITY DEFINER 且 search_path 未鎖,anon 也可執行。任何人拿到群組 id 就能不經邀請碼加入;未登入呼叫會插入 user_id NULL 的空位成員。成因與教訓見下方 2026-09-17 注記。已查 split_members 全部 14 筆,無人利用 | 2026-09-17 |
| scripts/fix-time-defaults-and-settlement-date.sql | transactions.time 與 split_expenses/split_settlements.date 的預設改為台灣時鐘(原本用資料庫的 UTC 時鐘,慢 8 小時);sync_split_to_ledger DROP 舊簽章 (UUID, TEXT, UUID) 後重建,新增 p_time TIME DEFAULT NULL(客戶端帶本地時間,未帶退回台灣時間);一次性修正既有資料:time 仍等於 created_at UTC 時刻的交易改成台灣時刻、還款日期停在 UTC 日期的改成台灣日期。驗證 10/10 通過,第 9、10 列(待修正筆數)皆為 0 | 2026-09-17 |
| scripts/fix-split-create-group-atomic.sql | 新增 create_split_group RPC(SECURITY INVOKER,RLS 照常套用):群組與成員在同一交易內建立,成員寫入失敗不再留下「有群主、沒成員」的群組;空白名稱拋 SPLIT_NAME_REQUIRED。前端 useSplitGroups.createGroup 自 26941b2 起改呼叫此 RPC,release 前必須先跑。驗證 6/6 通過,既有群主不在成員名單的群組數為 0 | 2026-09-17 |

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
>
> 2026-09-09:`fix-split-sync-decimal-regression.sql` 修的不是新 bug,是
> **2026-08-31 那批自己造成的回歸**。`sync_split_to_ledger` 前後被 5 份檔案
> `CREATE OR REPLACE` 過,`fix-split-sync-ownership.sql` 照抄的底稿是同一天三支腳本
> 的中間那支(`fix-split-error-codes.sql`),漏掉更後面才執行的
> `fix-split-join-auth-and-decimal-list.sql`,於是把零小數幣別清單與 DETAIL 分隔符
> 一起洗回舊版。腳本跑完不會噴錯,兩個表格也都記得好好的——**執行紀錄只證明腳本跑過,
> 證明不了它帶的是最新定義**。
>
> 因此:改任何被重複定義過的函式時,底稿一律取**本表最後一次動到它的那份**,
> 改完把函式本體與 `database/` 的正規定義檔逐字 diff 一次再送。
> 本次已用同樣方式核對其餘 8 支被多份腳本重複定義的函式
> (`get_dashboard_data`、`get_split_member_avatars_batch`、`add_split_expense`、
> `update_split_expense`、`protect_split_group_ownership`、
> `join_split_group_as_new_member`、`link_self_to_split_member`、
> `get_group_by_invite_code`),後版都是前版的嚴格超集,沒有同類問題。

> 2026-09-17:`scripts/verify-prod-security.sql` 首次在 prod 執行,抓到一支 **repo 裡從未存在過**
> 的函式:`join_split_group_as_new_member(p_group_id uuid, p_name text)`。它是 repo 建立前
> 直接在 Dashboard 建的舊版,後來每一份腳本寫的都是 `(p_invite_code TEXT, p_name TEXT)`——
> **`CREATE OR REPLACE FUNCTION` 只替換簽章完全相同的函式,簽章不同就是在旁邊蓋一支新的**,
> 舊的一次都沒被碰到。連 `fix-security-hardening.sql` 的
> `ALTER FUNCTION join_split_group_as_new_member(TEXT, TEXT) SET search_path` 也只鎖到新版。
> 於是 2026-08-31 `fix-split-member-access.sql` 要收掉的「加入群組一律需通過邀請碼」,
> 從那天到 2026-09-17 一直有一條沒關的側門。
>
> 因此:改任何函式的**參數**時,腳本必須先 `DROP FUNCTION IF EXISTS <舊簽章>`,
> 不能只 `CREATE OR REPLACE` 新簽章。每次跑完 migration 後執行一次
> `scripts/verify-prod-security.sql`,第 6 區(多版本函式)必須是空的。
> 本次審查同時確認:16 張表 RLS 全開、push_subscriptions 四條 policy 齊全、
> 4 支收 p_user_id 的函式皆已 REVOKE、其餘 SECURITY DEFINER 函式皆以 auth.uid() 取身分。

### 正式定義檔重跑紀錄

| 檔案 | 內容 | 執行日期 |
|---|---|---|
| database/streak-freeze-migration.sql + supabase-functions.sql | 凍結卡表 + reconcile RPC(v1.20) | 約 2026-07-09 |
| database/subscriptions-migration.sql | FK 行為與 prod 核對一致(`ON DELETE SET NULL`),檔頭聲明已更新 | 2026-07-11(核對,非重跑) |
| database/supabase-functions.sql | freeze 最長連續改合併分段 | 2026-07-11 |
| database/supabase-functions.sql | get_dashboard_data 回傳 time 欄位,排序改 date+time+created_at | 2026-08-25 |
| database/overseas-fee-migration.sql + supabase-functions.sql | accounts／transactions 加海外手續費欄位;get_dashboard_data 回傳手續費欄位 | 2026-09-13 |

> 2026-08-25 這次重跑有副作用:當時檔內的 exchange_rates 種子是
> `ON CONFLICT DO UPDATE`,把 TWD/USD/JPY/EUR/GBP 五個幣別的真實匯率覆寫回種子值
> (USD 30/EUR 32/GBP 38),並蓋上新的 updated_at,看起來像剛更新過。
> 已於 2026-08-26 將兩個定義檔的種子改為 `DO NOTHING`,重跑不會再踩到既有匯率。

### Edge Functions 部署紀錄

| 函式 | 最後部署 | version | 備註 |
|---|---|---|---|
| update-exchange-rates | 2026-09-14 | v21 | 拿掉 exchange_rate_history 的 400 天清理,歷史改為永久保留(回傳也不再帶 retention_days)。v20(2026-09-09)起每日更新後多寫一筆 exchange_rate_history(存 validatedRates 即實際採用值,非 API 原始值);歷史寫入失敗只記 log 不中斷主線。搭配 database/exchange-rate-history-migration.sql。x-cron-secret 驗證原樣保留,verify_jwt 維持 false(以 `--no-verify-jwt` 部署) |
| send-streak-reminder | 2026-08-27 | v26 | 加 `x-cron-secret` 驗證(取代 2026-07-11 v24 的通知多語化版,該邏輯保留) |
| send-split-notification | 2026-07-11 | v9 | 同上 |
| send-credit-card-reminder | 2026-08-31 | v6 | 加 `x-cron-secret` 驗證;繳款提醒改為未設定過即視同未啟用 |
| send-credit-usage-alert | 2026-08-31 | v6 | 額度警告改為未設定過即視同未啟用(呼叫端是前端,不加 cron 密鑰) |
| process-subscriptions | 2026-09-17 | v10 | 自動入帳補上 `time`(台灣時鐘,原本落在資料庫的 UTC 時鐘),未填分類的後備分類改為跟隨使用者語言(`_shared/categoryLabels.ts`);`x-cron-secret` 驗證與 verify_jwt=true 原樣保留 |

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

### 驗收紀錄

改完之後要回頭確認「真的生效」,而不是只確認「腳本跑完沒噴錯」。
`scripts/check-security-hardening-status.sql` 是 2026-08-31 那批的驗收查詢
(唯讀、可重複執行,整段貼進 SQL Editor 即可)。

| 日期 | 範圍 | 結果 |
|---|---|---|
| 2026-09-02 | 2026-08-31 批次的 5 支 SQL 腳本 + 6 支 Edge Function | 22 項全數通過 |
| 2026-09-09 | scripts/fix-split-sync-decimal-regression.sql | 11 項全數通過 |
| 2026-09-10 | database/split-expense-rate-migration.sql | 16 項全數通過(腳本內建驗證);另以 anon key 呼叫 resolve_split_rate 確認函式可執行、歷史表路徑可用 |
| 2026-09-16 | database/split-sync-per-expense-migration.sql | 8 項全數通過(腳本內建驗證);另以測試帳號在瀏覽器確認群組已成為分類圓餅圖的一塊、點進去是可編輯的逐筆交易,且英文介面不再出現寫死的中文 |

> 2026-09-02 的重點不在前 19 項設定檢查,而在後 3 項:
> `credit-card-reminder-daily` 首次成功執行(2026-09-02 01:00 UTC = 台灣 09:00),
> 信用卡繳款提醒自此才真正開始運作;四個排程近 3 天 0 失敗,
> 反證 cron 密鑰兩端(secrets 的 `CRON_SECRET` 與 job command 內)確實對得上
> ——這批最大的風險是 fail closed,密鑰不一致會靜默擋掉全部請求。
> 另 `split_ledger_syncs` 指向他人交易的筆數為 0,表示修掉的擁有權漏洞未曾被利用。
>
> 驗收查詢刻意不輸出邀請碼與密鑰本身:這種結果常被截圖或貼上,
> 只回報「有沒有」與「對不對」就夠了。

### 落後偵測方法

懷疑 prod 落後 repo 時:
- Edge functions:`supabase functions list` 的 updated_at 對照 `git log -- supabase/functions/<name>/` 最後改動日。
- SQL:本表最後一行對照 `git log -- database/ scripts/`;必要時在 SQL Editor 以 `\df` 或 pg_proc 查函式定義抽查。
- 分帳安全性與 cron 那批的現況:直接跑 `scripts/check-security-hardening-status.sql`,比逐項抽查快。
