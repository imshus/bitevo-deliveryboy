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
to the kitchen's real position, and add riders in the admin panel (Team → Add agent, with their mobile number,
zone and vehicle; set the ID check to Verified).

## What riders can do

- **Sign in** with the mobile number the panel has for them and a 6-digit code (WhatsApp/SMS through MiniMoth,
  like the website). Numbers that aren't an agent get no code. Suspended agents can't sign in, and suspending one
  in the panel signs them out everywhere. Sign-ins show on the panel's Login status page.
- **Go online / offline.** Online needs a verified ID check and the phone's location. Offline isn't possible while
  carrying an order.
- **Live map** of the rider, the kitchen, their drop points (numbered) and orders on offer nearby.
- **Orders:** the ones the kitchen assigned to them (a chime and vibration when one arrives), and new orders in
  their zone they can **accept** themselves (`SELF_ASSIGN`, up to `MAX_ACTIVE_ORDERS` at a time). Two riders can't
  take the same order. Before pickup an order can be **handed back**.
- **Order screen:** road route and time to the next stop (kitchen, then customer), the route driven so far, the
  customer's name, address, landmark and note, call and **Navigate** buttons (opens Google Maps), the items, and
  what to collect ("Collect ₹518 in cash" or "Paid online · don't collect cash").
- **Picked up** (when the kitchen is preparing it) → **Delivered**, confirming the cash taken on cash orders. A
  warning shows when the rider is more than 250 m from the customer's pin.
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

Maps use OpenStreetMap tiles through Leaflet (no key needed) and road routes from an OSRM server
(`ROUTING_URL`; the public demo server is fine for trying it out, but for a real fleet host OSRM or use a paid
routing service). Without routing the map draws straight lines. For a bigger fleet, use a tile provider too
(`VITE_MAP_TILES` and `VITE_MAP_ATTRIBUTION` in `frontend/.env`).

## How data lines up with the admin panel

| Collection | This app | Notes |
|---|---|---|
| `agents` | reads; writes `status`, `location`, `odometer`, `onlineVia`, `onlineAt` | Riders are the panel's agents. `status` online / busy ("On delivery") / offline, as the panel shows it |
| `orders` | reads; writes the rider's steps | Accept = the panel's "assign"; Picked up = `out_for_delivery` + `dispatchedAt`; Delivered = `delivered` + `deliveredAt`, `deliveryMins`, `cashCollected`, `deliveredFrom`. Each step goes into `history` with `by: "<name> (delivery app)"`, which the panel's order page already lists |
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
| `SELF_ASSIGN` | `true` | `false`: only the panel assigns orders |
| `MAX_ACTIVE_ORDERS` | `2` | Orders a rider can carry at once |
| `OFFLINE_AFTER_MINS` | `20` | Silence before an idle rider is set offline |
| `TRACK_KEEP_DAYS` | `30` | How long driven routes are kept |
| `ROUTING_URL` | public OSRM demo | Empty = straight lines |
| `OTP_DEV_MODE`, `MINIMOTH_API_KEY` | `true`, none | Real sign-in codes: set the website's MiniMoth key and `OTP_DEV_MODE=false` |

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
address riders open (`-AppUrl https://…`); without one it opens the dev server as the Android emulator sees it.
Inside the app, `frontend/src/lib/tracker.js` leaves the GPS and the sending to the app (`window.BiteVoRider`), and
Profile and the location line word their tips for the app. See `mobile/README.md` for permissions and testing.

## Not built yet

- **Tracking with the screen off on iPhones:** the Android app covers Android; iPhones use the web app (screen on).
- **The customer seeing their rider:** positions are saved (`orders.riderLocation`), but the website's order tracking
  doesn't show the rider on a map yet. (The admin panel's **Live map** page shows every online rider.)
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
