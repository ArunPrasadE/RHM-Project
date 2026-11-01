import { useState, useEffect } from 'react';

// Asks the server once whether this is the read-only demo (and which demo
// login to show). Shared by every component that calls the hook.
let demoRequest;

export function useDemo() {
  const [demo, setDemo] = useState({ readOnly: false, username: null, password: null });

  useEffect(() => {
    demoRequest ??= fetch('/api/demo')
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}));
    demoRequest.then((data) => setDemo((prev) => ({ ...prev, ...data })));
  }, []);

  return demo;
}
