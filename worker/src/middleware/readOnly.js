// Read-only mode for public demos (READ_ONLY = "true" in wrangler.jsonc).
// Visitors can sign in and look at everything, but nothing can be changed:
// every write is refused, and backups are turned off.
const ALLOWED_WRITES = ['/api/auth/login', '/api/auth/logout'];

export function isReadOnly(env) {
  return String(env.READ_ONLY) === 'true';
}

export async function readOnlyGuard(c, next) {
  if (!isReadOnly(c.env)) return next();

  const path = c.req.path.replace(/\/$/, '');
  const isRead = c.req.method === 'GET' || c.req.method === 'HEAD';

  if (path.startsWith('/api/backup') || (!isRead && !ALLOWED_WRITES.includes(path))) {
    return c.json({ error: 'This is a read-only demo. Changes are turned off.', readOnly: true }, 403);
  }
  return next();
}
