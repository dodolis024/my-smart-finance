import { useRef } from 'react';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';

export default function DashboardColumn({ children }) {
  const ref = useRef(null);
  useScrollbarOnScroll(ref);
  return (
    <main ref={ref} className="dashboard-column scrollbar-on-scroll">
      {children}
    </main>
  );
}
