#!/usr/bin/env node
/**
 * 清理 E2E 測試帳號及所有相關資料
 *
 * 使用 Supabase Admin API 刪除測試用戶，由於資料表有 ON DELETE CASCADE，
 * 會自動刪除該用戶的 transactions、accounts、settings、checkins。
 *
 * 使用方式：
 *   E2E_TEST_EMAIL=e2e-test-please-delete@example.com node scripts/cleanup-e2e-user.js
 *
 * 需在 .env 中設定 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY
 * （Service Role Key 在 Supabase Dashboard > Settings > API）
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function loadEnv() {
  const envPath = join(rootDir, '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rlahfuzsxfbocmkecqvg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const E2E_TEST_EMAIL = process.env.E2E_TEST_EMAIL || 'e2e-test-please-delete@example.com';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.log('⚠️ 未設定 SUPABASE_SERVICE_ROLE_KEY，跳過清理。');
  console.log('   請在 .env 中加入 SUPABASE_SERVICE_ROLE_KEY 以自動刪除測試帳號。');
  console.log('   或至 Supabase Dashboard > Authentication > Users 手動刪除：', E2E_TEST_EMAIL);
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function cleanup() {
  const { data: { users }, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });

  if (error) {
    console.error('取得使用者列表失敗:', error.message);
    process.exit(1);
  }

  const target = users?.find((u) => u.email === E2E_TEST_EMAIL);

  if (!target) {
    console.log('✓ 找不到測試帳號，無需清理。');
    process.exit(0);
  }

  const { error: deleteError } = await supabase.auth.admin.deleteUser(target.id);

  if (deleteError) {
    console.error('刪除測試帳號失敗:', deleteError.message);
    process.exit(1);
  }

  console.log('✓ 已刪除測試帳號及所有相關資料:', E2E_TEST_EMAIL);
}

cleanup();
