// Rider sessions: a random token in an httpOnly cookie; only its SHA-256 hash is stored.
// Sessions live in the shared "sessions" collection with role "agent", so they show up in the admin
// panel's Login status page, and an admin can sign a rider out there. Suspending or removing an agent
// in the panel revokes their sessions too.
import { store } from './db/index.js';
import { config } from './config.js';
import { randomToken, sha256 } from './lib/ids.js';
import { unauthorized, nowIso, DAY } from './lib/http.js';
import { deviceName, clientIp } from './lib/rules.js';

const TOUCH_EVERY_MS = 60000; // how often "last active" is written while a rider uses the app

export async function findSession(req) {
  const token = req.cookies?.[config.cookie.name];
  if (!token) return null;
  const session = await store.findOne('sessions', { tokenHash: sha256(token) });
  if (!session || session.role !== 'agent' || session.revokedAt) return null;
  if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) return null;
  const agent = await store.findById('agents', session.userId);
  if (!agent || !agent.isActive) return null;
  return { session, agent };
}

// Guards every route that needs a signed-in rider.
export async function requireAgent(req, res, next) {
  const found = await findSession(req);
  if (!found) throw unauthorized('Please sign in again.');
  req.agent = found.agent;
  req.session = found.session;
  if (Date.now() - Date.parse(found.session.lastActiveAt) > TOUCH_EVERY_MS) {
    await store.update('sessions', found.session._id, { lastActiveAt: nowIso() });
  }
  next();
}

const cookieOptions = () => ({
  httpOnly: true,
  secure: config.cookie.secure,
  sameSite: config.cookie.sameSite,
  path: '/',
});

export async function startSession(req, res, agent) {
  const token = randomToken();
  const at = nowIso();
  await store.insert('sessions', {
    userId: agent._id, userName: agent.name, role: 'agent', identifier: agent.phone,
    platform: 'web', device: `${deviceName(req.get('user-agent'))} · Delivery app`, ip: clientIp(req),
    loginAt: at, lastActiveAt: at, revokedAt: null,
    expiresAt: new Date(Date.now() + config.sessionDays * DAY).toISOString(),
    tokenHash: sha256(token),
  });
  res.cookie(config.cookie.name, token, { ...cookieOptions(), maxAge: config.sessionDays * DAY });
}

export function clearSessionCookie(res) {
  res.clearCookie(config.cookie.name, cookieOptions());
}
