-- =============================================================================
-- 交易金額守門：transactions.amount 不得為負
-- =============================================================================
-- 背景：
--   金額 > 0 的檢查只在前端（src/hooks/useTransactions.js）與 CLI
--   （tools/core/transactions.js）做，transactions.amount 本身只有
--   NUMERIC(10, 2) NOT NULL。直接打 API 可以把負數寫進自己的帳本。
--   影響範圍只有寫入者自己的統計，沒有跨使用者影響——這層是防呆，不是防人。
--
-- 為什麼是 >= 0 而不是 > 0：
--   sync_split_to_ledger 用 COALESCE(SUM(share), 0) 算同步金額，沒有「總額 0
--   就提早結束」的分支。同步過一次之後，該成員在群組裡的分攤全被刪掉時，
--   get_split_sync_status 會回 needs_update = true、畫面出現「重新同步」，
--   點下去就是 UPDATE transactions SET amount = 0。這是正常操作走得到的路，
--   > 0 會把它擋死，使用者卡在永遠同步不掉的狀態。
--   前端與 CLI 保留 > 0 的驗證，0 只留給同步這條路。
--
-- 執行後的行為：
--   - 網頁、CLI、離線補送、訂閱自動記帳、分帳同步 → 不受影響
--   - 直寫負數金額 → 拒絕（check constraint violation）
--
-- 在 Supabase SQL Editor 執行即可；執行後記入 docs/DEPLOYMENT.md。
-- =============================================================================

-- NOT VALID：先只管新寫入，不因一筆舊資料讓整份腳本失敗；
-- 緊接著 VALIDATE 掃舊資料。VALIDATE 失敗代表 prod 已有負數金額——
-- 約束對新寫入仍然生效，用下方第 3 列的清單查清那幾筆並修正後，
-- 再單獨重跑 VALIDATE 即可。
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_amount_nonnegative;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_amount_nonnegative
  CHECK (amount >= 0) NOT VALID;
ALTER TABLE transactions
  VALIDATE CONSTRAINT transactions_amount_nonnegative;

-- =============================================================================
-- 驗證（單一查詢；SQL Editor 只顯示最後一句的輸出）
-- =============================================================================
-- 預期：第 1、2 列的「結果」等於「預期」；第 3 列在 VALIDATE 成功時必為「無」。
SELECT * FROM (
  SELECT 1 AS 序, '約束已建立' AS 檢查項目,
    (SELECT pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conrelid = 'transactions'::regclass
        AND conname = 'transactions_amount_nonnegative') AS 結果,
    'CHECK ((amount >= (0)::numeric))' AS 預期
  UNION ALL SELECT 2, '舊資料已通過驗證',
    (SELECT convalidated::text FROM pg_constraint
      WHERE conrelid = 'transactions'::regclass
        AND conname = 'transactions_amount_nonnegative'),
    'true'
  UNION ALL SELECT 3, '負數金額清單（id｜user_id｜金額）',
    (SELECT COALESCE(string_agg(id::text || '｜' || user_id::text || '｜' || amount, ' ; '), '無')
      FROM transactions WHERE amount < 0),
    '無'
) v ORDER BY 序;

-- -----------------------------------------------------------------------------
-- 正例實測（SQL 驗不出來的部分）：
--   1) 網頁新增一筆支出、一筆收入 → 應成功
--   2) 有同步過的分帳群組按「重新同步」→ 應成功
-- -----------------------------------------------------------------------------

-- =============================================================================
-- Rollback
-- =============================================================================
-- ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_amount_nonnegative;
