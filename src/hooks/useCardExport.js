import { useState, useRef, useCallback } from 'react';

// Wait for React to commit + Chart.js first frame (animation:false → sync draw).
function waitFrames(n = 2) {
  return new Promise((resolve) => {
    let count = 0;
    const tick = () => {
      if (++count >= n) { resolve(); } else { requestAnimationFrame(tick); }
    };
    requestAnimationFrame(tick);
  });
}

export function useCardExport() {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const stageRef = useRef(null);
  const hasWarmedUp = useRef(false);

  const shareCard = useCallback(async ({ cardKey, year }) => {
    const node = stageRef.current;
    if (!node) return;

    setExporting(true);
    setExportError(null);

    try {
      const { domToBlob } = await import('modern-screenshot');

      // Give React+Chart.js time to paint into the stage
      await waitFrames(2);
      await Promise.resolve();

      const bg =
        getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() ||
        '#ffffff';

      // One-time Safari warm-up: first foreignObject render may produce a blank image
      if (!hasWarmedUp.current) {
        hasWarmedUp.current = true;
        await domToBlob(node, { scale: 1, backgroundColor: bg }).catch(() => {});
        await waitFrames(1);
      }

      // scale:1 — stage is already 1080×1920, no zoom needed
      const blob = await domToBlob(node, { scale: 1, backgroundColor: bg });
      const filename = `my-smart-finance-${year}-${cardKey}.png`;
      const file = new File([blob], filename, { type: 'image/png' });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `My Smart Finance ${year}` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setExportError(err?.message || 'Export failed');
      }
    } finally {
      setExporting(false);
    }
  }, []);

  return { exporting, exportError, stageRef, shareCard };
}
