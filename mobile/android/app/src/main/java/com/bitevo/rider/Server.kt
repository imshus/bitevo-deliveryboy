// Where the app lives: the address it was built for (BuildConfig.APP_URL / API_URL), or, in builds for an
// http address (the dev server), another one typed on the "Can't reach BiteVo" screen. That's for trying the app
// on a phone against a PC whose Wi-Fi address changes; builds for the live https address never change it.
package com.bitevo.rider

import android.content.Context

object Server {
    private const val KEY = "appUrl"

    val canChange = BuildConfig.APP_URL.startsWith("http:")

    fun appUrl(context: Context): String =
        (if (canChange) prefs(context).getString(KEY, null) else null) ?: BuildConfig.APP_URL

    // The API is at the app's address unless the build put it on another domain.
    fun apiUrl(context: Context): String =
        if (BuildConfig.API_URL == BuildConfig.APP_URL) appUrl(context) else BuildConfig.API_URL

    // "192.168.1.20:2003" → "http://192.168.1.20:2003". Null if it isn't an http(s) address.
    fun change(context: Context, typed: String): String? {
        var url = typed.trim().trimEnd('/')
        if (!url.contains("://")) url = "http://$url"
        if (!Regex("^https?://[^/\\s]+$", RegexOption.IGNORE_CASE).matches(url)) return null
        prefs(context).edit().putString(KEY, url).apply()
        return url
    }

    private fun prefs(context: Context) = context.getSharedPreferences("rider", Context.MODE_PRIVATE)
}
