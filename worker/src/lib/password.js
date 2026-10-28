import bcrypt from 'bcryptjs';

// bcryptjs: pure JS, so it runs on Workers (no native bcrypt).
const COST = 10;

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function hashPassword(password) {
  return bcrypt.hash(password, COST);
}
