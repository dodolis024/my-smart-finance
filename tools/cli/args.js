/**
 * 極簡參數解析。
 * 只需要 `--key value`、`--key=value`、`--flag` 與位置參數四種形式，
 * 引入 commander 之類的套件並不划算。
 */
export function parseArgs(argv) {
  const positional = [];
  const flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    const body = arg.slice(2);
    // `--key=value` 要先切出來。少了這段，`--split=我,小明` 會被存成
    // flags['split=我,小明'] = true，於是 flags.split 是 undefined，
    // 呼叫端當成「沒指定」而套用預設值——不報錯，但算出來的東西是錯的。
    const eq = body.indexOf('=');
    if (eq > 0) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }

    const key = body;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }

  return { positional, flags };
}
