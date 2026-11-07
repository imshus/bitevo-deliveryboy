# BiteVo — Delivery Partner app

The app BiteVo's delivery riders use on their phones: sign in with their mobile number, go online, see
their orders and new orders nearby on a live map, pick up from the kitchen, follow the road route to the
customer, collect cash and mark orders delivered. While a rider is online the app shares their **live
location** every few seconds.

It shares its database with the admin panel (`../bitevoadminpanel`) and the website
(`../bitevomainwebsite`): riders are the panel's **Team → agents**, orders are the same orders, and every
step a rider takes shows up in the panel (agent status, the order's status and history).

```
backend/   Node.js + Express API (port 4002)
frontend/  React + Vite rider app with Leaflet maps (port 2003), installable on the phone's home screen
mobile/    Android app (BiteVoRider.apk): the rider app plus location sharing with the screen off
```

| App | Port |
|---|---|
| Marketing site (`../bitevo`) | 2000 |
| Admin panel web / API | 2001 / 4000 |
| Customer website / API | 2002 / 4001 |
| **This app / its API** | **2003 / 4002** |

## Run it

```bash
npm install                       # installs backend/ and frontend/
npm run dev --prefix backend      # API on http://localhost:4002
npm run dev --prefix frontend     # app on http://localhost:2003
```

Copy `backend/.env.example` to `backend/.env` first. With no MongoDB settings the API keeps data in
`backend/data/db.json` and loads **demo data**: three riders and today's orders around Sectors 40, 44 and 45
in Gurugram. A stand-in "kitchen" accepts new demo orders after two minutes, and the home screen has an
**Add a demo order** button. `npm run seed --prefix backend -- --reset` (with the API stopped) starts the demo
data again. Demo data only ever goes into that JSON file, never into MongoDB.

Demo riders (sign-in codes are shown on screen while `OTP_DEV_MODE=true`):

| Rider | Number | |
|---|---|---|
| Ravi Kumar | 98765 00001 | verified, has an order |
| Suresh Yadav | 98765 00003 | verified |
| Amit Sharma | 98765 00002 | ID check pending: can sign in but not go online |

**To use the real data**, put the same `MONGO_DB_URL` / `MONGO_DB_USER` / `MONGO_DB_PASSWORD` /
`MONGO_DB_NAME` as `../bitevoadminpanel/backend/.env` into `backend/.env`, set `KITCHEN_LAT` / `KITCHEN_LNG`
to the kitchen's real position, and add riders in the admin panel (Team → Add agent, with their mobile number
and vehicle; set the ID check to Verified).

## What riders can do

- **Sign in** with the mobile number the panel has for them and a 6-digit code (WhatsApp/SMS through MiniMoth,
  like the website). Numbers that aren't an agent get no code. Suspended agents can't sign in, and suspending one
  in the panel signs them out everywhere. Sign-ins show on the panel's Login status page.
- **Go online / offline.** Online needs a verified ID check and location access; the rider goes online straight
  away and the position follows as soon as the phone finds it (indoors, the Android app asks the API from the Wi-Fi
  networks around it). Offline isn't possible while carrying an order.
- **Live map** of the rider, the kitchen, their drop points (numbered) and orders on offer nearby.
- **Orders:** the ones the kitchen assigned to them (a chime and vibration when one arrives), and, when the admin
  panel allows self-assign, any new order they can **accept** themselves (up to `MAX_ACTIVE_ORDERS` at a
  time). Two riders can't take the same order. Before pickup an order can be **handed back**.
- **Order screen:** road route and time to the next stop (kitchen, then customer), the route driven so far, the
  customer's name, address, landmark and note, call and **Navigate** buttons (opens Google Maps), the items, and
  what to collect: "Collect ₹518 · cash or UPI" on pay-on-delivery orders. Orders paid online or from the wallet
  show no amount at all ("Paid online · nothing to collect"). Riders never see anything about the customer's
  wallet: the API sends only "Cash on delivery" with the amount to collect, or "Paid online".
