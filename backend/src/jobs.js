// Housekeeping that runs while the API is up:
//  - riders who went online in the app but have sent no position for OFFLINE_AFTER_MINS (phone off,
//    app closed) are set offline, so the panel doesn't count on them. Riders carrying an order stay as
//    they are, and agents set online by hand in the panel (not through the app) are left alone.
//  - driven routes older than TRACK_KEEP_DAYS are deleted.
//  - with the local JSON store only, a stand-in kitchen accepts new demo orders (demo/seed.js).
import { store } from './db/index.js';
import { config } from './config.js';
import { nowIso, DAY, MIN } from './lib/http.js';
import { demoKitchenTick } from './demo/seed.js';

async function setIdleRidersOffline() {
  const cutoff = new Date(Date.now() - config.offlineAfterMins * MIN).toISOString();
  const online = await store.find('agents', { status: 'online', onlineVia: 'app' });
  const idle = online.filter(a => (a.location?.at || a.onlineAt || '') < cutoff);
  for (const a of idle) {
    await store.update('agents', a._id, { status: 'offline', onlineVia: null, updatedAt: nowIso() });
    console.log(`${a.name} set offline: no location for ${config.offlineAfterMins} minutes.`);
  }
}

const deleteOldTracks = () => store.removeMany('riderTrack', { at: { $lt: new Date(Date.now() - config.trackKeepDays * DAY).toISOString() } });

export function startJobs() {
  const run = (name, job) => job().catch(err => console.error(`${name}: ${err.message}`));
  const timers = [
    setInterval(() => run('Idle riders', setIdleRidersOffline), MIN),
    setInterval(() => run('Old routes', deleteOldTracks), 60 * MIN),
    setInterval(() => run('Demo kitchen', demoKitchenTick), 20000),
  ];
  run('Idle riders', setIdleRidersOffline);
  run('Old routes', deleteOldTracks);
  return () => timers.forEach(clearInterval);
}
