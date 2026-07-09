/**
 * 單元測試 - 語系檔 key 對齊
 */
import { describe, it, expect } from 'vitest';
import zh from '@/locales/zh';
import en from '@/locales/en';

function flattenKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return flattenKeys(value, path);
    }
    return [path];
  });
}

describe('locales - zh/en key 對齊', () => {
  it('zh 與 en 的 key 集合應完全一致', () => {
    const zhKeys = new Set(flattenKeys(zh));
    const enKeys = new Set(flattenKeys(en));

    const missingInEn = [...zhKeys].filter((key) => !enKeys.has(key));
    const missingInZh = [...enKeys].filter((key) => !zhKeys.has(key));

    expect(missingInEn, `en 缺少的 key: ${missingInEn.join(', ')}`).toEqual([]);
    expect(missingInZh, `zh 缺少的 key: ${missingInZh.join(', ')}`).toEqual([]);
  });
});
