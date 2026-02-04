#!/bin/bash
# =============================================================================
# 匯率更新狀態檢查腳本（簡易版）
# =============================================================================
# 此腳本用於快速檢查匯率是否今日已更新
# 使用方法：./check-exchange-rates.sh
# 
# ⚠️ 請先替換以下變數為您的實際值
# =============================================================================

# 設定您的 Supabase 資訊（從 .env.local 或 Supabase Dashboard 取得）
SUPABASE_URL="<YOUR_SUPABASE_URL>"
SUPABASE_ANON_KEY="<YOUR_SUPABASE_ANON_KEY>"

# 如果您有 .env.local，可以自動載入
if [ -f .env.local ]; then
    # 嘗試從 .env.local 讀取（需要手動解析）
    # 這裡使用簡單的方式：直接設定
    echo "📝 請確認已在此腳本中設定 SUPABASE_URL 和 SUPABASE_ANON_KEY"
fi

# =============================================================================
# 檢查開始
# =============================================================================

echo "🔍 正在檢查匯率更新狀態..."
echo ""

# 檢查是否已設定
if [ "$SUPABASE_URL" = "<YOUR_SUPABASE_URL>" ]; then
    echo "❌ 錯誤：請先在腳本中設定 SUPABASE_URL 和 SUPABASE_ANON_KEY"
    echo ""
    echo "請編輯此檔案，將以下兩行替換為實際值："
    echo '  SUPABASE_URL="https://your-project.supabase.co"'
    echo '  SUPABASE_ANON_KEY="eyJhbG..."'
    exit 1
fi

# 使用 Supabase REST API 直接查詢匯率表
echo "📊 查詢匯率表..."
response=$(curl -s -X GET \
  "${SUPABASE_URL}/rest/v1/exchange_rates?select=currency_code,rate,updated_at&order=updated_at.desc" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}")

echo "最新匯率資料："
echo "$response" | python3 -m json.tool 2>/dev/null || echo "$response"
echo ""

# 提取最新更新時間
latest_update=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data[0]['updated_at'] if data else 'N/A')" 2>/dev/null)

if [ -n "$latest_update" ] && [ "$latest_update" != "N/A" ]; then
    echo "✅ 最新更新時間：$latest_update"
    
    # 簡單判斷是否為今天（粗略檢查）
    today=$(date -u +%Y-%m-%d)
    if echo "$latest_update" | grep -q "$today"; then
        echo "✅ 匯率今天有更新！"
    else
        echo "⚠️ 匯率今天可能尚未更新"
        echo "   （如果現在是台灣時間 10:00 之前，這是正常的）"
    fi
else
    echo "❌ 無法取得匯率資料"
fi

echo ""
echo "📋 詳細檢查："
echo "   - 在 Supabase Dashboard > Table Editor > exchange_rates 查看完整資料"
echo "   - 執行 check-exchange-rate-status.sql 查看詳細健康檢查"
echo "   - 查看 Edge Function Logs 了解執行狀況"
echo ""
