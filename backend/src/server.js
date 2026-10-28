// Starts the BiteVo delivery partner API (and serves the built rider app, if there is one).
import { config } from './config.js';
import { connectStore, store } from './db/index.js';
import { createApp } from './app.js';
import { startJobs } from './jobs.js';
import { seedDemoIfEmpty } from './demo/seed.js';

try {
  await connectStore();
} catch (err) {
  console.error(`Could not open the database: ${err.message}`);
  process.exit(1);
}
console.log(`Data store: ${store.label}`);

// Only the local JSON file ever gets demo data; a MongoDB database is never touched.
const seeded = await seedDemoIfEmpty();
if (seeded) console.log(`Empty JSON store, so loaded demo data: ${seeded.agents} riders and ${seeded.orders} orders.`);
if (!config.kitchen) console.log('KITCHEN_LAT / KITCHEN_LNG not set: the map won’t show the pickup point.');
if (config.otpDevMode) console.log('OTP_DEV_MODE: sign-in codes are shown on screen and printed here.');

const stopJobs = startJobs();
const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`BiteVo delivery API listening on http://localhost:${config.port}`);
  if (app.locals.servesApp) console.log(`Rider app: http://localhost:${config.port}`);
});

async function shutdown() {
  stopJobs();
  server.close();
  await store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
