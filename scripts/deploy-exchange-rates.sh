#!/bin/bash
# =============================================================================
# 自動更新匯率系統 - 快速部署腳本
# =============================================================================

echo "🚀 開始部署自動更新匯率系統..."
echo ""

# 1. 檢查 Supabase CLI 是否已安裝
if ! command -v supabase &> /dev/null; then
    echo "❌ 錯誤：找不到 Supabase CLI"
    echo "請先執行：brew install supabase/tap/supabase"
    exit 1
fi

echo "✅ Supabase CLI 已安裝（版本：$(supabase --version)）"
echo ""

# 2. 部署 Edge Function（包含所有改進）
echo "📦 正在部署 Edge Function..."
echo "   ✓ 指數退避：5s → 15s → 45s"
echo "   ✓ Last Known Good fallback"
echo "   ✓ ±20% 異常檢測保護"
echo ""
supabase functions deploy update-exchange-rates --no-verify-jwt

if [ $? -eq 0 ]; then
    echo "✅ Edge Function 部署成功"
else
    echo "❌ Edge Function 部署失敗"
    exit 1
fi

echo ""
echo "🎉 部署完成！"
echo ""
echo "📋 接下來請執行："
echo "1. 在 Supabase SQL Editor 執行 update-cron-schedule.sql（更新排程時間）"
echo "2. 測試 Edge Function："
echo "   curl -X POST <YOUR_SUPABASE_URL>/functions/v1/update-exchange-rates"
echo ""
echo "📊 系統特性："
echo "   ✓ 每天台灣時間 10:00 自動更新匯率（API 在 08:00 更新，留 2 小時緩衝）"
echo "   ✓ 指數退避重試：5s → 15s → 45s"
echo "   ✓ 異常檢測：變動超過 ±20% 自動拒絕並保留舊匯率"
echo "   ✓ Last Known Good 機制確保系統穩定性"
