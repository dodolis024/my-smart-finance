# finance — CLI 與 MCP Server

讓終端機和 AI agent 能操作 My Smart Finance 的記帳資料。網頁前端只是 Supabase 的其中一個客戶端，這套工具是另一個。

## ⚠️ 同步義務（最重要的一件事）

`core/transactions.js` 是 `src/hooks/useTransactions.js` 寫入邏輯的**第二份實作**。前端那份是 React hook（綁著 state、離線佇列、瀏覽器 API），沒辦法直接被 Node 匯入，所以只能各寫一份。

**改動交易寫入邏輯時，兩邊都要改。** 具體來說，以下任何一項變動都必須同步：

| 變動 | 要改的地方 |
|---|---|
| `transactions` 表加／改欄位 | `core/transactions.js` 的 `TX_FIELDS` 與 `addTransaction` |
| 匯率取得或換算方式 | `resolveExchangeRate` / `computeTwdAmount` |
| 簽到規則 | `maybeCheckIn` |
| 分類或帳戶的解析規則 | `core/categories.js` / `core/accounts.js` |

`tests/unit/tools-transactions.test.js` 守著這些行為，改壞了測試會紅。

同步只是第一步：`tools/` 的改動要**發版**才會到已安裝的使用者手上，見下方「發版」。

## 安裝（使用者）

```bash
npm install -g my-smart-finance-cli     # 安裝
npm update -g my-smart-finance-cli      # 之後更新
```

不需要 clone 這個 repo，連線設定內建在套件裡。所有查詢指令都支援 `--json`，供 AI 助理或腳本使用。

## 安裝（在這個 repo 裡開發）

```bash
cd tools && npm install
npm link          # 讓 finance 指令指向工作目錄的版本
```

連線設定的解析順序：`SMF_SUPABASE_URL` / `SMF_SUPABASE_ANON_KEY` 環境變數 → 專案根目錄 `.env.local` 的 `VITE_` 變數 → `core/config.js` 內建的預設值。內建預設是給 npm 使用者用的：anon（publishable）key 本來就是公開憑證，前端 bundle 裡就有一份，安全性靠 RLS 而非保密。

## 發版

改動 `tools/` 底下的程式碼後，已安裝的使用者不會自動拿到，必須 bump 版號重新發布。
版號與主 App 版號各自獨立，不需對齊。

```bash
npm version patch          # 或 minor / major
npm publish                # ⚠️ 必須在真正的終端機視窗執行，見下方
```

### `npm publish` 不能在非 TTY 環境跑

Claude Code 的 `!` 指令、Bash 工具、CI 都不行。這個帳號的 npm 2FA 是 passkey（Touch
ID），而 npm 的 `lib/utils/auth.js` 在處理 2FA 挑戰前會先檢查 `process.stdin.isTTY`，
不是 TTY 就直接拋 `EOTP`，走不到開瀏覽器做 WebAuthn 的分支。

錯誤訊息會說 `requires a one-time password from your authenticator` 並要你加 `--otp=`，
那是誤導——沒有 TOTP 可填，npm 也不再提供新增 authenticator app 的選項。

正確做法：開 Terminal.app 或 iTerm2，`cd tools && npm publish`。npm 會印出
`Authenticate your account at:` 並開瀏覽器，Touch ID 確認即可。

### bin 路徑不能帶 `./` 前綴

npm 11 判定 `./cli/index.js` 無效，發布時會**整個移除 bin 欄位**，使用者裝了卻沒有
`finance` 指令。`npm pack` 不會顯現，只有 `npm publish` 會警告。

### 打包範圍

`files` 只包含 `cli/`、`core/`、`mcp/` 與 README；npm 另外自動收錄同目錄的 `LICENSE`。
repo 其他內容不會進套件。

### 發布後驗證

```bash
npm install -g my-smart-finance-cli && finance whoami
```

## 一次性設定：Supabase 回呼網址

`finance login` 走的是跟網頁一樣的 OAuth 流程，需要讓 Supabase 允許導回本機。

在 **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs** 加入：

```
http://localhost:9876/callback
```

