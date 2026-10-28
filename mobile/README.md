# BiteVo Rider — Android app

The delivery partner app for Android phones. It shows the rider web app (`../frontend`) and adds the one thing a
web page can't do: **keep sharing the rider's live location while the screen is off or another app is open.**

From the moment a rider goes online until they go offline, the app's location service sends their position to
`POST /api/rider/location` whenever they've moved 20 m, and every 12 s while standing still, with Android's
persistent **"Sharing live location"** notification showing. The admin panel sees it exactly as it sees the web
app's positions (`agents.location`, `orders.riderLocation`, `riderTrack`).

It's a small native Android app (Kotlin, no React Native, no libraries; the APK is well under 1 MB): a WebView
for the screens, plus a foreground location service. React Native would only have wrapped the same WebView,
while the background service has to be native code either way.

## Build the APK

Needs Java 17 and the Android SDK in `D:\Android` (`jdk\`, `Sdk\`, Gradle's cache in `gradle-home\`), the same
setup as the customer app. Set `BITEVO_ANDROID_TOOLS` for another folder. There's nothing to `npm install`.

```bash
npm run build:android
```

The APK is written to `mobile\BiteVoRider.apk`. The app opens one address, set when building:

| Build | Opens |
|---|---|
| `npm run build:android` | `http://10.0.2.2:2003`: the dev server, as the **Android emulator** sees this PC |
| `npm run build:android -- -AppUrl http://192.168.1.20:2003` | the dev server from a **phone on the same Wi-Fi** (use this PC's address) |
| `npm run build:android -- -AppUrl https://rider.bitevo.in` | the **live** app |
| `... -ApiUrl https://api.example.in` | only if the API is on another domain than the app |

(`BITEVO_RIDER_URL` / `BITEVO_RIDER_API_URL` do the same as `-AppUrl` / `-ApiUrl`.)

Builds for an `http://` address are test builds: when the address can't be reached, the "Can't reach BiteVo"
screen lets you type another one (kept on the phone), and the page can be inspected from the PC's Chrome at
`chrome://inspect`. Builds for an `https://` address always use that address and allow no plain http.

The APK is signed with React Native's public debug key, like the customer app: fine for installing directly.
For the Play Store, create your own upload key (keep it and its password safe, never commit it) and use it for
`release` in `android/app/build.gradle`.

## Install

Copy `BiteVoRider.apk` to the phone and open it (allow "Install unknown apps" for the app you open it with), or
with the phone connected over USB (USB debugging on):

```bash
D:\Android\Sdk\platform-tools\adb.exe install -r BiteVoRider.apk
```

### Trying it on a phone against this PC

The phone needs to reach the web app on this PC over the Wi-Fi, over plain http (the app gives the page the
location itself, so the https that phone browsers need isn't needed here):

```bash
npm start --prefix backend
npm run dev --prefix frontend -- --host
```

(`npm start` rather than `npm run dev` for the API: on this PC the dev script's `node --watch` kept restarting the
API, which loses sign-in codes it has just sent.) Vite prints the address (e.g. `http://192.168.1.20:2003`); build with `-AppUrl` set to it, or type it on the app's
"Can't reach BiteVo" screen. Windows may ask once whether Node.js may accept connections on private networks:
allow it. The API itself stays on `127.0.0.1`; Vite forwards `/api` to it.

**Going live** works like the web app's "Going live" section in the main README: the API serves the built web app
on one https address, with `COOKIE_SECURE=true`. Build the APK with `-AppUrl` set to that address.

## Permissions

Asked when the rider first goes online, one at a time, each after a short explanation in the app:

| Permission | Why | Needed? |
|---|---|---|
| Location, **precise** | the position itself | Yes: without it the rider can't go online |
| Location **"Allow all the time"** (Android 10+) | keeps sharing if Android restarts the app in the background | No, asked once. Sharing with the screen off works without it, because it runs as a foreground service started from the screen |
| Notifications (Android 13+) | the "Sharing live location" notification, and "Location sharing stopped" | No, asked once. Without it the service still runs, but the notification is hidden |
| No battery restrictions | stops battery saving from cutting location off | No, asked once |

Proof of delivery needs no extra permission: **photos** are taken with the phone's own camera app (never picked from
the gallery) and saved in the app's cache for a day; the **order label's barcode** is read by Google's code scanner
from Google Play services, which shows its own camera screen (the phone needs Google Play services, as nearly all
Android phones in India have).

Riders can change them later in Settings → Apps → BiteVo Rider. Many phones (Xiaomi, Oppo, Vivo, Realme,
OnePlus, Samsung) also stop background apps on their own: set Battery to **Unrestricted** / **No restrictions**,
turn on **Autostart** where there is one, and on Samsung don't put the app in "Sleeping apps"
([dontkillmyapp.com](https://dontkillmyapp.com) has each brand's steps).

## How it works

- **The page and the app.** The app gives the web page `window.BiteVoRider`. The web tracker
  (`frontend/src/lib/tracker.js`) sees it and, instead of following the GPS itself, asks the app to:
  `askForLocation()` (permissions, then one position, when going online), `startTracking()` while the rider is
  online (also right after the app opens if they still are), `stopTracking()` when they go offline or sign out,
  and `permission()`. The app answers with `bitevo-rider` events that carry the tracker's own fields (position,
  last sent, positions waiting, network or GPS problem), so the page shows the same "Live location shared · ±8 m ·
  3 s ago" line as on the web.
- **The location service** (`LocationService.kt`) is an Android foreground service of type `location`. It
  follows the GPS (the network position when the GPS has had nothing for 30 s), queues a point every 20 m and every
  12 s, posts up to 60 at a time, keeps up to 300 while the network is down, and holds a partial wake lock so
  sending goes on while the phone sleeps. Points are stamped when queued, like the web tracker does.
- **Signed in as the rider.** The session cookie `bitevo_rider_session` is httpOnly, so the page can't read it,
  but the app can: the service reads it from the WebView's cookie store (`CookieManager`) and sends it as the
  `Cookie` header. Signing out or in again in the web app changes what the service sends.
- **Stopping.** The service stops when the page says the rider went offline, or when the API answers `409
  { status: 'offline' }` (gone offline on another phone, set offline in the panel, or for sending nothing for
  20 minutes) or `401` (signed out, or suspended in the panel). Then the page shows the API's message, or, when
  the app isn't on screen, Android shows a "Location sharing stopped" notification.
- **If Android kills the app**, it restarts the service, which carries on until the API says the rider is
  offline. After the phone restarts, sharing begins again when the rider opens the app.
- **At the door** the page's "Take photo" opens the camera app (`onShowFileChooser` → `ACTION_IMAGE_CAPTURE`, the
  photo saved through a `FileProvider`), and "Scan barcode" calls `window.BiteVoRider.scanBarcode()`, which opens
  Google's scanner and answers with a `bitevo-rider` event `{ barcode }` (or `{ barcodeCancelled }` /
  `{ barcodeError }`). The API checks the barcode against the order.
- The page sleeps while the app isn't on screen (it doesn't poll for orders then; the service keeps sharing).
  Back goes back in the web app, and from its home screen leaves the app running. Phone numbers and Google Maps
  directions open in the phone's own apps.

