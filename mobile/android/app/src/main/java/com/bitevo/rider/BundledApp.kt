// The rider web app's screens inside the APK (assets/web, built from frontend/ by scripts/build-android.ps1),
// for builds for an https address. The WebView opens that address as usual, but every page and file of the app
// comes from here; only /api/… (and /photos/…, delivery photos the API keeps itself) go to the server. So:
//  - the server only has to run the API; it doesn't have to host the screens;
//  - the screens always match this APK's own side (window.BiteVoRider);
//  - the page and the API share one address, so the sign-in cookie is the app's own.
// New screens come with a new APK. Dev builds (http addresses) load the dev server instead.
package com.bitevo.rider

import android.content.res.AssetManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.IOException

object BundledApp {
    private const val DIR = "web"
    private val TYPES = mapOf(
        "html" to "text/html",
        "js" to "text/javascript",
        "mjs" to "text/javascript",
        "css" to "text/css",
        "json" to "application/json",
        "webmanifest" to "application/manifest+json",
        "png" to "image/png",
        "jpg" to "image/jpeg",
        "jpeg" to "image/jpeg",
        "webp" to "image/webp",
        "gif" to "image/gif",
        "svg" to "image/svg+xml",
        "ico" to "image/x-icon",
        "woff2" to "font/woff2",
        "woff" to "font/woff",
        "ttf" to "font/ttf",
        "mp3" to "audio/mpeg",
        "wav" to "audio/wav",
        "txt" to "text/plain",
    )

    // What the server answers: the API, and delivery photos it keeps without Supabase.
    private fun fromServer(path: String) = path == "/api" || path.startsWith("/api/") || path.startsWith("/photos/")

    // The answer to a request for the app's own address, or null to let it go to the server.
    fun answer(assets: AssetManager, request: WebResourceRequest): WebResourceResponse? {
        if (!BuildConfig.BUNDLED_WEB || request.method != "GET") return null
        val path = request.url.path?.ifEmpty { "/" } ?: "/"
        if (fromServer(path)) return null
        val name = path.trimStart('/')
        // A page of the app (/, /orders/…, /history) is its index.html, which then shows that page.
        val file = if ('.' !in name.substringAfterLast('/')) "index.html" else name
        if (file.split('/').any { it == ".." }) return notFound()
        val stream = try {
            assets.open("$DIR/$file")
        } catch (e: IOException) {
            return notFound()
        }
        val type = TYPES[file.substringAfterLast('.').lowercase()] ?: "application/octet-stream"
        val text = type.startsWith("text/") || type.endsWith("json") || type.endsWith("+xml")
        return WebResourceResponse(type, if (text) "utf-8" else null, 200, "OK", mapOf("Cache-Control" to "no-cache"), stream)
    }

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
}
