// Fresh demo data for the local JSON store (never MongoDB): npm run seed -- --reset
// Stop the API first: it keeps the JSON file in memory and would write over the change.
import { connectStore, store } from './db/index.js';
import { resetDemo, seedDemoIfEmpty } from './demo/seed.js';

await connectStore();
if (store.kind !== 'file') {
  console.error(`This API uses ${store.label}. Demo data only goes into the local JSON file, so nothing was changed.`);
  process.exit(1);
}
const r = process.argv.includes('--reset') ? await resetDemo() : await seedDemoIfEmpty();
console.log(r ? `Demo data loaded: ${r.agents} riders, ${r.orders} orders.` : 'The store already has data. Use "npm run seed -- --reset" to start again.');
await store.close();
