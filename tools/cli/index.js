#!/usr/bin/env node
import { parseArgs } from './args.js';
import { printError } from './format.js';
import { callbackUrlCommand, loginCommand, logoutCommand, whoamiCommand } from './commands/auth.js';
import { addCommand, editCommand, listCommand, removeCommand } from './commands/transactions.js';
import {
  accountsCommand,
  categoriesCommand,
  streakCommand,
  summaryCommand,
  yearCommand,
} from './commands/insights.js';

const HELP = `
finance — My Smart Finance 命令列工具

記帳
  finance add <項目> <金額> --category <分類> --account <帳戶>
      [--currency TWD] [--date YYYY-MM-DD|today|yesterday] [--time HH:MM]
      [--type expense|income] [--note 備註]
  finance list [--month M] [--year Y] [--from 日期] [--to 日期]
      [--type expense|income] [--category 分類] [--search 關鍵字] [--limit N]
  finance edit <id> [--item ...] [--amount ...] [--category ...] [--account ...]
      [--currency ...] [--date ...] [--time ...] [--note ...]
  finance rm <id>

查詢
  finance summary [--year Y] [--month M]    當月收支與分類排行
  finance streak                            連續記帳天數
  finance year [年份]                       年度回顧（JSON）
  finance accounts                          列出帳戶
  finance categories                        列出分類

帳號
  finance login              開瀏覽器用 Google 登入（預設）
  finance login --password   用 email + 密碼登入（僅限有設密碼的帳號）
  finance logout / whoami
  finance callback-url       印出需要加進 Supabase Redirect URLs 的網址

給 AI 助理／腳本
  任何指令加上 --json 就會輸出結構化資料，取代給人看的表格

範例
  finance add 星巴克 150 --category 飲食 --account 現金
  finance add 拉麵 1200 --category 飲食 --account 現金 --currency JPY
  finance list --month 8 --type expense
`.trim();

const COMMANDS = {
  login: loginCommand,
  logout: logoutCommand,
  whoami: whoamiCommand,
  'callback-url': callbackUrlCommand,
  add: addCommand,
  list: listCommand,
  ls: listCommand,
  edit: editCommand,
  rm: removeCommand,
  delete: removeCommand,
  summary: summaryCommand,
  streak: streakCommand,
  year: yearCommand,
  accounts: accountsCommand,
  categories: categoriesCommand,
  // 動態載入：MCP SDK 只有這個指令需要，一般指令不必為它付啟動成本。
  // 這裡絕對不能印任何東西——stdout 是 MCP 的協定通道。
  mcp: async () => {
    const { startMcpServer } = await import('../mcp/server.js');
    await startMcpServer();
  },
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`✗ 不認識的指令：${command}\n`);
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  const { positional, flags } = parseArgs(rest);
  await handler({ positional, flags });

  // mcp 模式排除在外：那是給 AI 助理用的長駐行程，既不該有雜訊，
  // 也不需要提醒（npx 每次啟動本來就是最新版）
  if (command !== 'mcp') {
    const { checkForUpdate, printUpdateNotice } = await import('../core/updateCheck.js');
    const update = await checkForUpdate();
    if (update) printUpdateNotice(update);
  }
}

main().catch((error) => {
  printError(error);
  process.exitCode = 1;
});
