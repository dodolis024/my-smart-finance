const TIMEZONE_DATA = [
  { value: 'Pacific/Honolulu', zh: '(UTC-10) 夏威夷', en: '(UTC-10) Hawaii' },
  { value: 'America/Anchorage', zh: '(UTC-9) 阿拉斯加', en: '(UTC-9) Alaska' },
  { value: 'America/Los_Angeles', zh: '(UTC-8) 美西（洛杉磯）', en: '(UTC-8) US West (Los Angeles)' },
  { value: 'America/Denver', zh: '(UTC-7) 美國山區', en: '(UTC-7) US Mountain' },
  { value: 'America/Chicago', zh: '(UTC-6) 美國中部', en: '(UTC-6) US Central' },
  { value: 'America/New_York', zh: '(UTC-5) 美東（紐約）', en: '(UTC-5) US East (New York)' },
  { value: 'America/Sao_Paulo', zh: '(UTC-3) 巴西（聖保羅）', en: '(UTC-3) Brazil (São Paulo)' },
  { value: 'Europe/London', zh: '(UTC+0) 英國（倫敦）', en: '(UTC+0) UK (London)' },
  { value: 'Europe/Paris', zh: '(UTC+1) 歐洲中部（巴黎）', en: '(UTC+1) Central Europe (Paris)' },
  { value: 'Europe/Helsinki', zh: '(UTC+2) 歐洲東部（赫爾辛基）', en: '(UTC+2) Eastern Europe (Helsinki)' },
  { value: 'Asia/Dubai', zh: '(UTC+4) 杜拜', en: '(UTC+4) Dubai' },
  { value: 'Asia/Kolkata', zh: '(UTC+5:30) 印度', en: '(UTC+5:30) India' },
  { value: 'Asia/Bangkok', zh: '(UTC+7) 泰國（曼谷）', en: '(UTC+7) Thailand (Bangkok)' },
  { value: 'Asia/Shanghai', zh: '(UTC+8) 中國（上海）', en: '(UTC+8) China (Shanghai)' },
  { value: 'Asia/Taipei', zh: '(UTC+8) 台灣（台北）', en: '(UTC+8) Taiwan (Taipei)' },
  { value: 'Asia/Hong_Kong', zh: '(UTC+8) 香港', en: '(UTC+8) Hong Kong' },
  { value: 'Asia/Singapore', zh: '(UTC+8) 新加坡', en: '(UTC+8) Singapore' },
  { value: 'Asia/Tokyo', zh: '(UTC+9) 日本（東京）', en: '(UTC+9) Japan (Tokyo)' },
  { value: 'Asia/Seoul', zh: '(UTC+9) 韓國（首爾）', en: '(UTC+9) South Korea (Seoul)' },
  { value: 'Australia/Sydney', zh: '(UTC+11) 澳洲（雪梨）', en: '(UTC+11) Australia (Sydney)' },
  { value: 'Pacific/Auckland', zh: '(UTC+12) 紐西蘭（奧克蘭）', en: '(UTC+12) New Zealand (Auckland)' },
];

export function getCommonTimezones(lang = 'zh') {
  return TIMEZONE_DATA.map(({ value, zh, en }) => ({
    value,
    label: lang === 'en' ? en : zh,
  }));
}

export const COMMON_TIMEZONES = getCommonTimezones('zh');
