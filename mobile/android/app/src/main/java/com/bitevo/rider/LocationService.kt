// The foreground service that shares the rider's live location while they're online, also with the screen
// off or another app open. Android shows its "Sharing live location" notification while it runs.
//  - follows the GPS (and the network position when the GPS has had nothing for a while);
//  - queues a point whenever the rider has moved SEND_EVERY_M, and every SEND_EVERY_MS while standing still,
//    and posts them to /api/rider/location with the rider's session cookie from the WebView. Same rules as
//    the web app's tracker (frontend/src/lib/tracker.js), which leaves the sending to this service in the app;
//  - keeps points while the network is down and sends them together later;
//  - holds a partial wake lock, so the sending goes on while the phone sleeps;
//  - stops when the rider goes offline in the app, or when the API answers that they're offline (409) or
//    signed out (401). If Android kills the app meanwhile, it restarts the service (START_STICKY).
package com.bitevo.rider

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import android.webkit.CookieManager
import org.json.JSONObject
import java.util.concurrent.Executors

private const val TAG = "BiteVoRider"

class LocationService : Service(), LocationListener {
    companion object {
        private const val SEND_EVERY_M = 20f
        private const val SEND_EVERY_MS = 12_000L
        private const val TICK_MS = 4_000L
        private const val RETRY_MS = 15_000L // between tries while the network is down
        private const val MAX_QUEUE = 300
        private const val BATCH = 60
        private const val GPS_EVERY_MS = 3_000L
        private const val NETWORK_EVERY_MS = 10_000L
        private const val GPS_QUIET_MS = 30_000L // network positions are used only after this long without a GPS fix
        private const val FRESH_MS = 2 * 60_000L // a position found before going online is sent if it's this recent
        private const val WAKE_MS = 10 * 60_000L // renewed on every tick, so it lapses by itself if the service hangs
        private const val SHARING_ID = 1
        private const val STOPPED_ID = 2
        private const val CHANNEL_LIVE = "live-location"
        private const val CHANNEL_ALERTS = "alerts"

        // Only from the screen: Android doesn't let an app start sharing location from the background.
        fun start(context: Context): Boolean = try {
            val intent = Intent(context, LocationService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
            true
        } catch (e: RuntimeException) {
            Log.w(TAG, "Couldn't start location sharing", e)
            false
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, LocationService::class.java))
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private val network = Executors.newSingleThreadExecutor()
    private lateinit var locations: LocationManager
    private lateinit var apiUrl: String
    private lateinit var sender: LocationSender
    private var wakeLock: PowerManager.WakeLock? = null
    private var alive = true

    private val queue = ArrayDeque<Point>()
    private var lastQueued: Point? = null
    private var lastQueuedAt = 0L // elapsedRealtime
    private var lastGpsAt: Long? = null
    private var sending = false
    private var lastTryAt = 0L
    private var notificationText: String? = null

    private fun elapsed() = SystemClock.elapsedRealtime()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        locations = getSystemService(LOCATION_SERVICE) as LocationManager
        apiUrl = Server.apiUrl(this)
        sender = LocationSender(apiUrl, "BiteVoRider/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE})")
        createChannels()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Foreground first, always: Android ends an app whose service was started this way and didn't.
        if (!goForeground() || !LocationAccess.hasLocation(this)) {
            if (!Tracker.onScreen) show(STOPPED_ID, alert(getString(R.string.cant_start)))
            stopSelf()
            return START_NOT_STICKY
        }
        if (!Tracker.running) begin()
        return START_STICKY
    }

    @SuppressLint("MissingPermission") // checked in onStartCommand
    private fun begin() {
        Tracker.running = true
        Tracker.position = Tracker.position?.takeIf { System.currentTimeMillis() - it.at < FRESH_MS }
        wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BiteVoRider:location")
            .apply { setReferenceCounted(false) }
        for ((provider, every) in listOf(LocationManager.GPS_PROVIDER to GPS_EVERY_MS, LocationManager.NETWORK_PROVIDER to NETWORK_EVERY_MS)) {
            if (provider !in locations.allProviders) continue
            try {
                locations.requestLocationUpdates(provider, every, 0f, this, Looper.getMainLooper())
            } catch (e: RuntimeException) {
                Log.w(TAG, "No $provider positions", e)
            }
        }
        checkLocationOn()
        handler.post(tick) // sends the position found while going online right away
    }

    override fun onDestroy() {
        alive = false
        handler.removeCallbacks(tick)
        runCatching { locations.removeUpdates(this) }
        wakeLock?.takeIf { it.isHeld }?.release()
        network.shutdown()
        queue.clear()
        Tracker.stopped()
        super.onDestroy()
    }

    // Every few seconds. Standing still, the GPS may stay quiet: send the last position again now and then.
    private val tick = object : Runnable {
        override fun run() {
            wakeLock?.acquire(WAKE_MS)
            val p = Tracker.position
            if (p != null && (lastQueued == null || elapsed() - lastQueuedAt >= SEND_EVERY_MS)) enqueue(p)
            flush()
            handler.postDelayed(this, TICK_MS)
        }
    }

