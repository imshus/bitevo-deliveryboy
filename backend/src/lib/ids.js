import crypto from 'node:crypto';

// MongoDB-style 24-hex ObjectId: 4-byte timestamp + 8 random bytes.
export function objectId(date = new Date()) {
  const ts = Math.floor(date.getTime() / 1000).toString(16).padStart(8, '0');
  return ts + crypto.randomBytes(8).toString('hex');
}

export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
