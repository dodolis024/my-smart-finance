# 匯率系統改進總結

## 🎯 您要求的改進項目

### ✅ 1. 拉長指數退避間隔
**原本：** 2 秒 → 4 秒 → 8 秒  
**改進後：** **5 秒 → 15 秒 → 45 秒** ✅

**好處：**
- 給 API 伺服器更多恢復時間
- 避免在短時間內過度請求
- 更符合 API 服務商的 rate limiting 政策

---

### ✅ 2. 新增異常檢測機制（±20% 變動範圍保護）

**功能：**
當新匯率與 Last Known Good 的變動超過 ±20% 時：
- ❌ **自動拒絕新數據**
- ✅ **保留 Last Known Good**
- 📝 **記錄異常到 logs 和回傳結果**

**範例場景：**

```
假設 USD 當前匯率：31.6 TWD

情況 1：正常波動
API 回傳：32.5 TWD
變動：+2.8%
結果：✅ 接受並更新

情況 2：臨界值
API 回傳：37.9 TWD
變動：+19.9%
結果：✅ 接受並更新

情況 3：超過閾值（可能是 API 錯誤）
API 回傳：40.0 TWD
變動：+26.6%
結果：❌ 拒絕，保留 31.6 TWD
動作：記錄異常到 logs

情況 4：明顯錯誤
API 回傳：100.0 TWD
變動：+216.5%
結果：❌ 拒絕，保留 31.6 TWD
動作：記錄嚴重異常到 logs
```

**錯誤記錄格式：**

```json
{
  "success": true,
  "message": "Exchange rates updated with 1 anomaly(ies) detected",
  "timestamp": "2026-02-03T14:00:00.000Z",
  "updates": [...],
  "anomalies": [
    {
      "currency": "USD",
      "oldRate": 31.6,
      "newRate": 40.0,
      "changePercent": "26.58",
      "action": "rejected"
    }
  ],
  "warning": "Some rates changed more than 20% and were rejected. Last known good rates were kept."
}
```

---

### ✅ 3. 確認效率優化

**您的問題：** 每個用戶都會直接採用中央匯率表嗎？

**答案：是的！** ✅

**架構說明：**

```
用戶 A 新增交易
    ↓
前端呼叫：supabase.rpc('get_exchange_rate', { p_currency: 'USD' })
    ↓
資料庫函數：SELECT rate FROM exchange_rates WHERE currency_code = 'USD'
    ↓
回傳：31.6 ✅

用戶 B 新增交易
    ↓
前端呼叫：supabase.rpc('get_exchange_rate', { p_currency: 'EUR' })
    ↓
資料庫函數：SELECT rate FROM exchange_rates WHERE currency_code = 'EUR'
    ↓
回傳：37.4 ✅

用戶 C、D、E... 全部都是讀取同一個中央表
    ↓
不會重複呼叫外部 API ✅
```

**效能優勢：**
- 中央匯率表每天只更新一次（台灣時間 10:00）
- 所有用戶共用同一份匯率資料
- 無論有多少用戶，都不會增加 API 請求次數
- 免費 API 額度（每月 1,500 次）綽綽有餘

---

## 📊 完整技術規格

| 項目 | 規格 | 備註 |
|------|------|------|
| **指數退避間隔** | 5s → 15s → 45s ✅ | 改進後 |
| **異常檢測閾值** | ±20% ✅ | 新增 |
| **Last Known Good** | ✅ 已實作 | 改進 |
| **執行時間** | UTC 02:00（台灣時間 10:00）✅ | 改進後 |
| **API 緩衝時間** | 2 小時 ✅ | 改進後 |
| **中央匯率表** | ✅ 已確認 | 所有用戶共用 |
| **不重複呼叫 API** | ✅ 已確認 | 效率最佳化 |

---

## 🚀 部署新版本

請在終端機執行：

```bash
./deploy-exchange-rates.sh
```

或手動執行：

```bash
supabase functions deploy update-exchange-rates --no-verify-jwt
```

部署後請執行測試：

```bash
./test-exchange-rates.sh
```

---

## 🔍 如何監控異常檢測

### 在 Edge Function Logs 中查看

前往 [Supabase Dashboard](https://supabase.com/dashboard/project/rlahfuzsxfbocmkecqvg/functions/update-exchange-rates/details) > Edge Functions > update-exchange-rates > Logs

您會看到類似這樣的日誌：

**正常情況：**
```
✓ USD changed 2.85% (old: 31.6, new: 32.5). Accepted.
✓ JPY changed 1.23% (old: 0.203, new: 0.206). Accepted.
✓ EUR changed 3.45% (old: 37.4, new: 38.7). Accepted.
```

**異常情況：**
```
⚠️ ANOMALY DETECTED: USD changed 26.58% (old: 31.6, new: 40.0). Keeping old rate.
✓ JPY changed 1.23% (old: 0.203, new: 0.206). Accepted.
✓ EUR changed 3.45% (old: 37.4, new: 38.7). Accepted.
```

### 在測試回應中查看

執行 `./test-exchange-rates.sh` 時，如果有異常，會顯示：

```json
{
  "success": true,
  "message": "Exchange rates updated with 1 anomaly(ies) detected",
  "anomalies": [
    {
      "currency": "USD",
      "oldRate": 31.6,
      "newRate": 40.0,
      "changePercent": "26.58",
      "action": "rejected"
    }
  ],
  "warning": "Some rates changed more than 20% and were rejected..."
}
```

---

**所有改進已完成！準備部署！** 🎉
