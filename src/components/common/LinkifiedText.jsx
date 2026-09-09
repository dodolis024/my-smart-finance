import { linkifyParts } from '@/lib/linkify';

// 把純文字裡的網址渲染成可點連結。
// onLinkClick 有給的時候改由呼叫端決定怎麼開(分帳備註會先跳確認),
// href 仍然照填,滑鼠停著看得到目標、右鍵也複製得到。
// 一律用 React 元素渲染,不碰 dangerouslySetInnerHTML。
// target="_blank" 讓 PWA(standalone)模式改用系統預設瀏覽器開啟,
// 使用者記到一半的頁面不會被連結洗掉;rel 少了 noopener,
// 被開啟的網站就有能力把原本這個分頁導去釣魚頁。
export default function LinkifiedText({ text, onLinkClick }) {
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
            // 分帳的費用列點一下會展開/收合,連結的點擊不能冒泡上去
            onClick={(e) => {
              e.stopPropagation();
              if (!onLinkClick) return;
              e.preventDefault();
              onLinkClick(part.value);
            }}
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
