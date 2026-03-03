# Cursor Skills 可攜式套件

這兩個 skills 可在任何電腦或帳號的 Cursor 中直接使用，與專案無關、與 Cursor 帳號無關。

---

## 前置需求

- 已安裝 [Cursor](https://cursor.com/) 編輯器
- 至少開啟過 Cursor 一次（會建立 `~/.cursor` 或 `%USERPROFILE%\.cursor`）

---

## 包含的 Skills

| Skill | 用途 | 觸發時機 |
|-------|------|----------|
| **commit-and-push-dev** | 提交程式碼到 dev 分支，並自動更新 CHANGELOG.md | 說「commit 到 dev」「push dev」「更新 changelog」等 |
| **release-to-main** | 合併 dev 到 main、發布版本，並整理 CHANGELOG.md | 說「release」「merge dev 到 main」「發布」「給版本號」等 |

---

## Skills 目錄位置

| 系統 | 路徑 |
|------|------|
| macOS / Linux | `~/.cursor/skills/`（即 `$HOME/.cursor/skills/`） |
| Windows | `%USERPROFILE%\.cursor\skills\`（如 `C:\Users\你的帳號\.cursor\skills\`） |

若目錄不存在，安裝腳本會自動建立；手動安裝時請先執行 `mkdir -p ~/.cursor/skills`（或 Windows 對應指令）。

---

## 安裝方式

### 方法一：一鍵安裝腳本

**macOS / Linux：**
```bash
cd cursor-skills-backup
chmod +x install.sh   # 若尚未可執行
./install.sh
```

**Windows (PowerShell，以系統管理員或一般權限執行)：**
```powershell
cd cursor-skills-backup
.\install.ps1
```

### 方法二：手動複製

1. 建立目錄（若不存在）：
   - macOS/Linux: `mkdir -p ~/.cursor/skills`
   - Windows PowerShell: `New-Item -ItemType Directory -Force $env:USERPROFILE\.cursor\skills`

2. 複製 skills：

**macOS / Linux：**
```bash
cp -r commit-and-push-dev release-to-main ~/.cursor/skills/
```

**Windows PowerShell：**
```powershell
$skills = "$env:USERPROFILE\.cursor\skills"
Copy-Item -Recurse commit-and-push-dev $skills
Copy-Item -Recurse release-to-main $skills
```

**Windows 命令提示字元 (cmd)：**
```cmd
xcopy /E /I commit-and-push-dev %USERPROFILE%\.cursor\skills\commit-and-push-dev
xcopy /E /I release-to-main %USERPROFILE%\.cursor\skills\release-to-main
```

3. 若已有同名 skill，會直接覆蓋。若需保留舊版，請先備份 `~/.cursor/skills/` 或 `%USERPROFILE%\.cursor\skills\`。

---

## 安裝後步驟

1. **重啟 Cursor**，或至少開啟一個**新的 Agent 對話**
2. Skills 是全域的，在任一專案中都可使用

---

## 驗證安裝

在 Cursor 中開啟 **Agent**（不是 Chat），輸入：

- 「幫我 commit 到 dev」「我要 push dev」→ 應觸發 commit-and-push-dev，AI 會分析變更、產生 commit message 與 changelog 條目
- 「幫我 release 到 main」「要發布了」→ 應觸發 release-to-main，AI 會建議版本號、更新 CHANGELOG、merge 並 push

若 AI 能依 skill 流程一步步操作（而非隨意回應），即表示安裝成功。

---

## 疑難排解

| 狀況 | 可能原因 | 解法 |
|------|----------|------|
| 說「commit 到 dev」但 AI 沒有照流程做 | Skill 未載入 | 重啟 Cursor，或開新對話；確認檔案在 `~/.cursor/skills/commit-and-push-dev/SKILL.md` |
| 找不到 `~/.cursor` 目錄 | 從未開啟過 Cursor | 先開啟 Cursor 一次，關閉後再安裝 |
| Windows 執行 install.ps1 被擋 | 執行原則限制 | 以管理員開啟 PowerShell，執行 `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` |

---

## 卸載

直接刪除對應資料夾即可：

- macOS/Linux: `rm -rf ~/.cursor/skills/commit-and-push-dev ~/.cursor/skills/release-to-main`
- Windows: 到 `%USERPROFILE%\.cursor\skills\` 刪除 `commit-and-push-dev` 和 `release-to-main` 資料夾

---

## 攜帶與備份

- **隨身碟 / 雲端**：複製整個 `cursor-skills-backup` 資料夾
- **Git**：可放進 private repo，新電腦 `git clone` 後執行 `install.sh` 或 `install.ps1`
- **iCloud / Dropbox**：同步此資料夾，在新電腦執行安裝腳本

---

*最後更新：2026-03*
