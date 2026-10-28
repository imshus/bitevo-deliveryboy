// What live location needs from Android, asked one step at a time, each after a short explanation:
// precise location (required to go online), then once each: "Allow all the time" (Android 10+),
// notifications (13+) and no battery limits. Those three make sharing sturdier with the screen off, but the
// rider can go online without them.
package com.bitevo.rider

import android.Manifest.permission.ACCESS_BACKGROUND_LOCATION
import android.Manifest.permission.ACCESS_COARSE_LOCATION
import android.Manifest.permission.ACCESS_FINE_LOCATION
import android.Manifest.permission.POST_NOTIFICATIONS
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager.PERMISSION_GRANTED
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings

class LocationAccess(private val activity: Activity) {
    companion object {
        private const val REQ_LOCATION = 1
        private const val REQ_BACKGROUND = 2
        private const val REQ_NOTIFICATIONS = 3
        private const val REQ_BATTERY = 4
        private const val ASKED_LOCATION = "askedLocation"
        private const val ASKED_BACKGROUND = "askedBackground"
        private const val ASKED_NOTIFICATIONS = "askedNotifications"
        private const val ASKED_BATTERY = "askedBattery"
        private const val FIX_WAIT_MS = 20_000L
        private const val LAST_KNOWN_MS = 2 * 60_000L

        fun hasLocation(context: Context) = context.checkSelfPermission(ACCESS_FINE_LOCATION) == PERMISSION_GRANTED
    }

    private val prefs = activity.getSharedPreferences("rider", Context.MODE_PRIVATE)
    private val waiting = mutableListOf<(String?) -> Unit>()

    // For the web app's "Permission" line: granted | denied | prompt (not asked yet).
    fun state(): String = when {
        hasLocation(activity) -> "granted"
        prefs.getBoolean(ASKED_LOCATION, false) -> "denied"
        else -> "prompt"
    }

    // Calls `then(null)` once precise location is allowed, or `then(message)` saying what's missing.
    fun ensure(then: (String?) -> Unit) {
        waiting += then
        if (waiting.size == 1) askLocation()
    }

    private fun finish(problem: String?) {
        val callbacks = waiting.toList()
        waiting.clear()
        callbacks.forEach { it(problem) }
    }

    // From MainActivity.onRequestPermissionsResult and onActivityResult: the next step.
    fun onPermissionsResult(requestCode: Int) {
        when (requestCode) {
            REQ_LOCATION -> if (hasLocation(activity)) askBackground() else blocked()
            REQ_BACKGROUND -> askNotifications()
            REQ_NOTIFICATIONS -> askBattery()
        }
    }

    fun onActivityResult(requestCode: Int) {
        if (requestCode == REQ_BATTERY) finish(null)
    }

