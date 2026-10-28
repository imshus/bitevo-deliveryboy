// Rider sign-in with a one-time code sent to the mobile number the admin panel has for them
// (Team → agents). Numbers that aren't a BiteVo agent get no code. Every attempt is logged in
// `loginEvents` (admin panel → Login status).
import { Router } from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { store } from '../db/index.js';
import { config } from '../config.js';
import { sha256 } from '../lib/ids.js';
import { badRequest, forbidden, notFound, unauthorized, tooMany, nowIso, MIN } from '../lib/http.js';
import { normalizePhone, deviceName, clientIp } from '../lib/rules.js';
import { phoneCodesByMiniMoth, sendPhoneCode, checkPhoneCode, MINIMOTH_CODE_TTL_MS } from '../lib/sms.js';
import { findAgentByPhone, publicAgent } from '../lib/agents.js';
import { findSession, startSession, clearSessionCookie } from '../auth.js';

export const router = Router();

const CODE_TTL_MS = 5 * MIN;
const RESEND_AFTER_MS = 30000;
const MAX_CODES_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

const limiter = (limit, message) => rateLimit({
  windowMs: 15 * MIN, limit, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: message },
});
const sendLimiter = limiter(10, 'Too many codes requested. Please wait 15 minutes and try again.');
const verifyLimiter = limiter(30, 'Too many sign-in attempts. Please wait 15 minutes and try again.');

// The code is hashed with the number it was sent to, so a leaked hash can't be replayed for another.
const codeHash = (phone, code) => sha256(`${phone}:${code}`);

function requirePhone(body) {
  const phone = normalizePhone(body?.phone);
  if (!phone) throw badRequest('Enter a valid 10-digit mobile number.');
  return phone;
}

const logAttempt = (req, phone, agent, success, reason) => store.insert('loginEvents', {
  userId: agent?._id ?? null, userName: agent?.name || 'Unknown', role: 'agent', identifier: phone,
  platform: 'web', device: `${deviceName(req.get('user-agent'))} · Delivery app`, ip: clientIp(req), success, reason, at: nowIso(),
});

// The agent behind a number, or a friendly error (logged) when they can't sign in.
async function agentFor(req, phone) {
  const agent = await findAgentByPhone(phone);
  if (!agent) {
    await logAttempt(req, phone, null, false, 'Not a delivery agent');
    throw notFound('This number isn’t registered as a BiteVo delivery partner. Ask your BiteVo manager to add you.');
  }
  if (!agent.isActive) {
    await logAttempt(req, phone, agent, false, 'Agent suspended');
    throw forbidden('Your delivery account is switched off. Please contact your BiteVo manager.');
  }
  return agent;
}

router.post('/otp', sendLimiter, async (req, res) => {
  const phone = requirePhone(req.body);
  const agent = await agentFor(req, phone);
  const remote = phoneCodesByMiniMoth();

  const since = new Date(Date.now() - 60 * MIN).toISOString();
  const recent = await store.find('agentOtpCodes', { phone, createdAt: { $gte: since } }, { sort: { createdAt: -1 } });
  if (recent[0] && Date.now() - Date.parse(recent[0].createdAt) < RESEND_AFTER_MS) throw tooMany('Please wait a few seconds before asking for another code.');
  if (recent.length >= MAX_CODES_PER_HOUR) throw tooMany('Too many codes for this number. Please try again in an hour.');

  // Live: MiniMoth makes the code and sends it. Test mode: our own code, shown on screen.
  const code = remote ? null : String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const saved = await store.insert('agentOtpCodes', {
    phone, codeHash: remote ? null : codeHash(phone, code), ...(remote && { remote: 'minimoth' }), attempts: 0, usedAt: null,
    createdAt: nowIso(), expiresAt: new Date(Date.now() + (remote ? MINIMOTH_CODE_TTL_MS : CODE_TTL_MS)).toISOString(),
  });
  try {
    if (remote) await sendPhoneCode(phone);
    else console.log(`[dev] Rider sign-in code for ${agent.name} (${phone}): ${code}`);
  } catch (err) {
    await store.removeMany('agentOtpCodes', { _id: saved._id }).catch(() => {});
    if (err.reason) await logAttempt(req, phone, agent, false, `Code not sent: ${err.reason}`).catch(() => {});
    throw err;
  }
  res.json({ phone, resendAfterSecs: RESEND_AFTER_MS / 1000, ...(config.otpDevMode ? { devCode: code } : {}) });
});

router.post('/verify', verifyLimiter, async (req, res) => {
  const phone = requirePhone(req.body);
  const agent = await agentFor(req, phone);
  const fail = async (reason, message) => {
    await logAttempt(req, phone, agent, false, reason);
    throw unauthorized(message);
  };

  const code = String(req.body?.code || '').replace(/\D/g, '');
  const [latest] = await store.find('agentOtpCodes', { phone, usedAt: null }, { sort: { createdAt: -1 }, limit: 1 });
  if (!latest || Date.parse(latest.expiresAt) < Date.now()) await fail('OTP expired', 'That code has expired. Ask for a new one.');
  if (latest.attempts >= MAX_ATTEMPTS) await fail('Too many attempts', 'Too many wrong tries. Ask for a new code.');
  const result = code.length !== 6 ? 'wrong'
    : latest.remote ? await checkPhoneCode(phone, code)
    : codeHash(phone, code) === latest.codeHash ? 'ok' : 'wrong';
  if (result === 'expired') {
    await store.update('agentOtpCodes', latest._id, { usedAt: nowIso() });
    await fail('OTP expired', 'That code has expired. Ask for a new one.');
  }
  if (result === 'locked') {
    await store.update('agentOtpCodes', latest._id, { attempts: MAX_ATTEMPTS });
    await fail('Too many attempts', 'Too many wrong tries. Ask for a new code.');
  }
  if (result !== 'ok') {
    await store.update('agentOtpCodes', latest._id, { attempts: latest.attempts + 1 });
    await fail('Invalid OTP', 'That code isn’t right. Check the message and try again.');
  }
  await store.update('agentOtpCodes', latest._id, { usedAt: nowIso() });

  await logAttempt(req, phone, agent, true, null);
  await startSession(req, res, agent);
  res.json({ agent: publicAgent(agent) });
});

router.get('/me', async (req, res) => {
  const found = await findSession(req);
  if (!found) throw unauthorized('Not signed in.');
  res.json({ agent: publicAgent(found.agent) });
});

// Signing out also takes the rider offline, unless they're still carrying an order.
router.post('/logout', async (req, res) => {
  const found = await findSession(req);
  if (found) {
    await store.update('sessions', found.session._id, { revokedAt: nowIso() });
    if (found.agent.status === 'online') await store.update('agents', found.agent._id, { status: 'offline', updatedAt: nowIso() });
  }
  clearSessionCookie(res);
  res.status(204).end();
});