## Testing background tracking

On a real phone (an emulator can't show what battery saving does):

1. Build for an address the phone can reach (above), install, sign in (demo rider Ravi Kumar, 98765 00001; the
   code is on screen in dev mode) and go online. Allow precise location; try both answers for "Allow all the time".
2. Check that "Sharing live location" is in the notifications and Profile says "With the screen off: Keeps sharing".
3. Lock the phone and put it away for 10–15 minutes, ideally walking or riding around.
4. Meanwhile watch the positions arrive: the API's data (`backend/data/db.json`, the agent's `location.at`) or
   the admin panel. With an order picked up, the order's driven route grows too.
5. Unlock: the line under the switch should say "just now", and History/Today should show the distance.
6. Go offline: the notification goes away and positions stop. Also try: switch the phone to flight mode for a few
   minutes (positions are sent together afterwards), turn Location off (the notification says so), and set the
   rider offline from the panel while the screen is off ("Location sharing stopped" appears within ~12 s).

Useful while it's connected over USB:

```bash
D:\Android\Sdk\platform-tools\adb.exe logcat -s BiteVoRider
D:\Android\Sdk\platform-tools\adb.exe shell dumpsys activity services in.bitevo.rider
D:\Android\Sdk\platform-tools\adb.exe shell dumpsys deviceidle force-idle
```

The last one puts the phone in Doze (deep sleep) at once; positions should keep arriving
(`adb shell dumpsys deviceidle unforce` ends it).

### The sending code without a phone

`npm run test:sender` runs the service's sending code (`LocationSender.kt`) on this PC against the dev API on
`127.0.0.1:4002` (start it first; it refuses an API that uses MongoDB). It signs in the demo rider Suresh Yadav,
goes online, sends positions with his session cookie, checks they're saved, and checks the answers for a wrong
session (401) and for an offline rider (409). Sign-in codes are limited to one per 30 s and five an hour per
number, so don't run it back to back.

## Code

```
scripts/build-android.ps1   the build (Java, SDK and Gradle cache from D:\Android), the -AppUrl option
android/app/build.gradle    app ID in.bitevo.rider, Android 7+, the address baked in (appUrl / apiUrl)
android/app/src/main/
  AndroidManifest.xml       permissions, the location service
  java/com/bitevo/rider/
    MainActivity.kt         the WebView, window.BiteVoRider, edge-to-edge bars, back button, "Can't reach" screen
    LocationAccess.kt       asking for permissions, step by step; one position for going online
    LocationService.kt      the foreground service: GPS, queue, sending, notifications
    LocationSender.kt       one POST to /api/rider/location and what the answer means (plain Kotlin)
    Tracker.kt              the service's state, passed on to the page
    Server.kt               the address: the built one, or the one typed on the phone (test builds)
android/app/src/test/       LocationSenderTest (npm run test:sender)
```
