import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = 'cctvmap_session';
const MAX_AGE_SECONDS = 12 * 60 * 60;

/**
 * Optional shared-passcode gate. When CCTV_MAP_PASSCODE is unset the app is
 * open - which is the right default for a machine only you can reach, and the
 * wrong one for anything on a shared network. See the README.
 */
export function createAuth({ passcode, secret } = {}) {
  const enabled = Boolean(passcode);
  const signingKey = secret || randomBytes(32).toString('hex');

  const sign = (payload) => createHmac('sha256', signingKey).update(payload).digest('base64url');

  function issueToken() {
    const expires = Date.now() + MAX_AGE_SECONDS * 1000;
    const payload = String(expires);
    return `${payload}.${sign(payload)}`;
  }

  function verifyToken(token) {
    if (!token || typeof token !== 'string') return false;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return false;
    const expected = Buffer.from(sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
    return Number(payload) > Date.now();
  }

  function parseCookies(header = '') {
    return Object.fromEntries(
      header
        .split(';')
        .map((part) => part.trim().split('='))
        .filter(([k, v]) => k && v !== undefined)
        .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
    );
  }

  return {
    enabled,
    cookieName: COOKIE,

    /** Constant-time passcode comparison. */
    check(candidate) {
      if (!enabled) return true;
      const a = Buffer.from(String(candidate ?? ''));
      const b = Buffer.from(String(passcode));
      return a.length === b.length && timingSafeEqual(a, b);
    },

    isAuthenticated(req) {
      if (!enabled) return true;
      return verifyToken(parseCookies(req.headers.cookie)[COOKIE]);
    },

    loginCookie(secure) {
      const attrs = [
        `${COOKIE}=${issueToken()}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Strict',
        `Max-Age=${MAX_AGE_SECONDS}`,
      ];
      if (secure) attrs.push('Secure');
      return attrs.join('; ');
    },

    logoutCookie() {
      return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
    },
  };
}
