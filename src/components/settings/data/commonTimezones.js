// 動態產生所有 IANA 時區清單，標籤依使用者語言在地化
// - 時區來源：Intl.supportedValuesOf('timeZone')（~400 個），舊瀏覽器 fallback 到常用清單
// - offset：Intl 'shortOffset' 即時計算，自動處理夏令時
// - 名稱：Intl 'long' 依 locale 在地化（中文顯示「台北標準時間」，英文顯示「Taipei Standard Time」）
//   並附上 IANA 城市名，讓同名時區（例如多個北美東部時區）仍可區分

const FALLBACK_TIMEZONES = [
  'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles',
  'America/Denver', 'America/Chicago', 'America/New_York',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Paris',
  'Europe/Helsinki', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok',
  'Asia/Shanghai', 'Asia/Taipei', 'Asia/Hong_Kong', 'Asia/Singapore',
  'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland',
];

// app 的 lang（'zh' / 'en'）對應到 Intl 使用的 BCP 47 locale
const LOCALE_MAP = { zh: 'zh-TW', en: 'en-US' };

function getOffsetMinutes(tz, now) {
  try {
    const localMs = new Date(now.toLocaleString('en-US', { timeZone: tz })).getTime();
    return Math.round((localMs - now.getTime()) / 60000);
  } catch {
    return 0;
  }
}

function formatOffsetLabel(tz, now) {
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(now);
    const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'UTC';
    return raw.replace('GMT', 'UTC'); // 統一顯示為 UTC±X
  } catch {
    return 'UTC';
  }
}

// IANA 識別碼的城市段（最後一段），例如 "America/New_York" -> "New York"
function ianaCity(tz) {
  return tz.split('/').pop().replace(/_/g, ' ');
}

function localizedName(tz, now, locale) {
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      timeZoneName: 'long',
    }).formatToParts(now);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value;
    // 冷門時區沒有在地化長名稱時，Intl 會回傳 "GMT+8" 這類字串，改用城市名
    if (!name || /^(GMT|UTC)/i.test(name)) return ianaCity(tz);
    return name;
  } catch {
    return ianaCity(tz);
  }
}

function buildLabel(tz, now, locale) {
  const offset = formatOffsetLabel(tz, now);
  const city = ianaCity(tz);
  const name = localizedName(tz, now, locale);
  // 在地化名稱已等於城市名（GMT fallback）時不重複附加
  const suffix = name === city ? city : `${name} · ${city}`;
  return `(${offset}) ${suffix}`;
}

// 依 locale 快取，避免每次 render 重算 400 個時區
const _cache = new Map();

function buildTimezoneList(locale) {
  if (_cache.has(locale)) return _cache.get(locale);

  const now = new Date();
  let tzList;
  try {
    tzList = Intl.supportedValuesOf('timeZone');
  } catch {
    tzList = FALLBACK_TIMEZONES;
  }

  const list = tzList
    .map((tz) => ({
      value: tz,
      label: buildLabel(tz, now, locale),
      _offset: getOffsetMinutes(tz, now),
    }))
    .sort((a, b) => a._offset - b._offset || a.label.localeCompare(b.label, locale))
    .map(({ value, label }) => ({ value, label }));

  _cache.set(locale, list);
  return list;
}

export function getCommonTimezones(lang = 'zh') {
  return buildTimezoneList(LOCALE_MAP[lang] || 'zh-TW');
}

export const COMMON_TIMEZONES = getCommonTimezones('zh');
