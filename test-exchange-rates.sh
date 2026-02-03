#!/bin/bash
# =============================================================================
# 匯率系統測試腳本
# =============================================================================
# 使用方法：
# 1. 將下方的 <YOUR_SUPABASE_URL> 替換為您的 Supabase URL
# 2. 執行：./test-exchange-rates.sh
# =============================================================================

# ⚠️ 請替換為您的 Supabase URL
SUPABASE_URL="<YOUR_SUPABASE_URL>"
# 範例：SUPABASE_URL="https://abc123xyz.supabase.co"

echo "🧪 開始測試自動更新匯率系統..."
echo ""

# 測試 Edge Function
echo "📡 測試 Edge Function..."
echo ""

response=$(curl -s -X POST \
  ${SUPABASE_URL}/functions/v1/update-exchange-rates)

echo "回應內容："
echo "$response" | python3 -m json.tool 2>/dev/null || echo "$response"
echo ""

# 檢查是否成功
if echo "$response" | grep -q '"success":true'; then
    echo "✅ Edge Function 運作正常"
    
    # 檢查是否有異常檢測記錄
    if echo "$response" | grep -q '"anomalies"'; then
        echo "⚠️  偵測到異常匯率變動（超過 ±20%），已自動保留舊匯率"
        echo "   詳細資訊請查看上方回應中的 'anomalies' 欄位"
    else
        echo "✅ 所有匯率變動都在合理範圍內（±20%）"
    fi
else
    echo "❌ Edge Function 執行失敗"
    echo "   請檢查："
    echo "   1. EXCHANGE_RATE_API_KEY 是否已設定"
    echo "   2. API Key 是否有效"
    echo "   3. Edge Function Logs（請在 Supabase Dashboard 中查看）"
fi

echo ""
echo "📋 提示："
echo "   - 前往 Supabase Dashboard > Table Editor > exchange_rates 查看最新匯率"
echo "   - 查看 Edge Function Logs 了解詳細執行過程"
echo "   - 執行 'supabase secrets list' 確認 API Key 已設定"
echo ""
