// Opens the data store: MongoDB when a connection string is configured, otherwise a local JSON file.
// Everything else imports `store` from here and never talks to MongoDB directly.
//
// Collections this app shares with the admin panel and the website:
//   agents    reads; writes `status`, `location`, `odometer`, `onlineVia`
//   orders    reads; writes the rider's steps (assigned, out_for_delivery, delivered) like the panel does
//   walletTxns, sessions, loginEvents  writes (cashback on delivery, rider sign-ins)
// Collections only this app uses: agentOtpCodes (sign-in codes), riderTrack (driven route of each order).
import { config } from '../config.js';
import { createMongoStore } from './mongoStore.js';
import { createFileStore } from './fileStore.js';

export let store = null;

const INDEXES = [
  ['orders', { agentId: 1, status: 1 }],
  ['orders', { status: 1, placedAt: -1 }],
  ['agentOtpCodes', { phone: 1, createdAt: -1 }],
  ['riderTrack', { orderId: 1, at: 1 }],
  ['riderTrack', { at: 1 }],
  ['sessions', { tokenHash: 1 }, { unique: true, partialFilterExpression: { tokenHash: { $type: 'string' } } }],
];

export async function connectStore() {
  store = config.mongoUri
    ? await createMongoStore(config.mongoUri, config.mongoDbName)
    : await createFileStore(config.dataFile);
  await store.ensureIndexes(INDEXES);
  return store;
}
