# 匯率系統改進說明

## 📊 改進項目總覽

根據您的需求，我已經實作了以下改進：

### ✅ 1. 中央匯率表架構
- **所有用戶共用同一個 `exchange_rates` 表**
- 前端透過 `get_exchange_rate()` 函數讀取匯率
- **不會重複呼叫外部 API**，效率最佳化 ✅

### ✅ 2. 指數退避（Exponential Backoff）
- 最多重試 3 次
- 重試間隔：5 秒 → 15 秒 → 45 秒（拉長間隔，避免過度請求）
- 每次失敗後等待時間呈指數增長（×3）
- 15 秒超時保護
- 總計最長等待時間：~65 秒

### ✅ 3. Last Known Good（保留上次成功的匯率）
- 每次更新前先讀取資料庫中現有的匯率
- 如果 API 呼叫失敗，**保留舊匯率不更新**
- 三層 fallback 機制：
  1. 嘗試從 API 取得最新匯率
  2. 如果失敗，使用資料庫中的 Last Known Good
  3. 如果資料庫也沒有，使用預設值（30.0, 0.2, 32.0, 38.0）

### ✅ 4. 異常檢測機制（±20% 變動範圍保護）⭐ 新增
- 比對新匯率與 Last Known Good 的變動百分比
- **如果變動超過 ±20%，自動拒絕更新**
- 保留舊匯率並記錄異常到 logs 和回傳結果
- 防止 API 錯誤資料或市場異常波動造成錯誤計算
- 範例：
  - USD 從 31.6 變為 35.0（+10.8%）✅ 接受
  - USD 從 31.6 變為 40.0（+26.6%）❌ 拒絕，保留 31.6
  - 異常會記錄在回傳的 `anomalies` 欄位中

### ✅ 5. 更新時間優化
- **API 更新時間**：UTC 00:00（台灣時間 08:00）
- **系統執行時間**：UTC 02:00（台灣時間 10:00）
- **緩衝時間**：2 小時，避免抓到舊資料 ✅

### ✅ 6. 錯誤處理
- 完整的 try-catch 錯誤捕捉
- 詳細的日誌記錄（console.log）
- 友善的錯誤訊息回傳
- 異常檢測結果會記錄在回傳的 `anomalies` 欄位中

---

## 🔄 完整更新流程圖

```
開始更新匯率
    ↓
讀取資料庫現有匯率（Last Known Good）
    ↓
嘗試呼叫 Exchange Rate API（15 秒超時）
    ├─ 成功 → 繼續下一步
    ├─ 失敗（第 1 次）→ 等待 5 秒後重試
    ├─ 失敗（第 2 次）→ 等待 15 秒後重試
    ├─ 失敗（第 3 次）→ 等待 45 秒後重試
    └─ 全部失敗 → 使用 Last Known Good（不更新資料庫）⚠️
    
API 成功取得新匯率
    ↓
逐一檢查每個幣別的變動範圍
    ├─ 變動 ≤ 20% → 使用新匯率 ✅
    ├─ 變動 > 20% → 拒絕新匯率，保留 Last Known Good ⚠️
    └─ 沒有舊匯率（首次）→ 直接使用新匯率 ✅
    
更新資料庫
    ↓
回傳結果（包含異常檢測記錄）
```

### 🛡️ 防呆機制範例

假設 USD 目前匯率是 31.6 TWD：

| 新匯率 | 變動幅度 | 結果 | 實際採用 | 說明 |
|--------|---------|------|---------|------|
| 32.5 | +2.8% | ✅ 接受 | 32.5 | 正常波動 |
| 35.0 | +10.8% | ✅ 接受 | 35.0 | 可接受範圍內 |
| 37.9 | +19.9% | ✅ 接受 | 37.9 | 臨界值內 |
| 38.0 | +20.3% | ❌ 拒絕 | 31.6 | 超過 20% 上限 |
| 25.0 | -20.9% | ❌ 拒絕 | 31.6 | 超過 20% 下限 |
| 50.0 | +58.2% | ❌ 拒絕 | 31.6 | 明顯異常，可能是 API 錯誤 |