所有使用者共用這一筆設定（大家的機器上都是 localhost），只要加一次。埠號被占用時可用 `SMF_OAUTH_PORT` 換一個，但記得同步加對應的網址；`finance callback-url` 會印出目前該註冊哪一個。

## 使用

```bash
finance login                                              # 開瀏覽器用 Google 登入
finance add 星巴克 150 --category 飲食 --account 現金
finance add 拉麵 1200 --category 飲食 --account 現金 --currency JPY
finance list --month 8
finance summary
finance help                                               # 完整指令說明
```

### 登入方式

| 情境 | 指令 |
|---|---|
| Google 帳號（以及所有帳號） | `finance login` |
| 用 email 註冊、想在終端機內輸入密碼 | `finance login --password` |
| SSH 連線、開不了瀏覽器 | `SMF_NO_BROWSER=1 finance login`，然後把印出的網址貼到有瀏覽器的機器完成授權 |
| CI 或無互動環境 | 設定 `SMF_REFRESH_TOKEN` 環境變數 |

**Google 帳號在 Supabase 裡沒有密碼**，`--password` 對它們永遠無效，這也是預設走瀏覽器登入的原因。

登入拿到的是一組獨立的 session，不會跟使用者瀏覽器的登入狀態互相干擾——Supabase 的 refresh token 會輪替，兩邊共用同一組會把對方踢登出。

## 讓 AI 助理代勞

不需要額外整合。能執行終端機指令的助理（Claude Code、Cursor 等）裝好 CLI 後就能直接用——
跟它說「幫我記一筆星巴克 150，現金付的」，它會自己組出指令。

請它讀資料時，加上 `--json` 會比表格可靠得多：

```bash
finance list --month 8 --json
finance summary --json
```

## MCP（暫緩）

`mcp/` 底下的 stdio MCP server 已經寫好也測過，但**目前不對外提供**，說明頁與安裝指引都沒有它。

暫緩的原因：stdio 模式要求使用者的電腦有 Node.js，而這個帳本是雲端服務，
比較合適的形式其實是 remote MCP server（架在 Supabase Edge Function，使用者貼一個網址加金鑰即可，
零安裝）。等要做的時候再決定走哪一種，屆時核心邏輯（`core/`）可以直接重用。

程式碼保留、`finance mcp` 指令仍可用，本機開發要掛上去測的話：

```bash
claude mcp add my-smart-finance-dev -- node <絕對路徑>/tools/mcp/server.js
```

## 安全

- **只用 anon key，永遠不用 `service_role`**。所有資料表的 RLS policy 都是 `auth.uid() = user_id`，帶著使用者自己的 session 就足夠；service_role 會繞過 RLS，一旦外流等於全站資料裸奔。
- session 存在 `~/.config/my-smart-finance/session.json`，權限 `0600`。
- MCP server 只走 stdio，不開網路埠。
- OAuth 登入用 PKCE，回呼 server 只綁 `127.0.0.1`、只服務一次、三分鐘後自動關閉。
- 登入密碼不接受命令列參數（會留在 shell history），只從互動輸入或 `SMF_PASSWORD` 環境變數讀取。

## 給 agent 的護欄

agent 跟人不一樣：它猜錯了會很有自信地寫進去。所以這裡刻意比網頁更嚴格：

- **分類與帳戶名稱必須完全相符**，對不上就報錯並回傳可用清單（網頁在帳戶對不上時是存 `null`）。
- **不會自動新增分類或帳戶**，那些只能在網頁設定裡建立，避免 agent 污染下拉選單。
- **修改與刪除必須指定 id**，不支援條件式批次操作，agent 得先查詢才能動手。
- **刪除會回傳被刪內容**，誤刪時至少留得下重建的依據。
- 查不到匯率就擋下整筆，絕不退回 1:1。

## 功能範圍

讀取類做滿，寫入類只做交易的新增／修改／刪除。

訂閱扣款、帳戶與分類的維護、分帳系統**刻意不做**——它們的邏輯改動頻繁或牽涉多人協作，多一份實作就多一個會默默算錯的地方，而這些設定一年動不了幾次，在網頁上做完全不痛。
