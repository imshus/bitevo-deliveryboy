// Loaded before the APIs in the live-* launch configs (node --import). On this PC Node asks 127.0.0.1 for DNS,
// which refuses the SRV lookup of the mongodb+srv:// address (querySrv ECONNREFUSED), so the APIs couldn't open
// the database. Public resolvers answer it. Only these local runs are affected; no app code changes.
import dns from 'node:dns';

dns.setServers(['8.8.8.8', '1.1.1.1', ...dns.getServers()]);
