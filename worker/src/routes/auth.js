import { Hono } from 'hono';
import { authenticateToken, generateToken } from '../middleware/auth.js';
import { verifyPassword, hashPassword } from '../lib/password.js';

const router = new Hono();

// POST /api/auth/login
router.post('/login', async (c) => {
  try {
    const { username, password } = await c.req.json().catch(() => ({}));

    if (!username || !password) {
      return c.json({ error: 'Username and password required' }, 400);
    }

    const user = await c.get('db').prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const validPassword = await verifyPassword(password, user.password_hash);

    if (!validPassword) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const token = await generateToken(c.env, user.id);

    return c.json({
      token,
      user: {
        id: user.id,
        username: user.username
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ error: 'Login failed' }, 500);
  }
});

// POST /api/auth/logout
router.post('/logout', authenticateToken, (c) => {
  // With JWT, logout is handled client-side by removing the token
  return c.json({ message: 'Logged out successfully' });
});

// GET /api/auth/me
router.get('/me', authenticateToken, (c) => {
  const user = c.get('user');
  return c.json({
    id: user.id,
    username: user.username
  });
});

// PUT /api/auth/change-password
router.put('/change-password', authenticateToken, async (c) => {
  try {
    const { currentPassword, newPassword } = await c.req.json().catch(() => ({}));

    if (!currentPassword || !newPassword) {
      return c.json({ error: 'Current and new password required' }, 400);
    }

    if (newPassword.length < 6) {
      return c.json({ error: 'New password must be at least 6 characters' }, 400);
    }

    const db = c.get('db');
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(c.get('user').id);

    const validPassword = await verifyPassword(currentPassword, user.password_hash);

    if (!validPassword) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }

    const newPasswordHash = await hashPassword(newPassword);

    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newPasswordHash, user.id);

    return c.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    return c.json({ error: 'Failed to change password' }, 500);
  }
});

export default router;
