// What the location service is doing, for the screen. MainActivity passes each change on to the web app as
// a `bitevo-rider` event with the same fields the web tracker keeps (frontend/src/lib/tracker.js).
// Main thread only.
package com.bitevo.rider

import android.location.Location
import org.json.JSONObject

object Tracker {
    var running = false
    var position: Point? = null
    var gpsProblem: String? = null
    var lastSentAt: Long? = null // epoch ms
    var queued = 0
    var networkProblem = false
    var onScreen = false // MainActivity is visible

    // MainActivity, while it exists.
    var listener: ((JSONObject) -> Unit)? = null

    fun state(): JSONObject = JSONObject()
        .put("position", position?.toJson() ?: JSONObject.NULL)
        .put("gpsProblem", gpsProblem ?: JSONObject.NULL)
        .put("lastSentAt", lastSentAt ?: JSONObject.NULL)
        .put("queued", queued)
        .put("networkProblem", networkProblem)

    fun changed() {
        listener?.invoke(state())
    }

    // A one-off message for the web app: { offline: message }, { signedOut: true }, { position }, { locationError }.
    fun tell(event: JSONObject) {
        listener?.invoke(event)
    }

    fun stopped() {
        running = false
        gpsProblem = null
        lastSentAt = null
        queued = 0
        networkProblem = false
        changed()
    }
}

// Rounded like the web tracker does.
fun Location.toPoint() = Point(
    lat = round(latitude, 6),
    lng = round(longitude, 6),
    accuracy = if (hasAccuracy()) round(accuracy.toDouble(), 1) else null,
    heading = if (hasBearing()) round(bearing.toDouble(), 0) else null,
    speed = if (hasSpeed()) round(speed.toDouble(), 1) else null,
    at = time.takeIf { it > 0 } ?: System.currentTimeMillis(),
)
