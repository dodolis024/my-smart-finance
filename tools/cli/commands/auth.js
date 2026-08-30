import readline from 'node:readline';
import { clearStoredSession, sessionPath } from '../../core/auth.js';
import { getCurrentUser, login } from '../../core/client.js';
import { callbackUrl, loginWithBrowser } from '../../core/oauth.js';
import { printJson } from '../format.js';

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

    if (hidden) {
      // 密碼不該顯示在終端機上，也不該留在畫面捲動紀錄裡
      rl._writeToOutput = (chunk) => {
        if (chunk.includes(question)) rl.output.write(chunk);
      };
    }

    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function loginWithPassword() {
  // 密碼刻意不提供 --password 旗標：那會把密碼留在 shell history 裡
  const email = process.env.SMF_EMAIL || (await ask('Email: '));
  const password = process.env.SMF_PASSWORD || (await ask('密碼: ', { hidden: true }));
  return login(email, password);
}

export async function loginCommand({ flags = {} } = {}) {
  // 預設走瀏覽器 OAuth：Google 帳號在 Supabase 裡沒有密碼，帳密登入對它們永遠無效。
  // --password 保留給用 email 註冊、且偏好在終端機內完成登入的使用者。
  const result = flags.password
    ? await loginWithPassword()
    : await loginWithBrowser({
        provider: flags.provider || 'google',
        onPrompt: (url, opened) => {
          if (opened) {
            console.log('→ 已開啟瀏覽器，請完成登入…');
            console.log(`  若瀏覽器沒有自動開啟，請手動開啟：\n  ${url}`);
          } else {
            console.log('→ 請在瀏覽器開啟以下網址完成登入：');
            console.log(`  ${url}`);
          }
        },
      });

  console.log(`✓ 已登入：${result.email}`);
  console.log(`  session 存於 ${sessionPath()}（權限 0600）`);
}

export async function logoutCommand() {
  const removed = clearStoredSession();
  console.log(removed ? '✓ 已登出' : '（本來就沒有登入紀錄）');
}

export async function whoamiCommand({ flags = {} } = {}) {
  const user = await getCurrentUser();

  if (flags.json) return printJson({ email: user.email, userId: user.id });

  console.log(`${user.email}`);
  console.log(`user_id: ${user.id}`);
}

/** 印出 Supabase 需要設定的回呼網址，省得使用者自己拼 */
export async function callbackUrlCommand() {
  console.log(callbackUrl());
}
