// Delivery photos: the rider's camera photo of the handover, taken in the app when they mark an order
// delivered. With Supabase configured (SUPABASE_URL + SUPABASE_SECRET_KEY, the same project as the admin
// panel's photos) they go to a public Supabase Storage bucket (SUPABASE_DELIVERY_BUCKET), under random names
// nobody can guess, so the website and the admin panel can show them. Without it they're kept in
// backend/data/photos and served by this API at /photos/<file> (fine for trying the app).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

const { url: SUPABASE_URL, key: SUPABASE_KEY, bucket: BUCKET } = config.supabase;
export const usesSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);
export const photosDir = path.join(path.dirname(config.dataFile), 'photos');
export const storageLabel = usesSupabase ? `Supabase Storage (bucket "${BUCKET}")` : `local folder ${photosDir}`;

const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// Recognises an image by its first bytes (never trusts the Content-Type). Returns the extension.
export function imageKind(body) {
  if (!Buffer.isBuffer(body) || body.length < 12) return undefined;
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'jpg';
  if (body.subarray(0, 4).toString('hex') === '89504e47') return 'png';
  if (body.subarray(0, 4).toString() === 'RIFF' && body.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return undefined;
}

// New sb_secret_ keys go in the apikey header only; a legacy service_role JWT also as the bearer token.
const authHeaders = () => ({ apikey: SUPABASE_KEY, ...(SUPABASE_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SUPABASE_KEY}` } : {}) });

async function supabase(method, route, { body, headers } = {}) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/${route}`, { method, body, headers: { ...authHeaders(), ...headers } });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(`Supabase Storage: ${data?.message || data?.error || `HTTP ${res.status}`}`);
    // Storage answers some "not found" and "already exists" cases with HTTP 400 and the real code in the body.
    err.status = Number(data?.statusCode) || res.status;
    throw err;
  }
  return data;
}

// The bucket is created (public, images up to 5 MB) the first time a photo is saved.
let bucketReady = null;
function ensureBucket() {
  bucketReady ??= (async () => {
    let bucket = null;
    try {
      bucket = await supabase('GET', `bucket/${BUCKET}`);
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    if (!bucket) {
      try {
        await supabase('POST', 'bucket', {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: 5 * 1024 * 1024, allowed_mime_types: Object.values(TYPES) }),
        });
        console.log(`Created the public Supabase Storage bucket "${BUCKET}" for delivery photos.`);
      } catch (err) {
        if (err.status !== 409) throw err; // created a moment ago by another request
      }
    } else if (!bucket.public) {
      throw new Error(`Supabase bucket "${BUCKET}" is private, so the website can't show its photos. Make it public in Supabase (Storage → bucket settings).`);
    }
  })().catch(err => {
    bucketReady = null; // try again with the next photo
    throw err;
  });
  return bucketReady;
}

// Stores one photo of an order and returns its link.
export async function saveDeliveryPhoto(order, body, ext) {
  const name = `${order.orderNo || order._id}-${crypto.randomBytes(12).toString('hex')}.${ext}`;
  if (!usesSupabase) {
    await fs.mkdir(photosDir, { recursive: true });
    await fs.writeFile(path.join(photosDir, name), body);
    return `/photos/${name}`;
  }
  await ensureBucket();
  await supabase('POST', `object/${BUCKET}/${encodeURIComponent(name)}`, {
    body,
    headers: { 'Content-Type': TYPES[ext], 'Cache-Control': 'max-age=31536000', 'x-upsert': 'false' },
  });
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(name)}`;
}
