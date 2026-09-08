// 把備註這類純文字切成「一般文字」與「可點連結」兩種片段,交給元件渲染。
// 這裡不產生任何 HTML 字串,呼叫端必須用 React 元素渲染,避免 XSS。

// 只認 http/https 開頭:中文備註裡把不是網址的東西誤判成連結(整段變死連結)
// 代價比漏抓一個 www. 開頭的網址高得多。
// 字元類只收 URL 合法的 ASCII 字元,中文與全形標點會自然中斷比對。
const URL_PATTERN = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi;

// 網址黏在句尾標點很常見(「詳見 https://example.com。」),
// 不剝掉的話標點會被當成網址的一部分,點下去就是死連結。
// 全形標點已被 URL_PATTERN 擋在外面,這裡只需處理半形。
const TRAILING_PUNCTUATION = '.,;:!?\'")]}';

function countChar(text, char) {
  let count = 0;
  for (const c of text) {
    if (c === char) count += 1;
  }
  return count;
}

function trimTrailingPunctuation(url) {
  let end = url.length;
  while (end > 0) {
    const last = url[end - 1];
    // 維基百科那種 /wiki/Foo_(bar) 的右括號要留著:
    // 只有在括號本來就不成對時,才把它當成句子的括號剝掉。
    if (last === ')') {
      const sliced = url.slice(0, end);
      if (countChar(sliced, '(') >= countChar(sliced, ')')) break;
    } else if (!TRAILING_PUNCTUATION.includes(last)) {
      break;
    }
    end -= 1;
  }
  return url.slice(0, end);
}

// 只放行 http/https,且 :// 後面要有主機名。
// 正則本身已經保證了,這層是防呆:日後改正則也不會不小心放行 javascript:。
function isSafeUrl(url) {
  return /^https?:\/\/[^/\s]/i.test(url);
}

/**
 * @param {string} text 原始文字
 * @returns {Array<{ type: 'text' | 'link', value: string }>} 依序排列的片段
 */
export function linkifyParts(text) {
  const source = typeof text === 'string' ? text : '';
  if (!source) return [];

  const parts = [];
  let lastIndex = 0;
  URL_PATTERN.lastIndex = 0;

  let match = URL_PATTERN.exec(source);
  while (match !== null) {
    const url = trimTrailingPunctuation(match[0]);

    if (url && isSafeUrl(url)) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', value: source.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'link', value: url });
      // 剝掉的標點不更新 lastIndex,會被下一段 text 片段收回去
      lastIndex = match.index + url.length;
    }

    match = URL_PATTERN.exec(source);
  }

  if (lastIndex < source.length) {
    parts.push({ type: 'text', value: source.slice(lastIndex) });
  }

  return parts;
}

export function hasLink(text) {
  return linkifyParts(text).some((part) => part.type === 'link');
}
