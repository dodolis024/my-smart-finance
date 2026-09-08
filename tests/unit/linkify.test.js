import { describe, it, expect } from 'vitest';
import { linkifyParts, hasLink } from '@/lib/linkify';

/**
 * 備註裡的網址辨識。這裡守的重點:
 * 1. 只認 http/https,不讓 javascript: 之類的協定變成可點連結
 * 2. 中文與全形標點要能中斷網址,不能被吃進去變成死連結
 * 3. 沒被認成連結的字元一個都不能掉,拼回去要跟原文一樣
 */

const rejoin = (text) => linkifyParts(text).map((p) => p.value).join('');
const links = (text) => linkifyParts(text).filter((p) => p.type === 'link').map((p) => p.value);

describe('linkifyParts', () => {
  it('空字串與非字串回傳空陣列', () => {
    expect(linkifyParts('')).toEqual([]);
    expect(linkifyParts(null)).toEqual([]);
    expect(linkifyParts(undefined)).toEqual([]);
  });

  it('沒有網址時整段維持一個文字片段', () => {
    expect(linkifyParts('午餐 便當')).toEqual([{ type: 'text', value: '午餐 便當' }]);
    expect(hasLink('午餐 便當')).toBe(false);
  });

  it('認出 http 與 https,並保留前後文字', () => {
    expect(linkifyParts('收據 https://example.com/r/1 已存')).toEqual([
      { type: 'text', value: '收據 ' },
      { type: 'link', value: 'https://example.com/r/1' },
      { type: 'text', value: ' 已存' },
    ]);
    expect(links('http://example.com')).toEqual(['http://example.com']);
  });

  it('一段備註裡的多個網址都要認出來', () => {
    expect(links('A https://a.com B https://b.com')).toEqual(['https://a.com', 'https://b.com']);
  });

  it('剝掉黏在網址尾巴的標點,標點本身不能消失', () => {
    const text = '詳見 https://example.com/a。';
    expect(links(text)).toEqual(['https://example.com/a']);
    expect(rejoin(text)).toBe(text);

    expect(links('見 https://example.com/a, 謝謝')).toEqual(['https://example.com/a']);
    expect(links('見 https://example.com/a.')).toEqual(['https://example.com/a']);
    expect(links('(見 https://example.com/a)')).toEqual(['https://example.com/a']);
  });

  it('網址本身成對的括號要留著', () => {
    expect(links('https://zh.wikipedia.org/wiki/Foo_(bar)')).toEqual([
      'https://zh.wikipedia.org/wiki/Foo_(bar)',
    ]);
  });

  it('中文緊接在網址後面時要在中文處斷開', () => {
    expect(links('https://example.com/a收據')).toEqual(['https://example.com/a']);
  });

  it('不認 http/https 以外的協定', () => {
    expect(hasLink('javascript:alert(1)')).toBe(false);
    expect(hasLink('mailto:a@b.com')).toBe(false);
    expect(hasLink('file:///etc/passwd')).toBe(false);
    expect(hasLink('ftp://example.com')).toBe(false);
  });

  it('不認 www. 開頭與沒有主機名的殘缺網址', () => {
    expect(hasLink('www.example.com')).toBe(false);
    expect(hasLink('https://')).toBe(false);
    expect(hasLink('https://.')).toBe(false);
  });

  it('任何輸入拼回去都要等於原文', () => {
    const samples = [
      '午餐',
      'https://a.com',
      '前 https://a.com 中 https://b.com/x?y=1&z=2 後。',
      '(見 https://a.com)、以及 https://b.com。',
      'javascript:alert(1) 與 https:// 都不算',
    ];
    samples.forEach((s) => expect(rejoin(s)).toBe(s));
  });
});
