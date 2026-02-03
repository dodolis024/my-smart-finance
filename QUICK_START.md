# 自動更新匯率 - 快速開始指南

## 🚀 三步驟完成部署

### 步驟 1：部署新版本（1 分鐘）

在終端機執行：

```bash
./deploy-exchange-rates.sh
```

### 步驟 2：更新 cron 排程（2 分鐘）

1. 開啟 [Supabase SQL Editor](https://supabase.com/dashboard/project/rlahfuzsxfbocmkecqvg/sql/new)
2. 複製 `update-cron-schedule.sql` 的**完整內容**
3. 貼到 SQL Editor 並執行
4. 確認顯示：`schedule = '0 2 * * *'`

### 步驟 3：測試功能（1 分鐘）

```bash
./test-exchange-rates.sh
```

---

## ✅ 新功能說明

### 1️⃣ 指數退避（加長間隔）
- 重試間隔：**5 秒 → 15 秒 → 45 秒**
- 避免過度請求 API

### 2️⃣ 異常檢測（±20% 保護）
- 新匯率變動超過 ±20% 時**自動拒絕**
- 保留 Last Known Good
- 記錄異常到 logs

### 3️⃣ 時間優化
- 執行時間：台灣時間 **10:00**（API 在 08:00 更新，留 2 小時緩衝）

### 4️⃣ 效率確認
- ✅ 所有用戶共用中央匯率表
- ✅ 不會重複呼叫外部 API

---

## 📋 部署檢查清單

- [ ] 執行 `./deploy-exchange-rates.sh` 部署新版本
- [ ] 在 SQL Editor 執行 `update-cron-schedule.sql` 更新排程
- [ ] 執行 `./test-exchange-rates.sh` 測試功能
- [ ] 在 Table Editor 檢查匯率是否已更新
- [ ] 檢查 `updated_at` 時間是否為剛才測試的時間

---

## 🔍 監控指令

### 查看最新匯率
```sql
SELECT currency_code, rate, updated_at 
FROM exchange_rates 
ORDER BY updated_at DESC;
```

### 查看 cron 執行歷史
```sql
SELECT jobid, runid, status, return_message, start_time, end_time
FROM cron.job_run_details 
WHERE jobname = 'update-exchange-rates-daily'
ORDER BY start_time DESC 
LIMIT 5;
```

### 手動觸發更新
```bash
curl -X POST https://rlahfuzsxfbocmkecqvg.supabase.co/functions/v1/update-exchange-rates
```

---

**準備好了嗎？開始部署吧！** 🚀

```bash
./deploy-exchange-rates.sh
```
