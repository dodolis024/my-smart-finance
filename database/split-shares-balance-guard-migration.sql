-- =============================================================================
-- 分攤總和守門：split_expense_shares 的加總必須等於 split_expenses.amount
-- =============================================================================
-- 背景：
--   結算演算法（src/lib/splitSettlement.js）是兩邊來源算餘額：
--     付款人  +expense.amount
--     參與者  -share
--   同步到個人帳本（sync_split_to_ledger）也是直接 SUM(share)。
--   所以「總額 1000、分攤加起來 100」的費用，會讓付款人多出 900 的債權，
--   其他成員的結算金額跟著錯，而畫面上看不出來。
--
--   前端（sumMatchesAmount）與 CLI（parseSplitSpec）送出前都有擋，
--   add_split_expense / update_split_expense 也檢查成員歸屬，
--   但 RLS 讓群組成員不經 RPC 就能寫：
--     - 直接 INSERT / DELETE split_expense_shares（policy 只看是不是群組成員）
--     - 直接 UPDATE split_expenses.amount（shares 不動）
--   在 RPC 裡加檢查擋不住這三條路，守門必須放在表上。
--
-- 做法：DEFERRABLE INITIALLY DEFERRED 的 CONSTRAINT TRIGGER，commit 時才檢查。
--   一定要延遲，因為現有 RPC 的寫入順序本身就會經過「不平」的中間狀態：
--     add_split_expense    先 INSERT 費用（此時 shares 加總 = 0）再 INSERT shares
--     update_split_expense 先 DELETE 全部 shares 再 INSERT 新的
--   一般 row trigger 會在中途就報錯。延遲到 commit，RPC（一個交易）與
--   PostgREST 直寫（每個請求一個交易）都在同一個點被擋。
--
--   比對用精確相等，不留浮點容差：兩欄都是 NUMERIC(12, 2) 精確十進位，
--   前端與 CLI 也都以「最小單位的整數個數」分攤（tests/unit/splitFuzz.test.jsx
--   有斷言加總必等於金額）。留容差反而會放行真的差一個單位的資料。
--
--   同時補 share >= 0：沒有這條，「A 分 200、B 分 -100」加總仍等於 100，
--   守門形同虛設。前端 splitEqually 與 CLI parseSplitSpec 都不會產生負數分攤。
--
-- 執行後的行為：
--   - 網頁／CLI 正常新增、編輯、刪除費用 → 不受影響
--   - 直寫出不平的費用（多塞 share、抽掉 share、只改 amount）→ commit 時拒絕，
--     錯誤碼 SPLIT_SHARES_SUM_MISMATCH（DETAIL 帶費用 id）
--   - 整筆費用刪除、群組刪除（CASCADE）→ 費用已不存在，沒有東西要平，照常通過
--   - 既有已經不平的舊費用不會被動到（只在寫入時檢查）；真的去編輯那筆時，
--     前端 normalizeShares 與 CLI 都會重算成平的，過得了
--
-- 錯誤碼對照（前端 src/lib/splitErrors.js、locales errors 區塊、
-- CLI tools/core/splitExpenses.js 的 fromSplitRpcError 皆已對應）：
--   分攤加總不等於費用金額 → SPLIT_SHARES_SUM_MISMATCH
--
-- 在 Supabase SQL Editor 執行即可；執行後記入 docs/DEPLOYMENT.md。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 檢查函式
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER：trigger 函式以執行 DML 的使用者身分跑，讀表會套 RLS。
-- 群組成員本來就看得到整筆費用的 shares，但守門的正確性不該押在 select
-- policy 上；用 DEFINER 讓加總一律算在全部列上。函式只 RAISE 或放行，不回傳資料。
CREATE OR REPLACE FUNCTION assert_split_shares_balanced()
RETURNS TRIGGER AS $$
DECLARE
  v_ids    UUID[];
  v_id     UUID;
  v_amount NUMERIC(12, 2);
  v_sum    NUMERIC(12, 2);
BEGIN
  IF TG_TABLE_NAME = 'split_expenses' THEN
    v_ids := ARRAY[NEW.id];
  ELSIF TG_OP = 'INSERT' THEN
    v_ids := ARRAY[NEW.expense_id];
  ELSIF TG_OP = 'DELETE' THEN
    v_ids := ARRAY[OLD.expense_id];
  ELSE
    -- UPDATE：share 被搬到另一筆費用時，來源與目的兩邊都要平
    v_ids := ARRAY[OLD.expense_id, NEW.expense_id];
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT amount INTO v_amount FROM split_expenses WHERE id = v_id;
    -- 費用本身已不存在（整筆刪除、群組 CASCADE）→ 沒有東西要平
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(share), 0) INTO v_sum
    FROM split_expense_shares
    WHERE expense_id = v_id;

    IF v_sum <> v_amount THEN
      RAISE EXCEPTION 'SPLIT_SHARES_SUM_MISMATCH' USING DETAIL = v_id::text;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- -----------------------------------------------------------------------------
-- 2. 兩張表各掛一個延遲 constraint trigger
-- -----------------------------------------------------------------------------
-- split_expenses 只在 amount 變動時檢查：改標題、備註、日期不會動到平衡。
DROP TRIGGER IF EXISTS assert_split_expense_balanced ON split_expenses;
CREATE CONSTRAINT TRIGGER assert_split_expense_balanced
  AFTER INSERT OR UPDATE OF amount ON split_expenses
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_split_shares_balanced();

DROP TRIGGER IF EXISTS assert_split_shares_balanced ON split_expense_shares;
CREATE CONSTRAINT TRIGGER assert_split_shares_balanced
  AFTER INSERT OR UPDATE OR DELETE ON split_expense_shares
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_split_shares_balanced();

