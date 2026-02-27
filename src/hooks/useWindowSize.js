import { useState, useEffect } from 'react';
import { debounce } from '@/lib/utils';
import { DEBOUNCE } from '@/lib/constants';

export function useWindowSize() {
  const [windowSize, setWindowSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
  }));

  useEffect(() => {
    const updateSize = debounce(() => {
      setWindowSize({ width: window.innerWidth });
    }, DEBOUNCE.RESIZE_MS);

    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  return windowSize;
}
