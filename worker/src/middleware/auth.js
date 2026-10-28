import { sign, verify } from 'hono/jwt';

const DEFAULT_EXPIRES_IN = 7 * 24 * 60 * 60; // 7 days, in seconds

// No fallback secret: refuse to work without a real one
function getSecret(env) {
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not set');
  }
  return env.JWT_SECRET;
}

export async function authenticateToken(c, next) {
  const authHeader = c.req.header('Authorization');
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return c.json({ error: 'Access token required' }, 401);
  }

  let decoded;
  try {
    decoded = await verify(token, getSecret(c.env), 'HS256');
  } catch (error) {
    if (error.name === 'JwtTokenExpired') {
      return c.json({ error: 'Token expired' }, 401);
    }
    return c.json({ error: 'Invalid token' }, 403);
  }

  // Verify user still exists
  const user = await c.get('db').prepare('SELECT id, username FROM users WHERE id = ?').get(decoded.userId);

  if (!user) {
    return c.json({ error: 'User not found' }, 401);
  }

  c.set('user', user);
  await next();
}

export async function generateToken(env, userId) {
  const expiresIn = Number(env.JWT_EXPIRES_IN_SECONDS) || DEFAULT_EXPIRES_IN;
  return sign(
    { userId, exp: Math.floor(Date.now() / 1000) + expiresIn },
    getSecret(env),
    'HS256'
  );
}