-- -----------------------------------------------------------------------------
-- 3. 分攤不得為負
-- -----------------------------------------------------------------------------
-- NOT VALID：先只管新寫入，不因一筆舊資料讓整份腳本失敗；
-- 緊接著 VALIDATE 掃舊資料。VALIDATE 失敗代表 prod 已有負數分攤——
-- 約束對新寫入仍然生效，查清那幾筆並修正後再單獨重跑 VALIDATE 即可。
ALTER TABLE split_expense_shares
  DROP CONSTRAINT IF EXISTS split_expense_shares_share_nonnegative;
ALTER TABLE split_expense_shares
  ADD CONSTRAINT split_expense_shares_share_nonnegative
  CHECK (share >= 0) NOT VALID;
ALTER TABLE split_expense_shares
  VALIDATE CONSTRAINT split_expense_shares_share_nonnegative;

-- =============================================================================
-- 4. 驗證
-- =============================================================================
-- 寫成單一查詢：Supabase SQL Editor 執行多段 SQL 時只顯示最後一句的輸出。
--
-- 預期：第 1–6 列的「結果」都等於「預期」。
-- 第 7 列是既有不平的費用筆數，不是 0 也不擋上線（trigger 只管新寫入），
-- 但那些費用的結算金額目前就是錯的，值得用第 8 列的清單去看一眼。
SELECT * FROM (
  SELECT 1 AS 序, '檢查函式存在且為 SECURITY DEFINER' AS 檢查項目,
    (SELECT prosecdef::text FROM pg_proc
      WHERE proname = 'assert_split_shares_balanced' AND pronamespace = 'public'::regnamespace) AS 結果,
    'true' AS 預期
  UNION ALL SELECT 2, '檢查函式的 search_path 未掉',
    (SELECT array_to_string(proconfig, ',') FROM pg_proc
      WHERE proname = 'assert_split_shares_balanced' AND pronamespace = 'public'::regnamespace),
    'search_path=public'
  UNION ALL SELECT 3, 'split_expenses trigger 已建立、啟用、延遲',
    (SELECT (tgenabled = 'O' AND tgdeferrable AND tginitdeferred)::text FROM pg_trigger
      WHERE tgrelid = 'split_expenses'::regclass AND tgname = 'assert_split_expense_balanced'),
    'true'
  UNION ALL SELECT 4, 'split_expense_shares trigger 已建立、啟用、延遲',
    (SELECT (tgenabled = 'O' AND tgdeferrable AND tginitdeferred)::text FROM pg_trigger
      WHERE tgrelid = 'split_expense_shares'::regclass AND tgname = 'assert_split_shares_balanced'),
    'true'
  UNION ALL SELECT 5, 'shares trigger 涵蓋 INSERT、DELETE、UPDATE',
    (SELECT ((tgtype & 4) > 0 AND (tgtype & 8) > 0 AND (tgtype & 16) > 0)::text FROM pg_trigger
      WHERE tgrelid = 'split_expense_shares'::regclass AND tgname = 'assert_split_shares_balanced'),
    'true'
  UNION ALL SELECT 6, 'share >= 0 約束已建立且已驗證舊資料',
    (SELECT convalidated::text FROM pg_constraint
      WHERE conrelid = 'split_expense_shares'::regclass
        AND conname = 'split_expense_shares_share_nonnegative'),
    'true'
  UNION ALL SELECT 7, '既有分攤加總 ≠ 金額的費用筆數（僅供參考）',
    (SELECT count(*)::text FROM split_expenses e
      WHERE e.amount <> (SELECT COALESCE(SUM(share), 0) FROM split_expense_shares WHERE expense_id = e.id)),
    '0（非 0 不擋上線）'
  UNION ALL SELECT 8, '不平費用清單（id｜金額｜加總）',
    (SELECT COALESCE(string_agg(e.id::text || '｜' || e.amount || '｜' || s.total, ' ; '), '無')
      FROM split_expenses e
      JOIN LATERAL (SELECT COALESCE(SUM(share), 0) AS total
                    FROM split_expense_shares WHERE expense_id = e.id) s ON true
      WHERE e.amount <> s.total),
    '無'
) v ORDER BY 序;

-- -----------------------------------------------------------------------------
-- 反例實測（可選，不會寫入任何資料）：
--   把 <費用id> 換成任一筆既有費用的 id 後整段執行。
--   SET CONSTRAINTS ALL IMMEDIATE 會逼延遲 trigger 當場檢查，
--   預期看到 ERROR: SPLIT_SHARES_SUM_MISMATCH；不論結果最後都 ROLLBACK。
--
--   BEGIN;
--   UPDATE split_expenses SET amount = amount + 1 WHERE id = '<費用id>';
--   SET CONSTRAINTS ALL IMMEDIATE;
--   ROLLBACK;
--
-- 正例實測（SQL 驗不出來的部分）：
--   1) 網頁新增一筆均分費用 → 應成功
--   2) 編輯同一筆，改金額與自訂分攤 → 應成功
--   3) 刪除該費用 → 應成功（shares 隨 CASCADE 消失）
--   4) CLI：finance split add 與 edit → 應成功
-- -----------------------------------------------------------------------------

-- =============================================================================
-- Rollback（僅在上述實測失敗時使用）
-- =============================================================================
-- DROP TRIGGER IF EXISTS assert_split_expense_balanced ON split_expenses;
-- DROP TRIGGER IF EXISTS assert_split_shares_balanced ON split_expense_shares;
-- DROP FUNCTION IF EXISTS assert_split_shares_balanced();
-- ALTER TABLE split_expense_shares DROP CONSTRAINT IF EXISTS split_expense_shares_share_nonnegative;
