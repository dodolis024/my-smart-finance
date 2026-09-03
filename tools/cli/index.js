#!/usr/bin/env node
import { parseArgs } from './args.js';
import { printError } from './format.js';
import { callbackUrlCommand, loginCommand, logoutCommand, whoamiCommand } from './commands/auth.js';
import { addCommand, editCommand, listCommand, removeCommand } from './commands/transactions.js';
import { splitCommand } from './commands/split.js';
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

分帳
  finance split groups                     列出分帳群組與成員
  finance split show 日本行                 費用明細與結算建議（--limit N 只影響印出幾筆）
  finance split add 晚餐 1200 --group 日本行 [--paid-by 我]
      [--split 我,小明,小美]        指定參與者均分（省略＝全體均分）
      [--split "我=200,小明,小美"]   我固定 200，其餘均分剩下的
      [--split "我=300,小明=900"]    全部固定，總和須等於金額
      [--currency JPY] [--date today] [--note 備註] [--dry-run]
  finance split edit <費用id> [--amount 3500] [--split ...] [--dry-run]
  finance split settle --from 小明 --to 我 --amount 500 --group 日本行
  finance split rm <費用id>

  --split 有等號＝固定金額，沒等號＝分剩下的。
  --split 與 --paid-by 可用 me（或「我」）代表自己。
  群組名或項目名含空格時要加引號："日本 行"。

  分帳費用不會自動計入個人收支。網頁另有「同步至個人帳本」可一次同步整個群組，
  所以不要再用 finance add 把同一筆重記一次，那會變成重複記帳。
  寫入前可加 --dry-run 先算給使用者確認，確認後再執行一次。
  建立群組、用邀請碼加入群組請到網頁操作。

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
  split: splitCommand,
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
