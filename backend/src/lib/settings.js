// Whether riders may pick orders themselves ("self-assign"): the admin panel's switch on its Live map page
// (shared settings document "app", field `deliverySelfAssign`), else SELF_ASSIGN from .env. Read at most
// every 15 seconds, so a change in the panel reaches the riders' app within about that long.
import { store } from '../db/index.js';
import { config } from '../config.js';

const READ_EVERY_MS = 15000;
let cached = { at: 0, value: config.selfAssign };

export async function selfAssign() {
  if (Date.now() - cached.at < READ_EVERY_MS) return cached.value;
  const settings = await store.findById('settings', 'app').catch(() => null);
  const value = typeof settings?.deliverySelfAssign === 'boolean' ? settings.deliverySelfAssign : config.selfAssign;
  cached = { at: Date.now(), value };
  return value;
}
