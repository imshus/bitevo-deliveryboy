// Moves delivery photos kept on this server's disk (/photos/<file>, from before Supabase was set up) to
// Supabase Storage and points the orders at the new public links:
//   npm run move-photos                                         dry run: lists what would move
//   npm run move-photos -- --apply                              moves the photos found in backend/data/photos
//   npm run move-photos -- --from https://driverapi.bitevo.in --apply
//                                                               also fetches photos that only exist on that server
// Old files are left in place (their links keep working), and each changed order's old links are saved in
// data/backups/ first. Orders still out for delivery are left for the next run. Safe to run again.
import fs from 'node:fs';
import path from 'node:path';
import { connectStore, store } from './db/index.js';
import { usesSupabase, storageLabel, photosDir, localPhotoName, uploadPhoto, imageKind } from './lib/photos.js';

const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const apply = process.argv.includes('--apply');
const from = (arg('from') || '').replace(/\/+$/, '');

if (!usesSupabase) {
  console.log('Set SUPABASE_URL and SUPABASE_SECRET_KEY in backend/.env first (the admin panel\'s values).');
  process.exit(1);
}

async function readPhoto(name) {
  const local = path.join(photosDir, name);
  if (fs.existsSync(local)) return { body: fs.readFileSync(local), source: 'data/photos' };
  if (!from) return null;
  const res = await fetch(`${from}/photos/${encodeURIComponent(name)}`).catch(() => null);
  return res?.ok ? { body: Buffer.from(await res.arrayBuffer()), source: from } : null;
}

await connectStore();
try {
  const plan = [];
  let missing = 0;
  let busy = 0;
  const orders = await store.find('orders', {}, { projection: { orderNo: 1, status: 1, deliveryPhotos: 1 } });
  for (const order of orders) {
    const local = (order.deliveryPhotos || []).filter(ph => localPhotoName(ph?.url));
    if (!local.length) continue;
    const label = `order ${order.orderNo || order._id}`;
    // A rider may still be adding photos to it: leave it for the next run.
    if (order.status === 'out_for_delivery') {
      busy++;
      console.log(`  later      ${label}: still out for delivery`);
      continue;
    }
    const moves = [];
    for (const ph of local) {
      const name = localPhotoName(ph.url);
      const photo = await readPhoto(name);
      const ext = photo && imageKind(photo.body);
      if (!ext) {
        missing++;
        console.log(`  not found  ${label}: ${ph.url}`);
        continue;
      }
      moves.push({ url: ph.url, name, ext, body: photo.body, source: photo.source });
    }
    if (moves.length) plan.push({ order, label, moves });
  }

  const count = plan.reduce((n, p) => n + p.moves.length, 0);
  console.log(`\nDelivery photos now go to: ${storageLabel}`);
  console.log(`${count} photo(s) of ${plan.length} order(s) to move, ${missing} not found${missing && !from ? ' (add --from <delivery API address> to fetch them from the server)' : ''}, ${busy} order(s) still out for delivery.`);
  if (!apply) {
    for (const p of plan) for (const m of p.moves) console.log(`  would move ${p.label}: ${m.name} (from ${m.source})`);
    console.log('Dry run: nothing changed. Add --apply to move them.');
  } else if (plan.length) {
    const dir = path.resolve('data', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const backup = path.join(dir, `move-photos-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(backup, JSON.stringify(plan.map(({ order }) => ({ _id: order._id, orderNo: order.orderNo, deliveryPhotos: order.deliveryPhotos })), null, 1));
    console.log(`Old links saved in ${backup}`);

    let moved = 0;
    for (const p of plan) {
      const links = {};
      for (const m of p.moves) links[m.url] = await uploadPhoto(m.name, m.body, m.ext, { overwrite: true });
      const photos = p.order.deliveryPhotos.map(ph => (links[ph.url] ? { ...ph, url: links[ph.url] } : ph));
      // Only if the order hasn't changed status in the meantime (riders add photos only while out for delivery).
      const done = await store.updateWhere('orders', { _id: p.order._id, status: p.order.status }, { deliveryPhotos: photos });
      if (done) moved += p.moves.length;
      console.log(`  ${done ? 'moved' : 'skipped (changed meanwhile)'}  ${p.label}: ${p.moves.length} photo(s)`);
    }
    console.log(`Done: ${moved} of ${count} photo(s) now in Supabase Storage.`);
  }
} finally {
  await store.close();
}
