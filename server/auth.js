// Authentifizierung: scrypt-Passworthashes, serverseitige Sitzungen (HttpOnly-Cookie).
import crypto from 'node:crypto';
import { nowIso, AppError } from './db.js';
import { can, ROLE_PERMISSIONS } from '../shared/constants.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const SESSION_COOKIE = 'grbz_session';
const SESSION_DAYS = 14;          // gleitend, für Geräte im Außeneinsatz
const MAX_FAILED = 5;             // danach temporäre Sperre
const LOCK_MINUTES = 15;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function validatePasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Das Passwort muss mindestens 10 Zeichen lang sein.';
  if (!/[A-Za-zÄÖÜäöüß]/.test(pw) || !/[0-9]/.test(pw)) return 'Das Passwort muss Buchstaben und Ziffern enthalten.';
  return null;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, employee_no: u.employee_no,
    customer_id: u.customer_id, must_change_password: !!u.must_change_password,
    permissions: ROLE_PERMISSIONS[u.role] || [],
  };
}

export function createSession(db, user, userAgent) {
  const token = crypto.randomBytes(32).toString('base64url');
  const t = new Date();
  db.run('INSERT INTO sessions(token_hash, user_id, created_at, last_seen_at, expires_at, user_agent) VALUES (?,?,?,?,?,?)',
    sha256(token), user.id, t.toISOString(), t.toISOString(), new Date(t.getTime() + SESSION_DAYS * 864e5).toISOString(), (userAgent || '').slice(0, 200));
  return token;
}

export function destroySession(db, token) {
  if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

export function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge: SESSION_DAYS * 864e5,
    path: '/',
  };
}

export function login(db, email, password, ip) {
  const user = db.get('SELECT * FROM users WHERE email = ? AND deleted = 0', String(email || '').trim());
  const generic = new AppError(401, 'E-Mail-Adresse oder Passwort ist falsch.');
  if (!user) {
    verifyPassword(password || '', hashPassword('dummy-timing-ausgleich1')); // Timing angleichen
    db.audit(null, 'login.fehlgeschlagen', 'users', null, { email: String(email || '').slice(0, 100) }, ip);
    throw generic;
  }
  if (user.locked_until && user.locked_until > nowIso()) {
    throw new AppError(423, 'Zu viele Fehlversuche. Das Konto ist vorübergehend gesperrt. Bitte in 15 Minuten erneut versuchen.');
  }
  if (!verifyPassword(password || '', user.password_hash)) {
    const failed = user.failed_logins + 1;
    const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 6e4).toISOString() : null;
    db.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', lock ? 0 : failed, lock, user.id);
    db.audit(user.id, lock ? 'login.gesperrt' : 'login.fehlgeschlagen', 'users', user.id, null, ip);
    throw generic;
  }
  if (!user.active) throw new AppError(403, 'Dieses Benutzerkonto ist deaktiviert.');
  if (user.role === 'kunde' && db.setting('portal_enabled', '0') !== '1') {
    throw new AppError(403, 'Das Kundenportal ist derzeit nicht freigeschaltet.');
  }
  db.run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', nowIso(), user.id);
  db.audit(user.id, 'login', 'users', user.id, null, ip);
  return user;
}

export function authMiddleware(db) {
  return (req, _res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const s = db.get('SELECT * FROM sessions WHERE token_hash = ?', sha256(token));
      if (s && s.expires_at > nowIso()) {
        const u = db.get('SELECT * FROM users WHERE id = ? AND active = 1 AND deleted = 0', s.user_id);
        if (u) {
          req.user = u;
          req.sessionToken = token;
          // Gleitende Verlängerung höchstens einmal pro Stunde schreiben
          if (Date.parse(s.last_seen_at) < Date.now() - 36e5) {
            db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?', nowIso(),
              new Date(Date.now() + SESSION_DAYS * 864e5).toISOString(), s.token_hash);
          }
        }
      }
    }
    next();
  };
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new AppError(401, 'Bitte melden Sie sich an.'));
  const url = req.originalUrl || '';
  if (req.user.role === 'kunde' && !url.startsWith('/api/portal') && !url.startsWith('/api/auth')) {
    return next(new AppError(403, 'Kein Zugriff.'));
  }
  next();
}

export function requirePerm(...perms) {
  return (req, _res, next) => {
    if (!req.user) return next(new AppError(401, 'Bitte melden Sie sich an.'));
    if (!perms.some((p) => can(req.user, p))) return next(new AppError(403, 'Für diese Aktion fehlt Ihnen die Berechtigung.'));
    next();
  };
}

export function assertPerm(user, ...perms) {
  if (!perms.some((p) => can(user, p))) throw new AppError(403, 'Für diese Aktion fehlt Ihnen die Berechtigung.');
}

// Minimaler Cookie-Parser (keine zusätzliche Abhängigkeit)
export function cookieParser(req, _res, next) {
  req.cookies = {};
  const h = req.headers.cookie;
  if (h) for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  next();
}
