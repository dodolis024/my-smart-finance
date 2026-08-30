/**
 * 極簡參數解析。
 * 只需要 `--key value`、`--flag` 與位置參數三種形式，引入 commander 之類的套件並不划算。
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

    const key = arg.slice(2);
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