- **Two stages, shown on each order:** step 1 **Pick up from kitchen** (going to the kitchen; "Picked up from
  kitchen" once the kitchen is preparing it), then step 2 **Deliver to customer** → **Delivered**. Delivering
  needs **proof at the door**, always: at least **4 camera photos** of the handover (up to 6; the order, the door
  or house number, the customer receiving it; taken with the camera, never from the gallery), then the cash
  collected on pay-on-delivery orders. A warning shows when the rider is more than 250 m from the
  customer's pin. The photos are saved to Supabase Storage (see [Delivery photos](#delivery-photos)) and listed on
  the order (`deliveryPhotos`); the website and the admin panel don't show them yet.
- **Today:** deliveries, cash collected and distance travelled; **History** for today, 7 or 30 days with average
  time and rating; **Profile** with their details, location-sharing status and help numbers.

## Live location

- While online the app follows the phone's GPS and sends a position when the rider has moved 20 m, and every
  12 s while standing still. Positions are kept while the network is down and sent together later.
- The API keeps the latest position on the agent (`agents.location`) and adds up the day's distance
  (`agents.odometer`, ignoring GPS jitter and impossible jumps). While an order is out for delivery, the latest
  position also goes on the order (`orders.riderLocation`) and each point into `riderTrack`, which draws the
  route driven on the order screen. Routes are kept for `TRACK_KEEP_DAYS` (30) days.
- A rider who went online in the app and sends nothing for `OFFLINE_AFTER_MINS` (20) minutes is set offline,
  unless they're carrying an order. Agents set online by hand in the panel are left alone.
- Location is only shared while online, and the app says so on screen.
- **Phones only track a web app while it's open on screen.** In the browser, the app keeps the screen on while
  online (Wake Lock) and tells riders to keep it open. The **Android app** (`mobile/`, see its README) shows the
  same app and keeps sharing with the screen off or another app open, with a "Sharing live location" notification,
  until the rider goes offline. It sends the same positions to the same endpoint.

Maps use **Google Maps** when `GOOGLE_MAPS_BROWSER_KEY` (or `GOOGLE_MAPS_KEY`) is set, the same keys as the
website's, with the Maps JavaScript API enabled; otherwise, or if Google refuses the key, OpenStreetMap tiles
through Leaflet (no key needed). Road routes come from an OSRM server (`ROUTING_URL`; the public demo server is
fine for trying it out, but for a real fleet host OSRM or use a paid routing service). Without routing the map
draws straight lines.

The customer sees the same live position: the website's order page shows the rider moving on a Google map while
the order is out for delivery (refreshing every 8 s).

## How data lines up with the admin panel

| Collection | This app | Notes |
|---|---|---|
| `agents` | reads; writes `status`, `location`, `odometer`, `onlineVia`, `onlineAt` | Riders are the panel's agents. `status` online / busy ("On delivery") / offline, as the panel shows it |
| `orders` | reads; writes the rider's steps | Accept = the panel's "assign"; Picked up = `out_for_delivery` + `dispatchedAt`; Delivered = `delivered` + `deliveredAt`, `deliveryMins`, `cashCollected`, `deliveredFrom`. Proof of delivery: `deliveryPhotos` ([{ url, at, agentId, agentName }]). Each step goes into `history` with `by: "<name> (delivery app)"`, which the panel's order page already lists |
| `settings` (`app`) | reads `deliverySelfAssign` | The panel's Live map switch: "Kitchen assigns" or "Riders can self-assign" (re-read every 15 s) |
| `walletTxns` | writes | Coupon cashback on delivery, exactly as the panel's "Delivered" button does |
| `sessions`, `loginEvents` | writes | `role: 'agent'`, shown on the panel's Login status page (and revocable there) |
| `agentOtpCodes`, `riderTrack` | reads/writes | This app only |

The kitchen still accepts orders (placed → preparing) and can assign, reassign, send out, deliver or cancel any
order from the panel; the app picks up those changes within 10 seconds.

## Settings (`backend/.env`)

| Setting | Default | |
|---|---|---|
| `KITCHEN_LAT`, `KITCHEN_LNG`, `KITCHEN_NAME`, `KITCHEN_ADDRESS`, `KITCHEN_PHONE` | none | The pickup point on the map and order screen |
| `SUPPORT_PHONE` | none | Profile → Call BiteVo support |
| `SELF_ASSIGN` | `true` | Self-assign until the admin panel's switch (Live map → Waiting for a rider) is first used; the switch wins after that |
| `GOOGLE_MAPS_KEY`, `GOOGLE_MAPS_BROWSER_KEY` | none | Google Maps for the app's map (else OpenStreetMap) |
| `GOOGLE_GEOLOCATION_KEY` | `GOOGLE_MAPS_KEY` | Google's Geolocation API (enable it on the key; billed per lookup): finds Android riders indoors from Wi-Fi when their GPS can't (`POST /api/rider/locate`) |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_DELIVERY_BUCKET` | none, none, `bitevo-delivery-photos` | Where delivery photos go: the admin panel's Supabase project. **Set them on the live server**; empty = this server's disk (below) |
| `MAX_ACTIVE_ORDERS` | `2` | Orders a rider can carry at once |
| `OFFLINE_AFTER_MINS` | `20` | Silence before an idle rider is set offline |
| `TRACK_KEEP_DAYS` | `30` | How long driven routes are kept |
| `ROUTING_URL` | public OSRM demo | Empty = straight lines |
| `OTP_DEV_MODE`, `MINIMOTH_API_KEY` | `true`, none | Real sign-in codes: set the website's MiniMoth key and `OTP_DEV_MODE=false` |

## Delivery photos

The photos riders take at the door go to **Supabase Storage**, in the admin panel's project: copy
`SUPABASE_URL` and `SUPABASE_SECRET_KEY` from the admin panel's `backend/.env` into this one and restart. The
public bucket `bitevo-delivery-photos` is created with the first photo; file names are random, so links can't be
guessed. Each order keeps the links in `deliveryPhotos`.

Without those two settings the photos are kept in `backend/data/photos` on this server and served at
`/photos/<file>`: fine for trying the app, but on the live server its disk is then the only copy. The API says
which it uses: at start (`Delivery photos: …`, with a warning when a MongoDB database is used without Supabase)
and in `GET /api/health` (`"photos": "supabase"` or `"server"`).

Photos kept on the server before Supabase was set up stay reachable at their old links. To move them, on the
server after setting the two values:

```bash
npm run move-photos --prefix backend
npm run move-photos --prefix backend -- --apply
```

The first is a dry run that lists them. `--apply` uploads them to the bucket and points the orders at the new
links (old links are saved in `backend/data/backups/` first; the files stay where they were). Orders still out for
delivery are left for the next run. From another machine, `-- --from https://driverapi.bitevo.in --apply` fetches
the photos from the server's old links.

## Try it on a phone

Phones only give a web page their location over HTTPS. On the same Wi-Fi as this PC:

```bash
npm run dev:phone --prefix frontend
```

This serves the app over HTTPS on the local network (Vite prints the address, e.g. `https://192.168.1.20:2003`).
The certificate is self-signed, so the phone warns once; continue to the site. The API can stay on
`127.0.0.1`, since Vite forwards `/api` to it.

## Going live

- `COOKIE_SECURE=true`, `TRUST_PROXY=true` behind a proxy, `CLIENT_ORIGIN=https://rider.bitevo.in`.
- On a host that deploys from the repo root (Node 20.19 or newer): create `backend/.env`, then `npm install`,
  `npm run build` and `npm start`. The API serves the built app too, so one address hosts both.
- If the API is on another domain: `COOKIE_SAMESITE=none`, and build the app with `VITE_API_URL=https://…`.
- Riders open the address in Chrome and use **Add to Home screen**, which installs it like an app.

## Android app

`mobile/` builds `BiteVoRider.apk` (`npm run build:android` in `mobile/`): the rider app in a WebView, plus a
foreground location service that keeps sharing the rider's position while the screen is off. Build it with the
API's address (`-AppUrl https://driverapi.bitevo.in`): live builds carry the app's screens inside the APK and
send only `/api/…` to the server, so the server needn't host the web app for them. Without `-AppUrl` it opens
the dev server as the Android emulator sees it.
Inside the app, `frontend/src/lib/tracker.js` leaves the GPS and the sending to the app (`window.BiteVoRider`), and
Profile and the location line word their tips for the app. See `mobile/README.md` for permissions and testing.

## Not built yet

- **Tracking with the screen off on iPhones:** the Android app covers Android; iPhones use the web app (screen on).
- **The rider on a map in the customer's Android app** (`../bitevomainwebsite/mobile`): the website shows it; the
  app still lists the order's steps only. The admin panel's **Live map** is still on OpenStreetMap.
- Push notifications when the app is closed (new orders chime only while it's open).
- Rider pay and earnings, and cash deposits back to the kitchen.

## Code

```
backend/src/
  server.js, app.js    start-up, security headers, route table, serves the built app
  config.js            settings from .env
  auth.js              rider sessions (shared sessions collection, role "agent")
  routes/auth.js       sign-in codes
  routes/rider.js      online/offline, live location, today's numbers
  routes/orders.js     list, accept, hand back, picked up, delivered, driven route
  lib/                 agents, order rules, stats, road routes, SMS codes
  jobs.js              idle riders → offline, old routes deleted, demo kitchen
  db/                  MongoDB store, JSON-file fallback, indexes
  demo/seed.js         demo riders and orders (JSON store only)
frontend/src/
  App.jsx, session.jsx pages, signed-in rider, tracking while online
  lib/tracker.js       GPS → API: throttling, offline queue, screen wake lock (in the Android app: hands it over)
  lib/hooks.js         polling, road route that follows the rider
  components/LiveMap   Leaflet map: rider, kitchen, drop points, route, trail
  pages/               Login, Home, Order, History, Profile
```
