import { useLayoutEffect } from 'react';

// 統計卡右側的小狗是 ::after 絕對定位的背景圖，不佔版面，金額一長數字就會寫到小狗身上。
// 這裡量出「數字起點到小狗左緣」的可用寬度：放得下維持 CSS 原本的字級，放不下才等比縮小。
// 三張卡並排，一律跟著最需要縮的那張用同一個字級，數字大小才整齊。
// 最小縮到 MIN_FONT_PX；再放不下就讓小狗蓋住數字尾端（::after 本來就畫在文字之上）。
// 小狗大小與位置一律讀 computed style，CSS 各斷點怎麼調都不必回頭同步這裡。
const MIN_FONT_PX = 16;
const GAP_PX = 4; // 數字與小狗之間至少留的空隙
const ALPHA_THRESHOLD = 20; // 透明度低於此值的像素視為留白

// 小狗圖檔四周有大片透明留白（支出、餘額那兩張左側約三成），以整個圖框計算會縮得太多。
// 每張圖載入一次、掃出最左邊有畫到的像素欄，之後都以小狗實際的左緣為準。
// 圖檔網址 → { width, height, left }；null 表示載入中或讀不到像素（此時退回以圖框計算）
const opaqueBounds = new Map();
const refitListeners = new Set();

function scanOpaqueLeft(img) {
  const { naturalWidth: width, naturalHeight: height } = img;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);
  let left = width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < left; x++) {
      if (data[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD) {
        left = x;
        break;
      }
    }
  }
  return { width, height, left };
}

function getOpaqueBounds(url) {
  if (opaqueBounds.has(url)) return opaqueBounds.get(url);
  opaqueBounds.set(url, null);
  const img = new Image();
  img.onload = () => {
    try {
      opaqueBounds.set(url, scanOpaqueLeft(img));
      refitListeners.forEach((refit) => refit());
    } catch {
      // 讀不到像素就維持以整個圖框計算，只是縮得保守一點
    }
  };
  img.src = url;
  return null;
}

/** 小狗左緣相對卡片 padding box 左側的距離；沒有小狗回 null */
function dogLeftOf(card) {
  const dog = getComputedStyle(card, '::after');
  const boxWidth = parseFloat(dog.width);
  if (!(boxWidth > 0)) return null;
  // 絕對定位以 padding box 為準：圖框左緣 = 卡片內寬 − right − 寬度
  const boxLeft = card.clientWidth - (parseFloat(dog.right) || 0) - boxWidth;
  const url = /url\(["']?(.*?)["']?\)/.exec(dog.backgroundImage)?.[1];
  const bounds = url && getOpaqueBounds(url);
  if (!bounds) return boxLeft;
  // 背景是 contain＋置中：圖在框內等比縮放、水平置中，再加上圖左側的透明留白
  const scale = Math.min(boxWidth / bounds.width, parseFloat(dog.height) / bounds.height);
  return boxLeft + (boxWidth - bounds.width * scale) / 2 + bounds.left * scale;
}

/** 這張卡的數字要縮到多大才不碰到小狗；放得下（或量不到）回 null。呼叫前字級須已還原成 CSS 原樣 */
function neededSize(card, value) {
  const width = value.getBoundingClientRect().width;
  // 尚未 layout（或測試環境）量不到寬度，保持 CSS 原樣
  if (width <= 0 || card.clientWidth <= 0) return null;

  const cardStyle = getComputedStyle(card);
  // 沒有小狗就到右側內距為止
  const dogLeft = dogLeftOf(card) ?? card.clientWidth - parseFloat(cardStyle.paddingRight);
  const available = dogLeft - parseFloat(cardStyle.paddingLeft) - GAP_PX;
  if (width <= available) return null;

  const baseSize = parseFloat(getComputedStyle(value).fontSize);
  // 文字寬度與字級近乎成正比；取到 0.5px 並往下捨，寧可小一點也不要擦到
  return Math.max(MIN_FONT_PX, Math.floor(((baseSize * available) / width) * 2) / 2);
}

function fitAll(cards) {
  const pairs = cards.map((card) => [card, card.querySelector('.stat-value')]).filter(([, value]) => value);
  // 先全部還原成 CSS 字級再量，視窗變寬時才會長回原本大小
  pairs.forEach(([, value]) => {
    value.style.fontSize = '';
    value.style.lineHeight = '';
  });
  const sizes = pairs.map(([card, value]) => neededSize(card, value)).filter((size) => size != null);
  if (sizes.length === 0) return;

  const size = Math.min(...sizes);
  // 先讀完原本高度再一起寫入，避免每張卡各觸發一次重新排版
  const heights = pairs.map(([, value]) => value.getBoundingClientRect().height);
  pairs.forEach(([, value], i) => {
    value.style.fontSize = `${size}px`;
    // 行高固定在原本高度：卡片不會因縮字變矮，也避免 ResizeObserver 反覆觸發
    value.style.lineHeight = `${heights[i]}px`;
  });
}

/** contentKey：數字內容變了（換期間、換幣別）就重新量 */
export function useFitStatValues(containerRef, contentKey) {
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cards = [...container.querySelectorAll('.stat-card')];
    const refit = () => fitAll(cards);
    refit();
    // 小狗圖檔掃描完成後再量一次（第一次是以整個圖框保守計算）
    refitListeners.add(refit);

    // 視窗縮放、側邊欄展開收合、斷點切換都會改到卡片寬度
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refit);
    cards.forEach((card) => ro?.observe(card));
    return () => {
      refitListeners.delete(refit);
      ro?.disconnect();
    };
  }, [containerRef, contentKey]);
}
