import { linkifyParts } from '@/lib/linkify';

// 把純文字裡的網址渲染成可點連結。
// 一律用 React 元素渲染,不碰 dangerouslySetInnerHTML。
// target="_blank" 讓 PWA(standalone)模式改用系統預設瀏覽器開啟,
// 使用者記到一半的頁面不會被連結洗掉;rel 少了 noopener,
// 被開啟的網站就有能力把原本這個分頁導去釣魚頁。
export default function LinkifiedText({ text }) {
  const parts = linkifyParts(text);
  if (parts.length === 0) return null;

  return (
    <>
      {parts.map((part, index) =>
        part.type === 'link' ? (
          <a
            key={index}
            className="linkified-link"
            href={part.value}
            target="_blank"
            rel="noopener noreferrer"
          >
            {part.value}
          </a>
        ) : (
          <span key={index}>{part.value}</span>
        )
      )}
    </>
  );
}
