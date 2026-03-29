import { useRef } from 'react';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';

export default function FormColumn({ children }) {
  const ref = useRef(null);
  useScrollbarOnScroll(ref);
  return (
    <aside ref={ref} className="form-column scrollbar-on-scroll">
      {children}
    </aside>
  );
}
