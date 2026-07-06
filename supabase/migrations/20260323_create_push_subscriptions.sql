-- push_subscriptions：儲存每位用戶的 Web Push 訂閱資訊（支援多裝置）
CREATE TABLE public.push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_select" ON public.push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "owner_insert" ON public.push_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 前端以 upsert 註冊訂閱，(user_id, endpoint) 衝突時會走 UPDATE 路徑，
-- 缺這條 policy 會導致同裝置重新訂閱（金鑰輪替）被 RLS 擋下
CREATE POLICY "owner_update" ON public.push_subscriptions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner_delete" ON public.push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);
