// Posts positions to the API, signed in with the rider's session cookie, and says what the API answered.
// Plain Kotlin (no Android classes), so LocationSenderTest runs it against the dev API on the PC.
package com.bitevo.rider

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import kotlin.math.pow
import kotlin.math.roundToLong

// One position, in the shape POST /api/rider/location takes (and the web app's tracker keeps).
// `at` is when it was found, or when it was queued for sending (see LocationService.enqueue).
data class Point(
    val lat: Double,
    val lng: Double,
    val accuracy: Double?, // metres
    val heading: Double?, // degrees
    val speed: Double?, // m/s
    val at: Long, // epoch ms
) {
    fun toJson(): JSONObject = JSONObject()
        .put("lat", lat)
        .put("lng", lng)
        .put("accuracy", accuracy ?: JSONObject.NULL)
        .put("heading", heading ?: JSONObject.NULL)
        .put("speed", speed ?: JSONObject.NULL)
        .put("at", isoTime(at))
}

fun round(value: Double, digits: Int): Double {
    val f = 10.0.pow(digits)
    return (value * f).roundToLong() / f
}

fun isoTime(ms: Long): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    .apply { timeZone = TimeZone.getTimeZone("UTC") }
    .format(ms)

class LocationSender(private val apiUrl: String, private val userAgent: String) {
    sealed interface Result {
        // Saved. `status` is the rider's status: online, or busy while carrying an order.
        data class Sent(val status: String) : Result
        // 409 { status: 'offline' }: gone offline (on another phone, by the panel, or after a long silence). Stop.
        data class Offline(val message: String) : Result
        // 401: the session is gone (signed out, or suspended in the panel). Stop.
        data object SignedOut : Result
        // No network, or the server had a problem: keep the points and try again.
        data class Failed(val reason: String) : Result
    }

    // `cookie` is the Cookie header for the API's address (from the WebView's CookieManager on the phone).
    fun send(points: List<Point>, cookie: String?): Result {
        val body = JSONObject().put("points", JSONArray(points.map { it.toJson() })).toString().toByteArray()
        val conn = try {
            URL("$apiUrl/api/rider/location").openConnection() as HttpURLConnection
        } catch (e: IOException) {
            return Result.Failed(e.toString())
        }
        return try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15000
            conn.readTimeout = 20000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("User-Agent", userAgent)
            if (!cookie.isNullOrBlank()) conn.setRequestProperty("Cookie", cookie)
            conn.outputStream.use { it.write(body) }
            val code = conn.responseCode
            val stream = if (code < 400) conn.inputStream else conn.errorStream
            val json = runCatching { JSONObject(stream.bufferedReader().use { it.readText() }) }.getOrNull()
            when {
                code in 200..299 -> Result.Sent(json?.optString("status").orEmpty())
                code == 409 && json?.optString("status") == "offline" ->
                    Result.Offline(json.optString("error").ifBlank { "You’re offline, so your location isn’t being shared." })
                code == 401 -> Result.SignedOut
                else -> Result.Failed("HTTP $code ${json?.optString("error").orEmpty()}".trim())
            }
        } catch (e: IOException) {
            Result.Failed(e.toString())
        } finally {
            conn.disconnect()
        }
    }
}
