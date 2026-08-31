-- =============================================================================
-- Smart Finance Tracker - 分帳邀請碼強化（一次性腳本）
-- 在 Supabase Dashboard > SQL Editor 中執行
-- =============================================================================
--
-- 背景：2026-08-31 資安健檢 H-1。get_group_by_invite_code 是 SECURITY DEFINER
-- 且未檢查登入，任何人持公開的 publishable key（該 key 寫在前端 bundle 內，
-- 本就不是機密）即可無限次試邀請碼，猜中即取得群組名稱、描述、幣別與全部成員
-- 姓名。實測未帶 Authorization header 呼叫回 HTTP 200。
--
-- 影響被健檢報告低估：邀請碼不只是「查得到群組資訊」。
-- join_split_group_as_new_member（database/split-archive-migration.sql:10）
-- 刻意只收邀請碼、不收 group_id，所以持碼者加上任一帳號即可直接加入群組，
-- 加入後 can_access_split_group 放行，該群組的全部費用、金額、備註、結算紀錄
-- 都看得到，並可新增費用。邀請碼實際上是一把永不過期的鑰匙。
--
-- 本腳本修三件事，缺任何一項都補不完整：
--
-- ① get_group_by_invite_code 加登入檢查
--    把匿名掃描整片擋掉。攻擊者仍可註冊帳號後掃，但每次嘗試都掛在某個
--    user id 下，變得可追查、可封鎖。前端 /split/join/:code? 本就包在
--    ProtectedRoute 內（src/App.jsx:94-99），正常流程不受影響。
--
-- ② generate_invite_code 由 6 碼 random() 改為 10 碼 gen_random_bytes()
--    原本 32^6 ≈ 10.7 億組。以執行當下全站 5 個群組計，期望試
--    32^6 ÷ 5 ≈ 2.1 億次即可猜中任一組，每秒 1000 次約 2.5 天跑完。
--    改 10 碼後為 32^10 ≈ 1.1 千兆組，暴力破解在數學上不再可行。
--    random() 是一般偽亂數，非密碼學安全，一併換掉。
--
-- ③ 既有群組的邀請碼一次性輪換
--    ② 只改欄位 DEFAULT，既有列的 invite_code 原封不動——而執行當下存在的
--    群組就是全部需要保護的資產，只做 ② 等於一個都沒保護到。所以必須輪換。
--
--    輪換的實際影響：成員資格存在 split_members，與邀請碼無關，
--    **已加入的成員不會被踢出，也不需要重新加入**。
--    只有「已發出但尚未被使用的邀請連結／截圖」會失效，需重新分享新碼。
--
-- 函式定義來源（除註明處外逐字照抄，簽章、LANGUAGE、SECURITY DEFINER、
-- SET search_path 一律不變）：
--   generate_invite_code      ← database/split-migration.sql 第 1 節（從未被改寫過）
--   get_group_by_invite_code  ← database/split-migration.sql 第 12 節
--     （scripts/fix-security-hardening.sql:63 只做 ALTER ... SET search_path，
--       該設定已內含在原定義的 $$ 結尾，照抄即保留）
--
-- 未納入本腳本的已知項目（H-1 報告建議 3、4，另行評估）：
--   - 群組設定頁的「重新產生邀請碼」按鈕 / invite_code_expires_at
--   - 查詢節流表。做完 ①②③ 後暴力破解已不可行，節流的邊際效益低。
--   - get_group_by_invite_code 未濾 archived_at，已封存群組仍查得到資訊
--     （封存群組不能被加入，join RPC 會擋，故僅為資訊揭露，未在本輪處理）。
--
-- 重要：本腳本須在 Supabase prod 執行，並在部署後記入 docs/DEPLOYMENT.md。
-- =============================================================================

-- =============================================================================
-- 1. 前置檢查：pgcrypto
-- =============================================================================
-- gen_random_bytes 來自 pgcrypto（Supabase 預設裝在 extensions schema）。
-- 直接檢查「第 2 段實際會呼叫的那個 signature 存在嗎」，而不是只看 pg_extension
-- 有沒有 pgcrypto——裝在別的 schema 時前者查得到、後者仍會失敗。
-- 缺了就直接停，不要建出一支呼叫不存在函式的產生器。
DO $$
BEGIN
  IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION 'extensions.gen_random_bytes 不存在，請先執行：CREATE EXTENSION pgcrypto WITH SCHEMA extensions;（若 pgcrypto 已裝在其他 schema，請改用該 schema 名稱並同步修改第 2 段）';
  END IF;
