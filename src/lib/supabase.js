import { createClient } from '@supabase/supabase-js';
import { DEFAULT_ACCOUNT } from './constants';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    'Missing Supabase environment variables. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function createDefaultData(userId) {
  const { error: accountsError } = await supabase.from('accounts').insert([
    { user_id: userId, name: '現金', type: 'cash' },
    {
      user_id: userId,
      name: '信用卡A',
      type: 'credit_card',
      credit_limit: DEFAULT_ACCOUNT.CREDIT_LIMIT,
      billing_day: DEFAULT_ACCOUNT.BILLING_DAY,
      payment_due_day: DEFAULT_ACCOUNT.PAYMENT_DUE_DAY,
    },
  ]);


  const { error: settingsError } = await supabase.from('settings').insert([
    { user_id: userId, key: 'TWD', value: { rate: 1.0 } },
    { user_id: userId, key: 'USD', value: { rate: 30.0 } },
    { user_id: userId, key: 'JPY', value: { rate: 0.2 } },
    { user_id: userId, key: 'EUR', value: { rate: 32.0 } },
    { user_id: userId, key: 'GBP', value: { rate: 38.0 } },
    { user_id: userId, key: 'expense_categories', value: ['飲食', '飲料', '交通', '旅遊', '娛樂', '購物', '其他'] },
    { user_id: userId, key: 'income_categories', value: ['薪水', '投資', '其他'] },
  ]);

}