    private fun askLocation() {
        if (!locationOn()) {
            return explain(R.string.location_off_title, text(R.string.location_off_text), R.string.open_settings, R.string.not_now) { ok ->
                if (ok) open(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
                finish(text(R.string.location_is_off))
            }
        }
        if (hasLocation(activity)) return askBackground()
        explain(R.string.ask_location_title, text(R.string.ask_location_text), R.string.continue_, R.string.not_now) { ok ->
            if (!ok) return@explain finish(text(R.string.need_location))
            prefs.edit().putBoolean(ASKED_LOCATION, true).apply()
            activity.requestPermissions(arrayOf(ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION), REQ_LOCATION)
        }
    }

    // Not allowed (or only approximate location). After a second "Don't allow" Android stops asking, and only
    // the app's settings can change it.
    private fun blocked() {
        if (activity.shouldShowRequestPermissionRationale(ACCESS_FINE_LOCATION)) return finish(text(R.string.need_location))
        explain(R.string.blocked_title, text(R.string.blocked_text, allTheTime()), R.string.open_settings, R.string.not_now) { ok ->
            if (ok) open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${activity.packageName}")))
            finish(text(R.string.need_location))
        }
    }

    // Android 11+ asks this on a settings page rather than in a dialog.
    private fun askBackground() {
        if (Build.VERSION.SDK_INT < 29 || has(ACCESS_BACKGROUND_LOCATION) || askedBefore(ASKED_BACKGROUND)) return askNotifications()
        val ok = if (Build.VERSION.SDK_INT >= 30) R.string.open_settings else R.string.continue_
        explain(R.string.ask_background_title, text(R.string.ask_background_text, allTheTime()), ok, R.string.skip) { yes ->
            if (yes) activity.requestPermissions(arrayOf(ACCESS_BACKGROUND_LOCATION), REQ_BACKGROUND) else askNotifications()
        }
    }

    // For the "Sharing live location" notification (the first explanation mentions it).
    private fun askNotifications() {
        if (Build.VERSION.SDK_INT < 33 || has(POST_NOTIFICATIONS) || askedBefore(ASKED_NOTIFICATIONS)) return askBattery()
        activity.requestPermissions(arrayOf(POST_NOTIFICATIONS), REQ_NOTIFICATIONS)
    }

    @SuppressLint("BatteryLife") // tracking riders through a shift is what this exemption is for
    private fun askBattery() {
        val power = activity.getSystemService(PowerManager::class.java)
        if (power.isIgnoringBatteryOptimizations(activity.packageName) || askedBefore(ASKED_BATTERY)) return finish(null)
        explain(R.string.ask_battery_title, text(R.string.ask_battery_text), R.string.continue_, R.string.skip) { ok ->
            if (!ok) return@explain finish(null)
            try {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${activity.packageName}"))
                activity.startActivityForResult(intent, REQ_BATTERY)
            } catch (e: ActivityNotFoundException) {
                finish(null)
            }
        }
    }

    // One position for going online: the first from the GPS or the network within FIX_WAIT_MS, or else the
    // phone's last known position if it's recent. Null if there's none.
    @SuppressLint("MissingPermission") // called once location is allowed
    fun firstFix(then: (Location?) -> Unit) {
        val manager = activity.getSystemService(LocationManager::class.java)
        val handler = Handler(Looper.getMainLooper())
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .filter { runCatching { manager.isProviderEnabled(it) }.getOrDefault(false) }
        var answered = false
        lateinit var listener: LocationListener
        fun answer(location: Location?) {
            if (answered) return
            answered = true
            handler.removeCallbacksAndMessages(null)
            runCatching { manager.removeUpdates(listener) }
            then(location)
        }
        listener = object : LocationListener {
            override fun onLocationChanged(location: Location) = answer(location)
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}

            @Deprecated("Called below Android 10, where it has no default yet")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        }
        for (provider in providers) runCatching { manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper()) }
        handler.postDelayed({
            val recent = providers.mapNotNull { runCatching { manager.getLastKnownLocation(it) }.getOrNull() }
                .filter { System.currentTimeMillis() - it.time < LAST_KNOWN_MS }
                .maxByOrNull { it.time }
            answer(recent)
        }, FIX_WAIT_MS)
    }

    private fun locationOn(): Boolean {
        val manager = activity.getSystemService(LocationManager::class.java)
        return if (Build.VERSION.SDK_INT >= 28) manager.isLocationEnabled
        else listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).any { manager.isProviderEnabled(it) }
    }

    private fun has(permission: String) = activity.checkSelfPermission(permission) == PERMISSION_GRANTED

    // True if this was asked before; from now on it has been.
    private fun askedBefore(key: String): Boolean {
        if (prefs.getBoolean(key, false)) return true
        prefs.edit().putBoolean(key, true).apply()
        return false
    }

    // Android's own name for the option, in the phone's language ("Allow all the time").
    private fun allTheTime(): String =
        if (Build.VERSION.SDK_INT >= 30) activity.packageManager.backgroundPermissionOptionLabel.toString() else "Allow all the time"

    private fun text(id: Int, vararg args: Any): String = activity.getString(id, *args)

    private fun open(intent: Intent) {
        try {
            activity.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            // Nothing on this phone handles it; the message on screen still says what to do.
        }
    }

    private fun explain(title: Int, message: String, ok: Int, cancel: Int, then: (Boolean) -> Unit) {
        if (activity.isFinishing) return then(false)
        var answered = false
        val answer = { yes: Boolean ->
            if (!answered) {
                answered = true
                then(yes)
            }
        }
        AlertDialog.Builder(activity)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton(ok) { _, _ -> answer(true) }
            .setNegativeButton(cancel) { _, _ -> answer(false) }
            .setOnCancelListener { answer(false) }
            .show()
    }
}