END $$;

-- =============================================================================
-- 2. generate_invite_code：6 碼 random() → 10 碼 gen_random_bytes()
-- =============================================================================
CREATE OR REPLACE FUNCTION generate_invite_code()
RETURNS TEXT AS $$
DECLARE
  chars  TEXT  := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 排除 0/O/I/1 避免混淆
  bytes  BYTEA := extensions.gen_random_bytes(10);
  result TEXT  := '';
  i INTEGER;
BEGIN
  -- 字母表長度 32，而 256 是 32 的整數倍，故 % 32 不會讓某些字元偏多。
  -- 日後若增刪字母表字元，務必重新確認這個整除關係，否則會引入偏差。
  FOR i IN 0..9 LOOP
    result := result || substr(chars, (get_byte(bytes, i) % 32) + 1, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 3. get_group_by_invite_code：加登入檢查
-- =============================================================================
CREATE OR REPLACE FUNCTION get_group_by_invite_code(p_code TEXT)
RETURNS JSON AS $$
DECLARE
  g split_groups%ROWTYPE;
  members JSON;
BEGIN
  -- 未登入不得查詢。錯誤碼對應 src/lib/splitErrors.js 既有的 AUTH_REQUIRED。
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT * INTO g FROM split_groups WHERE invite_code = upper(trim(p_code));
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT json_agg(json_build_object(
    'id', id,
    'name', name,
    'is_linked', (user_id IS NOT NULL),
    'is_self', (user_id = auth.uid())
  ) ORDER BY created_at)
  INTO members
  FROM split_members WHERE group_id = g.id;

  RETURN json_build_object(
    'id', g.id,
    'name', g.name,
    'description', g.description,
    'currency', g.currency,
    'invite_code', g.invite_code,
    'members', COALESCE(members, '[]'::json)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================================
-- 4. 既有群組邀請碼一次性輪換
-- =============================================================================
-- protect_split_group_ownership trigger（scripts/fix-split-error-codes.sql:407）
-- 的條件是 auth.uid() IS NULL OR auth.uid() <> OLD.owner_id 就拋 SPLIT_OWNER_ONLY。
-- 在 SQL Editor 執行時 auth.uid() 為 NULL，直接 UPDATE 會被自己的 trigger 擋下，
-- 因此必須暫時停用。DO 區塊是單一交易，中途出錯會連同 DISABLE 一起 rollback，
-- 不會留下沒有防護的 trigger 狀態。
DO $$
DECLARE
  v_group RECORD;
  v_code  TEXT;
  v_tries INT;
BEGIN
  ALTER TABLE split_groups DISABLE TRIGGER protect_split_group_ownership;

  FOR v_group IN SELECT id FROM split_groups LOOP
    v_tries := 0;
    LOOP
      v_code := generate_invite_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM split_groups WHERE invite_code = v_code);
      v_tries := v_tries + 1;
      IF v_tries > 10 THEN
        RAISE EXCEPTION '無法為群組 % 產生不重複的邀請碼', v_group.id;
      END IF;
    END LOOP;

    UPDATE split_groups SET invite_code = v_code WHERE id = v_group.id;
  END LOOP;

  ALTER TABLE split_groups ENABLE TRIGGER protect_split_group_ownership;
END $$;

-- =============================================================================
-- 5. 驗證
-- =============================================================================
-- 寫成「單一查詢」而非多個 SELECT：Supabase SQL Editor 執行多段 SQL 時只會顯示
-- 最後一句的輸出，分開寫等於前面幾項白驗。（RAISE NOTICE 同樣不顯示，別用。）
--
-- 邀請碼刻意只以遮蔽形式呈現——它等同鑰匙，不該出現在會被截圖或貼上的輸出裡。
-- 真正的新碼請到 App 的群組明細頁看。
--
-- 預期：每一列的「結果」都等於「預期」。
SELECT * FROM (
  SELECT 1 AS 序, '產生器使用 CSPRNG' AS 檢查項目,
    (SELECT (pg_get_functiondef(oid) LIKE '%gen_random_bytes%')::text FROM pg_proc
      WHERE proname = 'generate_invite_code' AND pronamespace = 'public'::regnamespace) AS 結果,
    'true' AS 預期
  UNION ALL SELECT 2, '查詢 RPC 有登入檢查',
    (SELECT (pg_get_functiondef(oid) LIKE '%AUTH_REQUIRED%')::text FROM pg_proc
      WHERE proname = 'get_group_by_invite_code' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 3, '查詢 RPC 仍是 SECURITY DEFINER',
    (SELECT prosecdef::text FROM pg_proc
      WHERE proname = 'get_group_by_invite_code' AND pronamespace = 'public'::regnamespace),
    'true'
  UNION ALL SELECT 4, '查詢 RPC 的 search_path 未掉',
    (SELECT array_to_string(proconfig, ',') FROM pg_proc
      WHERE proname = 'get_group_by_invite_code' AND pronamespace = 'public'::regnamespace),
    'search_path=public'
  UNION ALL SELECT 5, '邀請碼長度不是 10 的群組數',
    (SELECT count(*)::text FROM split_groups WHERE length(invite_code) <> 10),
    '0'
  UNION ALL SELECT 6, '群組總數',
    (SELECT count(*)::text FROM split_groups),
    '執行當下為 5'
  UNION ALL SELECT 7, '各群組邀請碼（遮蔽）',
    (SELECT string_agg(left(invite_code, 2) || repeat('*', length(invite_code) - 2), ' ' ORDER BY created_at)
       FROM split_groups),
    '每組 2 碼 + 8 個星號'
  UNION ALL SELECT 8, '抽樣 100 組的相異數',
    (SELECT count(DISTINCT c)::text FROM (SELECT generate_invite_code() AS c FROM generate_series(1, 100)) s),
    '100'
  UNION ALL SELECT 9, '抽樣 100 組的長度範圍',
    (SELECT min(length(c))::text || '-' || max(length(c))::text
       FROM (SELECT generate_invite_code() AS c FROM generate_series(1, 100)) s),
    '10-10'
  UNION ALL SELECT 10, 'trigger 已還原啟用',
    (SELECT tgenabled::text FROM pg_trigger
      WHERE tgrelid = 'split_groups'::regclass AND tgname = 'protect_split_group_ownership'),
    'O'
) v ORDER BY 序;

-- -----------------------------------------------------------------------------
-- 執行後必須實測（SQL 驗不出來的部分）：
--   1) 未登入呼叫 get_group_by_invite_code → 應得 AUTH_REQUIRED，不再是 200/null：
--      curl -s -w "\nHTTP %{http_code}\n" -X POST \
--        'https://rlahfuzsxfbocmkecqvg.supabase.co/rest/v1/rpc/get_group_by_invite_code' \
--        -H 'Content-Type: application/json' \
--        -H 'apikey: <publishable key>' \
--        -d '{"p_code":"000000"}'
--   2) 登入後在 App 用新邀請碼查群組 → 應查得到
--   3) 用舊的 6 碼查詢 → 應顯示「找不到此代碼」
--   4) 以另一個帳號用新碼實際加入群組 → 應成功
--   5) 群組明細頁的邀請碼顯示與「複製邀請連結」→ 應為 10 碼
--   6) 新建一個群組 → 其邀請碼應為 10 碼
--   7) 既有成員開啟分帳列表與群組明細 → 應一切正常（輪換不影響成員資格）
-- -----------------------------------------------------------------------------

-- =============================================================================
-- Rollback
-- =============================================================================
-- 第 2 段還原：照 database/split-migration.sql 第 1 節原樣重建 6 碼 random() 版。
--
-- 第 3 段還原：移除 get_group_by_invite_code 內的 IF auth.uid() IS NULL 三行，
--   其餘照本腳本第 3 段。
--   ⚠️ 這會重新開放匿名掃描，只應作為緊急止血。
--
-- 第 4 段【無法還原】：舊邀請碼已被覆蓋且未保留副本。這是刻意的——留一份舊碼
--   對照表等於把剛換掉的鑰匙抄在門口。若某個舊連結非復活不可，只能手動指定：
--     ALTER TABLE split_groups DISABLE TRIGGER protect_split_group_ownership;
--     UPDATE split_groups SET invite_code = '舊碼' WHERE id = '...';
--     ALTER TABLE split_groups ENABLE TRIGGER protect_split_group_ownership;
--   執行本腳本前請先確認這點可以接受。
-- =============================================================================