**被拒絕的匯率會：**
- ✅ 保留 Last Known Good（31.6）
- ✅ 記錄到 `anomalies` 欄位
- ✅ 在 Edge Function logs 中顯示警告
- ✅ 不影響其他幣別的正常更新


---

## 📅 執行時間表

| 時間（UTC） | 時間（台灣） | 事件 |
|------------|------------|------|
| 00:00 | 08:00 | Exchange Rate API 更新匯率 |
| 02:00 | 10:00 | ⭐ 系統自動抓取並更新（2 小時緩衝） |

---

## 🚀 需要執行的動作

### 立即執行：

#### 1. 重新部署 Edge Function

在終端機執行：

```bash
supabase functions deploy update-exchange-rates --no-verify-jwt
```

這會部署包含以下改進的新版本：
- ✅ 指數退避重試機制
- ✅ Last Known Good fallback
- ✅ 完整的錯誤處理

#### 2. 更新 cron 排程時間

1. 開啟 [Supabase SQL Editor](https://supabase.com/dashboard/project/rlahfuzsxfbocmkecqvg/sql/new)
2. 複製 `update-cron-schedule.sql` 的內容
3. 貼上並執行
4. 驗證結果顯示 `schedule = '0 2 * * *'`

#### 3. 測試新版本

```bash
curl -X POST https://rlahfuzsxfbocmkecqvg.supabase.co/functions/v1/update-exchange-rates
```

---

## 📊 監控與驗證

### 檢查匯率更新狀態

```sql
SELECT currency_code, rate, updated_at 
FROM exchange_rates 
ORDER BY updated_at DESC;
```

### 檢查 cron 執行歷史

```sql
SELECT jobid, runid, status, return_message, start_time, end_time
FROM cron.job_run_details 
WHERE jobname = 'update-exchange-rates-daily'
ORDER BY start_time DESC 
LIMIT 10;
```

### 檢查 Edge Function Logs

前往 [Supabase Dashboard](https://supabase.com/dashboard/project/rlahfuzsxfbocmkecqvg/functions/update-exchange-rates/details) > Edge Functions > update-exchange-rates > Logs

---

## 🎯 技術細節

### 為什麼使用 Last Known Good？

如果 Exchange Rate API 暫時故障或達到請求上限：
- ❌ **不好的做法**：使用預設值（30.0），可能與真實匯率差距很大
- ✅ **好的做法**：保留上次成功的匯率，雖然可能稍舊但更準確

### 為什麼使用指數退避？

- 網路暫時性問題（如 DNS 解析失敗）通常在幾秒內就會恢復
- 立即重試可能遇到相同問題
- 指數退避給系統時間恢復，同時避免過度請求

### 為什麼選擇 UTC 02:00？

- API 在 UTC 00:00 更新
- 2 小時緩衝足夠讓 API 完成全球更新
- 台灣時間 10:00 是合理的更新時間（用戶通常不會在這個時間新增交易）

---

---

## 📊 最終技術規格總表

| 項目 | 設定 | 說明 |
|------|------|------|
| **API 更新時間** | UTC 00:00 | Exchange Rate API 更新時間（台灣時間 08:00） |
| **系統執行時間** | UTC 02:00 ⭐ | cron job 執行時間（台灣時間 10:00） |
| **緩衝時間** | 2 小時 ✅ | 避免抓到 API 尚未更新的舊資料 |
| **請求超時** | 15 秒 | 單次 API 請求的最長等待時間 |
| **重試次數** | 最多 3 次 | 失敗後的重試次數 |
| **重試間隔** | 5s → 15s → 45s ✅ | 指數退避（×3 倍數） |
| **總等待時間** | 最長 ~80 秒 | 包含所有重試和超時的總時間 |
| **異常檢測閾值** | ±20% ✅ | 超過此變動範圍自動拒絕更新 |
| **Fallback 機制** | Last Known Good ✅ | API 失敗或異常時保留舊匯率 |
| **資料架構** | 中央匯率表 ✅ | 所有用戶共用，不重複呼叫 API |

---

**改進完成！** 🎉

現在您的系統具備企業級的穩定性、可靠性和安全性！