    override fun onLocationChanged(location: Location) {
        val now = elapsed()
        if (location.provider == LocationManager.GPS_PROVIDER) lastGpsAt = now
        else if (lastGpsAt?.let { now - it < GPS_QUIET_MS } == true) return // the GPS is doing better
        val p = location.toPoint()
        Tracker.position = p
        val last = lastQueued
        if (last == null || distanceM(last, p) >= SEND_EVERY_M || now - lastQueuedAt >= SEND_EVERY_MS) {
            enqueue(p)
            flush()
        }
        Tracker.changed()
    }

    override fun onProviderEnabled(provider: String) = checkLocationOn()

    override fun onProviderDisabled(provider: String) = checkLocationOn()

    @Deprecated("Called below Android 10, where it has no default yet")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}

    private fun checkLocationOn() {
        val on = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .any { runCatching { locations.isProviderEnabled(it) }.getOrDefault(false) }
        Tracker.gpsProblem = if (on) null else getString(R.string.sharing_location_off)
        updateNotification()
        Tracker.changed()
    }

    private fun distanceM(a: Point, b: Point): Float {
        val result = FloatArray(1)
        Location.distanceBetween(a.lat, a.lng, b.lat, b.lng, result)
        return result[0]
    }

    private fun enqueue(p: Point) {
        // Stamped with the time it's queued, so a position sent again still counts as fresh (as in the web app).
        queue.addLast(p.copy(at = System.currentTimeMillis()))
        while (queue.size > MAX_QUEUE) queue.removeFirst()
        lastQueued = p
        lastQueuedAt = elapsed()
        Tracker.queued = queue.size
    }

    private fun flush() {
        if (sending || queue.isEmpty() || !Tracker.running) return
        if (Tracker.networkProblem && elapsed() - lastTryAt < RETRY_MS) return
        sending = true
        lastTryAt = elapsed()
        val batch = queue.take(BATCH)
        // The session cookie the web app signed in with (httpOnly, so only native code can read it).
        val cookie = runCatching { CookieManager.getInstance().getCookie(apiUrl) }.getOrNull()
        network.execute {
            val result = sender.send(batch, cookie)
            handler.post { sent(batch, result) }
        }
    }

    private fun sent(batch: List<Point>, result: LocationSender.Result) {
        sending = false
        if (!alive) return
        when (result) {
            is LocationSender.Result.Sent -> {
                queue.removeAll { p -> batch.any { it === p } }
                Tracker.lastSentAt = System.currentTimeMillis()
                Tracker.networkProblem = false
                Tracker.queued = queue.size
                if (queue.isNotEmpty()) flush()
            }
            is LocationSender.Result.Offline -> return finish(result.message, JSONObject().put("offline", result.message))
            LocationSender.Result.SignedOut -> return finish(getString(R.string.signed_out), JSONObject().put("signedOut", true))
            is LocationSender.Result.Failed -> {
                Log.i(TAG, "Positions not sent: ${result.reason}")
                Tracker.networkProblem = true
            }
        }
        updateNotification()
        Tracker.changed()
    }

    // The API says sharing is over. The rider hears it from the web app, or from a notification when the
    // app isn't on screen.
    private fun finish(message: String, event: JSONObject) {
        if (!Tracker.onScreen) show(STOPPED_ID, alert(message))
        Tracker.tell(event)
        stopSelf()
    }

    private fun goForeground(): Boolean = try {
        if (Build.VERSION.SDK_INT >= 29) startForeground(SHARING_ID, sharing(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        else startForeground(SHARING_ID, sharing())
        true
    } catch (e: RuntimeException) {
        Log.w(TAG, "Couldn't start as a foreground service", e)
        false
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_LIVE, getString(R.string.channel_live), NotificationManager.IMPORTANCE_LOW).apply {
                description = getString(R.string.channel_live_about)
                setShowBadge(false)
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ALERTS, getString(R.string.channel_alerts), NotificationManager.IMPORTANCE_HIGH).apply {
                description = getString(R.string.channel_alerts_about)
            },
        )
    }

    private fun builder(channel: String): Notification.Builder {
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, channel) else Notification.Builder(this)
        return builder
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(getColor(R.color.brand))
            .setContentIntent(open)
    }

    private fun sharingText(): String = Tracker.gpsProblem
        ?: if (Tracker.networkProblem) getString(R.string.sharing_waiting, queue.size) else getString(R.string.sharing_text)

    private fun sharing(): Notification {
        val text = sharingText()
        notificationText = text
        return builder(CHANNEL_LIVE)
            .setContentTitle(getString(R.string.sharing_title))
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_SERVICE)
            .apply { if (Build.VERSION.SDK_INT >= 31) setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE) }
            .build()
    }

    private fun updateNotification() {
        if (Tracker.running && sharingText() != notificationText) show(SHARING_ID, sharing())
    }

    private fun alert(message: String): Notification = builder(CHANNEL_ALERTS)
        .setContentTitle(getString(R.string.stopped_title))
        .setContentText(message)
        .setStyle(Notification.BigTextStyle().bigText(message))
        .setAutoCancel(true)
        .build()

    // Without the notifications permission (Android 13+) the service still runs; Android just hides the notification.
    private fun show(id: Int, notification: Notification) {
        runCatching { getSystemService(NotificationManager::class.java).notify(id, notification) }
    }
}
