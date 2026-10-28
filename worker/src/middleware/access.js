// Optional Cloudflare Access check: every request must carry the JWT that
// Access adds after the email-code sign-in (Cf-Access-Jwt-Assertion), signed by
// the team's keys and issued for this app (AUD tag).
// Skipped when ACCESS_AUD is empty (local development, see .dev.vars.example).
//
// The team's public keys are fetched and imported once, then reused: importing
// an RSA key on every request costs noticeable CPU.

const KEYS_TTL_MS = 60 * 60 * 1000;
let keysById = null; // Map of kid -> CryptoKey
let keysFetchedAt = 0;

async function loadKeys(teamDomain) {
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Failed to fetch Access keys: ${res.status}`);
  const { keys } = await res.json();
  const map = new Map();
  for (const jwk of keys) {
    map.set(jwk.kid, await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    ));
  }
  keysById = map;
  keysFetchedAt = Date.now();
}

async function getKey(teamDomain, kid) {
  if (!keysById || Date.now() - keysFetchedAt > KEYS_TTL_MS || !keysById.has(kid)) {
    await loadKeys(teamDomain); // also picks up rotated keys
  }
  return keysById.get(kid);
}

const b64urlToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
const b64urlToJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

// Returns the payload if the token is valid, otherwise throws
async function verifyAccessJwt(token, teamDomain, aud) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const header = b64urlToJson(parts[0]);
  const payload = b64urlToJson(parts[1]);
  if (header.alg !== 'RS256') throw new Error(`unexpected alg ${header.alg}`);

  const key = await getKey(teamDomain, header.kid);
  if (!key) throw new Error('unknown signing key');
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) throw new Error('bad signature');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('expired');
  if (typeof payload.nbf === 'number' && payload.nbf > now) throw new Error('not yet valid');
  if (payload.iss !== `https://${teamDomain}`) throw new Error('wrong issuer');
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error('wrong audience');
  return payload;
}

export async function requireAccess(c, next) {
  const { ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: aud } = c.env;
  if (!aud) return next();

  const token = c.req.header('Cf-Access-Jwt-Assertion');
  if (!token) {
    return c.json({ error: 'Cloudflare Access sign-in required' }, 403);
  }

  try {
    await verifyAccessJwt(token, teamDomain, aud);
  } catch (error) {
    console.error('Access token rejected:', error.message);
    return c.json({ error: 'Cloudflare Access sign-in required' }, 403);
  }

  await next();
}
