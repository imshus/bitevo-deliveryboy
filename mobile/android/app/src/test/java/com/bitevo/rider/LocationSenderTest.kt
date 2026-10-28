// LocationSender against a running dev API with the demo data (it refuses a real database): signs the demo
// rider Suresh Yadav in, goes online, sends positions with his session cookie, and checks the answers for a
// bad session and for a rider who's offline.
//   npm run test:sender        (with the API running: npm run dev --prefix backend)
// Without a test API (-PtestApi=http://127.0.0.1:4002) only the no-server test runs.
package com.bitevo.rider

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL

class LocationSenderTest {
    private val api = System.getProperty("bitevo.testApi").orEmpty().trimEnd('/')
    private val phone = "9876500003" // Suresh Yadav, verified, no order

    @Test
    fun sendsPositionsWithTheSessionCookie() {
        assumeTrue("No test API given", api.isNotEmpty())
        assertTrue("Only runs against the demo data, and this API uses MongoDB", JSONObject(call("GET", "/api/config").body).optBoolean("demo"))

        val otp = call("POST", "/api/auth/otp", JSONObject().put("phone", phone))
        assertEquals("sign-in code: ${otp.body}", 200, otp.status)
        val verify = call("POST", "/api/auth/verify", JSONObject().put("phone", phone).put("code", JSONObject(otp.body).getString("devCode")))
        assertEquals("sign-in: ${verify.body}", 200, verify.status)
        val cookie = verify.cookie
        assertNotNull("no session cookie", cookie)
        assertEquals(200, call("POST", "/api/rider/status", JSONObject().put("online", true), cookie).status)

        val sender = LocationSender(api, "BiteVoRider test")
        val now = System.currentTimeMillis()
        val points = listOf(
            Point(28.4501, 77.0601, 8.0, 90.0, 5.2, now - 4000),
            Point(28.452, 77.0612, 6.5, null, null, now - 1000),
        )
        val sent = sender.send(points, cookie)
        assertTrue("sent: $sent", sent is LocationSender.Result.Sent && sent.status in listOf("online", "busy"))
        val location = JSONObject(call("GET", "/api/auth/me", cookie = cookie).body).getJSONObject("agent").getJSONObject("location")
        assertEquals(28.452, location.getDouble("lat"), 1e-9)
        assertEquals(77.0612, location.getDouble("lng"), 1e-9)
        assertEquals(6.5, location.getDouble("accuracy"), 1e-9)
        assertEquals(isoTime(now - 1000), location.getString("at"))

        assertEquals(LocationSender.Result.SignedOut, sender.send(points, "bitevo_rider_session=not-a-session"))
        assertEquals(LocationSender.Result.SignedOut, sender.send(points, null))

        assertEquals(200, call("POST", "/api/rider/status", JSONObject().put("online", false), cookie).status)
        val offline = sender.send(listOf(points.last().copy(at = System.currentTimeMillis())), cookie)
        assertTrue("offline: $offline", offline is LocationSender.Result.Offline && offline.message.isNotBlank())
        println("Offline answer: $offline")

        call("POST", "/api/auth/logout", cookie = cookie)
    }

    @Test
    fun keepsPointsWhenTheServerCantBeReached() {
        val result = LocationSender("http://127.0.0.1:9", "BiteVoRider test").send(listOf(Point(28.45, 77.06, null, null, null, 0)), null)
        assertTrue("$result", result is LocationSender.Result.Failed)
    }

    @Test
    fun pointsHaveTheWebTrackersShape() {
        val json = Point(28.4501234, 77.06, null, 180.0, 0.0, 1_761_400_000_123).toJson()
        assertEquals(setOf("lat", "lng", "accuracy", "heading", "speed", "at"), json.keys().asSequence().toSet())
        assertTrue(json.isNull("accuracy"))
        assertEquals("2025-10-25T13:46:40.123Z", json.getString("at"))
        assertEquals(28.450123, round(28.4501234, 6), 0.0)
    }

    private class Reply(val status: Int, val body: String, val cookie: String?)

    private fun call(method: String, path: String, body: JSONObject? = null, cookie: String? = null): Reply {
        val conn = URL(api + path).openConnection() as HttpURLConnection
        conn.requestMethod = method
        if (cookie != null) conn.setRequestProperty("Cookie", cookie)
        if (body != null) {
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
        }
        val status = conn.responseCode
        val text = runCatching { (if (status < 400) conn.inputStream else conn.errorStream).bufferedReader().use { it.readText() } }.getOrDefault("")
        val session = conn.headerFields.entries.firstOrNull { it.key.equals("Set-Cookie", ignoreCase = true) }?.value
            ?.firstOrNull { it.startsWith("bitevo_rider_session=") }?.substringBefore(';')
        conn.disconnect()
        return Reply(status, text, session)
    }
}
