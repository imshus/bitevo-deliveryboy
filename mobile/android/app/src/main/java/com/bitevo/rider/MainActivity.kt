// The app's one screen: the rider web app (frontend/) in a WebView, plus what a web page can't do by itself:
// asking for location access (also "Allow all the time") and running LocationService, which keeps sharing the
// live location with the screen off; the phone's camera for delivery photos; and Google's barcode scanner for
// the order's label. The page reaches it through `window.BiteVoRider` (Bridge below) and hears back through
// `bitevo-rider` events; frontend/src/lib/tracker.js and lib/proof.js handle them.
package com.bitevo.rider

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.inputmethod.EditorInfo
import android.text.InputType
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.window.OnBackInvokedDispatcher
import androidx.core.content.FileProvider
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import org.json.JSONObject
import java.io.File

private const val REQ_PHOTO = 10
private const val KEEP_PHOTOS_MS = 24 * 60 * 60_000L

class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var errorView: View
    private lateinit var access: LocationAccess
    private var loadFailed = false
    private var photoAnswer: ValueCallback<Array<Uri>>? = null // the page's file input waiting for the photo
    private var photoUri: Uri? = null
    private lateinit var appUrl: String
    private val appOrigin get() = origin(appUrl)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        appUrl = Server.appUrl(this)
        access = LocationAccess(this)
        web = WebView(this)
        errorView = errorView()
        setContentView(layout())
        setUpWebView()
        Tracker.listener = { tell(it) }
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { back() }
        }
        web.loadUrl(appUrl)
    }

    override fun onStart() {
        super.onStart()
        Tracker.onScreen = true
        web.onResume()
        web.resumeTimers()
        if (Tracker.running) tell(Tracker.state())
    }

    override fun onStop() {
        Tracker.onScreen = false
        CookieManager.getInstance().flush()
        // The page sleeps while the app isn't on screen; LocationService goes on sharing the location.
        web.onPause()
        web.pauseTimers()
        super.onStop()
    }

    override fun onDestroy() {
        Tracker.listener = null
        web.destroy()
        super.onDestroy()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        access.onPermissionsResult(requestCode)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_PHOTO) {
            val uri = photoUri.takeIf { resultCode == RESULT_OK }
            photoAnswer?.onReceiveValue(uri?.let { arrayOf(it) })
            photoAnswer = null
            photoUri = null
            return
        }
        access.onActivityResult(requestCode)
    }

    @Deprecated("Below Android 13; newer phones use the OnBackInvokedCallback above")
    override fun onBackPressed() = back()

    // Back goes back in the web app, and from its first page to the home screen (the app keeps running).
    private fun back() {
        if (web.canGoBack()) web.goBack() else moveTaskToBack(true)
    }

    // window.BiteVoRider in the page. Called on a WebView thread, so the work is handed to the main thread,
    // and only for the app's own pages.
    private inner class Bridge {
        @JavascriptInterface
        fun permission(): String = access.state()

        @JavascriptInterface
        fun askForLocation() = fromPage { this@MainActivity.askForLocation() }

        @JavascriptInterface
        fun startTracking() = fromPage { this@MainActivity.startTracking() }

        @JavascriptInterface
        fun stopTracking() = fromPage { LocationService.stop(this@MainActivity) }

        @JavascriptInterface
        fun scanBarcode() = fromPage { this@MainActivity.scanBarcode() }

        private fun fromPage(action: () -> Unit) = runOnUiThread {
            if (origin(web.url.orEmpty()) == appOrigin) action()
        }
    }

    // Going online: location access first, then one position (the page sends it with "I'm online").
    private fun askForLocation() {
        access.ensure { problem ->
            if (problem != null) return@ensure tell(JSONObject().put("locationError", problem).put("permission", access.state()))
            access.firstFix { location ->
                val p = location?.toPoint()
                if (p == null) return@firstFix tell(JSONObject().put("locationError", getString(R.string.no_fix)).put("permission", "granted"))
                Tracker.position = p
                tell(JSONObject().put("position", p.toJson()).put("permission", "granted").put("gpsProblem", JSONObject.NULL))
            }
        }
    }

    // The rider is online (just now, or still from before): start sharing, asking for access if it's missing.
    private fun startTracking() {
        CookieManager.getInstance().flush() // the session cookie, on disk for the service even after a restart
        val start = { problem: String? ->
            if (problem == null && LocationService.start(this)) tell(Tracker.state())
            else tell(Tracker.state().put("permission", access.state()).put("gpsProblem", problem ?: getString(R.string.cant_start)))
        }
        if (LocationAccess.hasLocation(this)) start(null) else access.ensure(start)
    }

    // The order's label, read by Google's scanner (from Google Play services: its own camera screen, so the app
    // needs no camera permission). Answers { barcode }, { barcodeCancelled } or { barcodeError }.
    private fun scanBarcode() {
        val options = GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_CODE_128, Barcode.FORMAT_CODE_39, Barcode.FORMAT_QR_CODE, Barcode.FORMAT_EAN_13, Barcode.FORMAT_DATA_MATRIX)
            .enableAutoZoom()
            .build()
        GmsBarcodeScanning.getClient(this, options).startScan()
            .addOnSuccessListener { tell(JSONObject().put("barcode", it.rawValue.orEmpty())) }
            .addOnCanceledListener { tell(JSONObject().put("barcodeCancelled", true)) }
            .addOnFailureListener { tell(JSONObject().put("barcodeError", getString(R.string.scan_failed))) }
    }

    // The page's "Take photo" (an <input type="file" capture>): the phone's camera app, never the gallery, so the
    // photo is taken there and then. It's saved in the app's cache (kept a day) and handed to the page.
    private fun takePhoto(answer: ValueCallback<Array<Uri>>) {
        photoAnswer?.onReceiveValue(null)
        val dir = File(cacheDir, "photos").apply { mkdirs() }
        dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > KEEP_PHOTOS_MS }?.forEach { it.delete() }
        val uri = FileProvider.getUriForFile(this, "$packageName.photos", File(dir, "photo-${System.currentTimeMillis()}.jpg"))
        val camera = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try {
            startActivityForResult(camera, REQ_PHOTO)
            photoAnswer = answer
            photoUri = uri
        } catch (e: ActivityNotFoundException) {
            answer.onReceiveValue(null)
            tell(JSONObject().put("photoError", getString(R.string.no_camera)))
        }
    }

    // To the page, as a `bitevo-rider` event.
    private fun tell(data: JSONObject) {
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('bitevo-rider', { detail: $data }))", null)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setUpWebView() {
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false // the new-order chime
            allowFileAccess = false
            allowContentAccess = false
            userAgentString = "$userAgentString BiteVoRider/${BuildConfig.VERSION_NAME}"
        }
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        // An API on another domain sets its cookie from the page's requests.
        if (origin(Server.apiUrl(this)) != appOrigin) cookies.setAcceptThirdPartyCookies(web, true)
        // Test builds (for the dev server) can be inspected from the PC's Chrome (chrome://inspect).
        if (Server.canChange) WebView.setWebContentsDebuggingEnabled(true)

        web.addJavascriptInterface(Bridge(), "BiteVoRider")
        // The page's confirm() and alert() dialogs, and its photo inputs.
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, answer: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                takePhoto(answer)
                return true
            }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (origin(request.url.toString()) == appOrigin) return false
                openOutside(request.url)
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (!loadFailed) errorView.visibility = View.GONE
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                loadFailed = true
                errorView.visibility = View.VISIBLE
            }
        }
    }

    // Phone numbers, Google Maps directions and any other site open in their own apps.
    private fun openOutside(uri: Uri) {
        val intent = when (uri.scheme) {
            "tel" -> Intent(Intent.ACTION_DIAL, uri)
            "http", "https", "mailto", "geo" -> Intent(Intent.ACTION_VIEW, uri)
            else -> return
        }
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            // No app for it on this phone.
        }
    }

    // The page between two bands the colour of the bars around it: red under the status bar, white under the
    // navigation bar (and the keyboard). Android 15+ always draws apps edge to edge, so the app handles it.
    private fun layout(): View {
        val top = View(this).apply { setBackgroundColor(getColor(R.color.brand)) }
        val bottom = View(this).apply { setBackgroundColor(getColor(R.color.page)) }
        val page = FrameLayout(this).apply {
            addView(web, MATCH_PARENT, MATCH_PARENT)
            addView(errorView, MATCH_PARENT, MATCH_PARENT)
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(getColor(R.color.page))
            addView(top, LinearLayout.LayoutParams(MATCH_PARENT, 0))
            addView(page, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
            addView(bottom, LinearLayout.LayoutParams(MATCH_PARENT, 0))
        }
        if (Build.VERSION.SDK_INT >= 30) {
            edgeToEdge()
            // Light icons on the red status bar, dark ones on the white navigation bar.
            window.insetsController?.setSystemBarsAppearance(
                WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
            )
            root.setOnApplyWindowInsetsListener { _, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                val keyboard = insets.getInsets(WindowInsets.Type.ime())
                top.layoutParams.height = bars.top
                bottom.layoutParams.height = maxOf(bars.bottom, keyboard.bottom)
                root.setPadding(bars.left, 0, bars.right, 0)
                top.requestLayout()
                bottom.requestLayout()
                WindowInsets.CONSUMED
            }
        }
        return root
    }

    @Suppress("DEPRECATION") // Android 15+ does all this by itself
    private fun edgeToEdge() {
        window.setDecorFitsSystemWindows(false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
    }

    // Shown instead of the browser's error page when the app's address can't be reached. Test builds (for an
    // http address) also let you type another address here, e.g. the PC's new Wi-Fi address.
    private fun errorView(): View {
        val dp = resources.displayMetrics.density
        val wrap = { LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT) }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding((32 * dp).toInt(), 0, (32 * dp).toInt(), 0)
            setBackgroundColor(getColor(R.color.page))
            visibility = View.GONE
            addView(TextView(context).apply {
                setText(R.string.error_title)
                textSize = 20f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(Color.rgb(31, 31, 31))
                gravity = Gravity.CENTER
            })
            addView(TextView(context).apply {
                text = getString(R.string.error_text)
                textSize = 15f
                setTextColor(Color.rgb(97, 97, 97))
                gravity = Gravity.CENTER
                setPadding(0, (8 * dp).toInt(), 0, (16 * dp).toInt())
            })
            addView(Button(context).apply {
                setText(R.string.try_again)
                setOnClickListener { open(appUrl) }
            }, wrap())
            if (!Server.canChange) return@apply
            val address = EditText(context).apply {
                setText(appUrl)
                setSingleLine()
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
                imeOptions = EditorInfo.IME_ACTION_GO
                textSize = 15f
            }
            addView(TextView(context).apply {
                setText(R.string.server_address)
                textSize = 13f
                setTextColor(Color.rgb(97, 97, 97))
                setPadding(0, (32 * dp).toInt(), 0, 0)
            }, LinearLayout.LayoutParams(MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            addView(address, LinearLayout.LayoutParams(MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            val use: () -> Unit = {
                val url = Server.change(context, address.text.toString())
                if (url == null) address.error = getString(R.string.server_address_wrong) else open(url)
            }
            address.setOnEditorActionListener { _, _, _ -> use(); true }
            addView(Button(context).apply {
                setText(R.string.server_address_use)
                setOnClickListener { use() }
            }, wrap())
        }
    }

    private fun open(url: String) {
        appUrl = url
        loadFailed = false
        web.loadUrl(url)
    }
}

// "https://rider.bitevo.in:443/x" → "https://rider.bitevo.in:443"
private fun origin(url: String): String {
    val uri = Uri.parse(url)
    return "${uri.scheme}://${uri.authority}".lowercase()
}
