# 配置說明

## 🔑 需要設定的環境變數

在使用自動更新匯率功能之前，您需要替換以下佔位符：

### 1. Supabase 連線資訊

在以下檔案中，請將佔位符替換為您的實際值：

#### 📄 `setup-auto-exchange-rates.sql`
```sql
-- 第 43 行附近
url := '<YOUR_SUPABASE_URL>/functions/v1/update-exchange-rates',

-- 第 46 行附近
'Authorization', 'Bearer <YOUR_SUPABASE_ANON_KEY>'
```

#### 📄 `update-cron-schedule.sql`
```sql
-- 第 20 行附近
url := '<YOUR_SUPABASE_URL>/functions/v1/update-exchange-rates',

-- 第 23 行附近
'Authorization', 'Bearer <YOUR_SUPABASE_ANON_KEY>'
```

#### 📄 `test-exchange-rates.sh`
```bash
# 第 10 行附近
SUPABASE_URL="<YOUR_SUPABASE_URL>"
```

---

## 📝 如何取得這些資訊

### Supabase URL 和 Anon Key

1. 登入 [Supabase Dashboard](https://supabase.com/dashboard)
2. 選擇您的專案
3. 前往 **Settings** > **API**
4. 複製以下資訊：
   - **Project URL**: `https://your-project-id.supabase.co`
   - **anon public key**: `eyJhbG...` (以 `eyJ` 開頭的長字串)

---

## ⚠️ 安全提醒

### 哪些檔案可以安全地提交到 Git？

**✅ 可以提交：**
- `setup-auto-exchange-rates.sql` - 使用佔位符，安全
- `update-cron-schedule.sql` - 使用佔位符，安全
- `test-exchange-rates.sh` - 使用佔位符，安全
- 所有 `.md` 文件

**🔒 不應提交（已在 .gitignore）：**
- `.env.local` - 包含實際的 API keys
- `supabase/.temp/` - Supabase CLI 暫存資料

**⚠️ 已存在但需注意：**
- `script.js` - 包含 Supabase URL 和 Anon Key（前端需要）
- `auth.html` - 包含 Supabase URL 和 Anon Key（前端需要）

> **注意：** `script.js` 和 `auth.html` 中的 Anon Key 是公開的，這是正常的。
> Supabase 的 Row Level Security (RLS) 會保護您的資料安全。
> 真正需要保密的是 **Service Role Key**（不要放在前端！）

---

## 🚀 設定步驟

1. **複製 `.env.local.example` 為 `.env.local`**（如果有的話）
2. **在 SQL 檔案中替換佔位符**
3. **在測試腳本中替換 URL**
4. **執行部署**

詳細步驟請參考 `QUICK_START.md`

---

## 📞 需要協助？

如有問題，請參考：
- `EXCHANGE_RATE_SETUP_GUIDE.md` - 完整設定指南
- `QUICK_START.md` - 快速開始指南
- [Supabase 文件](https://supabase.com/docs)
