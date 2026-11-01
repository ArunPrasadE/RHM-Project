import { useEffect } from 'react';
import { useDemo } from '../hooks/useDemo';

// Strip pinned to the bottom of every page in the read-only demo
export default function DemoBanner() {
  const { readOnly } = useDemo();

  // Leave room at the bottom so the strip never hides page content
  useEffect(() => {
    if (!readOnly) return;
    document.body.style.paddingBottom = '3.5rem';
    return () => {
      document.body.style.paddingBottom = '';
    };
  }, [readOnly]);

  if (!readOnly) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-amber-500 text-white text-center text-sm py-1.5 px-4 shadow">
      Read-only demo with made-up data. You can look around and create PDF reports, but changes are turned off.
    </div>
  );
}
