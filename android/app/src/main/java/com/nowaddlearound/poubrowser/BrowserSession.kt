package com.nowaddlearound.poubrowser

import android.content.Context
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebViewDatabase
import androidx.webkit.ScriptHandler
import androidx.webkit.WebStorageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import okhttp3.HttpUrl
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.concurrent.ConcurrentHashMap

internal class BrowserSession(
    private val context: Context,
    private val blocker: TrackerBlocker,
    private val events: Events,
) {
    interface Events {
        fun pageChanged()
        fun notice(text: String, destination: HttpUrl? = null)
        fun showFullscreen(view: View, callback: WebChromeClient.CustomViewCallback)
        fun hideFullscreen()
    }

    enum class WipeResult { COMPLETE, PARTIAL, SAVE_FAILED }

    class Tab internal constructor(
        address: HttpUrl? = null,
        var title: String = "",
        var scroll: Int = 0,
    ) {
        @Volatile var address = address
        val host get() = address?.host?.removePrefix("www.")
        val label get() = title.ifBlank { host ?: L("Neuer Tab", "New tab") }

        var preview: ByteArray? = null
        var progress = 100
        var webView: WebView? = null
            internal set
        internal var history: Bundle? = null
        @Volatile internal var committed: HttpUrl? = null
        internal var pendingScroll: Int? = null
        internal var trustedChain = false
        internal var crashed = false
        internal var started = false
        /** The link or form the finger last touched, as the page script reported it. */
        internal var tapped: HttpUrl? = null
        internal var tappedForm = false
        internal var tappedAt = 0L

        /** The page the tab is loading or showing: what its requests are judged against. */
        @Volatile internal var requested: HttpUrl? = null
        /** Scripts installed for the page in front, and what they were built for. */
        internal val pageScripts = ArrayList<ScriptHandler>()
        internal var scriptsFor: String? = null
        internal val frames: MutableSet<String> = ConcurrentHashMap.newKeySet()

        internal fun freshTap() = tapped?.takeIf { SystemClock.uptimeMillis() - tappedAt < 3000 }
    }

    private val preferences = context.getSharedPreferences("browser", Context.MODE_PRIVATE)
    private val roster = restoreTabs()
    private val recent = mutableListOf<Tab>()
    private val diagnostics = ArrayDeque<String>()
    private val browserScript = readAsset("browser.js")
    private val captionScript = readAsset("captions.js")
    private val documentStart = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
    // With both, the page script reports tapped links. Older WebViews fall back to "any touch counts".
    private val tapReports = documentStart && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
    private val scriptlessSites = preferences.getStringSet("scriptless", emptySet()).orEmpty().toMutableSet()
    // Sites where the user switched the ad blocker off because the site refuses to work with one.
    // Popups and forced redirects stay blocked there.
    private val unfilteredSites: MutableSet<String> =
        ConcurrentHashMap.newKeySet<String>().apply { addAll(preferences.getStringSet("unfiltered", emptySet()).orEmpty()) }

    val tabs: List<Tab> get() = roster
    var current = roster[preferences.getInt("current", 0).coerceIn(roster.indices)]
        private set
    val activeView get() = current.webView ?: makeWebView(current)
    val log get() = diagnostics.joinToString("\n")
    val supportsFullWipe get() = WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)
    /** Repaints web pages in dark colours with the Dark Reader library. */
    var darkPages = preferences.getBoolean("dark", false)
        set(value) {
            field = value
            preferences.edit().putBoolean("dark", value).apply()
            reload()
        }
    var pipEnabled = preferences.getBoolean("pip", true)
        set(value) {
            field = value
            preferences.edit().putBoolean("pip", value).apply()
        }

    init {
        recent.add(current)
    }

    fun select(tab: Tab) {
        if (tab !in roster) return
        if (current !== tab) {
            remember(current)
            current.webView?.onPause()
            current = tab
        }
        recent.remove(tab)
        recent.add(0, tab)
        activeView.onResume()
        recent.drop(3).forEach(::park)
        save()
        events.pageChanged()
    }

    fun newTab() = select(Tab().also(roster::add))

    fun close(tab: Tab) {
        val index = roster.indexOf(tab)
        if (index < 0) return
        roster.removeAt(index)
        recent.remove(tab)
        dispose(tab)
        if (roster.isEmpty()) roster.add(Tab())
        if (current === tab) select(roster[index.coerceAtMost(roster.lastIndex)])
        else {
            save()
            events.pageChanged()
        }
    }

    fun openInput(value: String) {
        val address = BrowserPolicy.destination(value)
        if (address != null) open(address)
        else if (value.isNotBlank()) events.notice(L("Ungültige Webadresse", "Not a web address"))
    }

    fun open(url: HttpUrl) {
        current.crashed = false
        load(current, activeView, url)
    }

    fun reload() {
        val url = current.address ?: return
        if (current.crashed || activeView.url == null) open(url)
        else {
            current.trustedChain = true
            prepare(current, activeView, url)
            activeView.reload()
        }
    }

    fun goBack(): Boolean {
        if (!activeView.canGoBack()) return false
        goHistory(-1)
        return true
    }

    fun goHistory(offset: Int) {
        val view = activeView
        val entries = view.copyBackForwardList()
        val position = entries.currentIndex + offset
        if (position !in 0 until entries.size) return
        val url = BrowserPolicy.webUrl(entries.getItemAtIndex(position).url) ?: return
        current.trustedChain = true
        prepare(current, view, url)
        view.goBackOrForward(offset)
    }

    fun scriptsAllowed(url: HttpUrl?): Boolean = url == null || BrowserPolicy.site(url) !in scriptlessSites

    fun filteringAllowed(url: HttpUrl?): Boolean = url == null || BrowserPolicy.site(url) !in unfilteredSites

    fun toggleFiltering() {
        val url = current.address ?: return
        val site = BrowserPolicy.site(url)
        if (!unfilteredSites.add(site)) unfilteredSites.remove(site)
        preferences.edit().putStringSet("unfiltered", unfilteredSites.toSet()).apply()
        reload()
    }

    fun toggleScripts() {
        val url = current.address ?: return
        val site = BrowserPolicy.site(url)
        if (!scriptlessSites.add(site)) scriptlessSites.remove(site)
        preferences.edit().putStringSet("scriptless", scriptlessSites.toSet()).apply()
        for (tab in roster) {
            if (tab === current || tab.address?.let(BrowserPolicy::site) != site) continue
            remember(tab)
            tab.history = null
            dispose(tab)
        }
        reload()
    }

    fun save() {
        remember(current)
        val saved = JSONArray()
        for (tab in roster) {
            saved.put(JSONObject().apply {
                put("url", tab.address?.toString().orEmpty())
                put("title", tab.title.take(250))
                put("scroll", tab.scroll)
            })
        }
        preferences.edit().putString("tabs", saved.toString()).putInt("current", roster.indexOf(current)).apply()
    }

    fun trim() {
        for (tab in roster) {
            tab.preview = null
            if (tab !== current) park(tab)
        }
    }

    fun wipe(onComplete: (WipeResult) -> Unit) {
        activeView.clearCache(true)
        roster.forEach(::dispose)
        diagnostics.clear()
        recent.clear()
        roster.clear()
        current = Tab()
        roster.add(current)
        recent.add(current)
        val tabsCleared = preferences.edit().remove("tabs").remove("current").commit()
        GeolocationPermissions.getInstance().clearAll()
        WebViewDatabase.getInstance(context).clearHttpAuthUsernamePassword()
        val storage = WebStorage.getInstance()
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)) {
            WebStorageCompat.deleteBrowsingData(storage) {
                onComplete(if (tabsCleared) WipeResult.COMPLETE else WipeResult.SAVE_FAILED)
            }
        } else {
            storage.deleteAllData()
            val cookies = CookieManager.getInstance()
            cookies.removeAllCookies {
                cookies.flush()
                onComplete(if (tabsCleared) WipeResult.PARTIAL else WipeResult.SAVE_FAILED)
            }
        }
    }

    fun destroy() = roster.forEach(::dispose)

    private fun restoreTabs(): MutableList<Tab> {
        val restored = runCatching {
            val saved = JSONArray(preferences.getString("tabs", "[]"))
            (0 until saved.length()).mapNotNull { index ->
                val row = saved.optJSONObject(index) ?: return@mapNotNull null
                Tab(
                    BrowserPolicy.webUrl(row.optString("url")),
                    row.optString("title").take(250),
                    row.optInt("scroll").coerceAtLeast(0),
                )
            }.toMutableList()
        }.getOrDefault(mutableListOf())
        if (restored.isEmpty()) restored.add(Tab())
        return restored
    }

    private fun readAsset(name: String) = context.assets.open(name).bufferedReader().use { it.readText() }

    private fun makeWebView(tab: Tab): WebView {
        val view = WebView(context)
        tab.webView = view
        view.settings.apply {
            javaScriptEnabled = scriptsAllowed(tab.address)
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(true)
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            mediaPlaybackRequiresUserGesture = true
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)
        if (tapReports) {
            WebViewCompat.addWebMessageListener(view, "pouTap", setOf("*")) { _, message, _, _, _ ->
                val data = runCatching { JSONObject(message.data.orEmpty()) }.getOrNull() ?: return@addWebMessageListener
                if (data.has("popup")) {
                    if (tab === current) {
                        record("Popup blockiert")
                        events.notice(L("Popup blockiert", "Popup blocked"), BrowserPolicy.webUrl(data.optString("popup")))
                    }
                    return@addWebMessageListener
                }
                tab.tapped = BrowserPolicy.webUrl(data.optString("url"))
                tab.tappedForm = data.optBoolean("form")
                tab.tappedAt = SystemClock.uptimeMillis()
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(view, browserScript, setOf("*"))
            WebViewCompat.addDocumentStartJavaScript(
                view, captionScript, setOf("https://krussdomi.com", "https://*.krussdomi.com"),
            )
        }
        view.webViewClient = NavigationClient(tab)
        view.webChromeClient = ChromeClient(tab)
        view.setDownloadListener { _, _, _, _, _ -> events.notice(L("Dateidownload blockiert", "File download blocked")) }
        tab.pendingScroll = tab.scroll.takeIf { it > 0 }
        val saved = tab.history
        tab.history = null
        // Not before the ad blocker has read its lists: otherwise the page open at launch loads unfiltered.
        tab.started = false
        blocker.whenReady {
            view.post {
                // `started`: the user already sent this view somewhere else while it waited.
                if (tab.webView !== view || tab.crashed || tab.started) return@post
                val address = tab.address ?: return@post
                prepare(tab, view, address)
                if (saved == null || view.restoreState(saved) == null) load(tab, view, address)
            }
        }
        return view
    }

    private fun load(tab: Tab, view: WebView, url: HttpUrl) {
        rememberAddress(tab, url)
        tab.trustedChain = true
        tab.started = true
        prepare(tab, view, url)
        view.loadUrl(url.toString())
        changed(tab)
        save()
    }

    private fun configureScripts(view: WebView, url: HttpUrl) {
        view.settings.javaScriptEnabled = scriptsAllowed(url)
    }

    /**
     * Gets the view ready for a page before it loads: the JavaScript switch, and the scripts that must
     * run ahead of the page's own (dark colours, hidden ad areas, scriptlets). They are swapped only
     * when the site, a switch or the rules changed.
     */
    private fun prepare(tab: Tab, view: WebView, url: HttpUrl) {
        configureScripts(view, url)
        tab.requested = url
        if (!documentStart) return
        val filtered = filteringAllowed(url)
        val wanted = TrackerBlocker.origin(url) + "|" + filtered + "|" + darkPages + "|" + blocker.version
        if (wanted == tab.scriptsFor) return
        tab.scriptsFor = wanted
        tab.pageScripts.forEach(ScriptHandler::remove)
        tab.pageScripts.clear()
        tab.frames.clear()
        if (darkPages) tab.pageScripts.add(WebViewCompat.addDocumentStartJavaScript(view, blocker.darkScript, setOf("*")))
        if (filtered) for ((script, origins) in blocker.pageScripts(url)) {
            runCatching { WebViewCompat.addDocumentStartJavaScript(view, script, origins) }.getOrNull()?.let(tab.pageScripts::add)
        }
    }

    private fun rememberAddress(tab: Tab, url: HttpUrl) {
        if (tab.address == url) return
        tab.address = url
        tab.title = ""
        tab.preview = null
        tab.scroll = 0
        tab.pendingScroll = null
    }

    private fun remember(tab: Tab) {
        if (tab.pendingScroll == null) tab.webView?.let { tab.scroll = it.scrollY }
    }

    private fun restorePosition(tab: Tab, view: WebView, url: HttpUrl, target: Int, previous: Int, attempts: Int) {
        if (tab.webView !== view || tab.address != url || tab.pendingScroll != target) return
        val moved = view.scrollY != previous
        if (!moved) view.scrollTo(0, target)
        val now = view.scrollY
        if (moved || now >= target - 2 || attempts == 1) {
            tab.pendingScroll = null
            tab.scroll = now
            save()
        } else view.postDelayed({ restorePosition(tab, view, url, target, now, attempts - 1) }, 250)
    }

    private fun park(tab: Tab) {
        val view = tab.webView ?: return
        remember(tab)
        val state = Bundle()
        if (view.saveState(state) != null) tab.history = state
        dispose(tab)
    }

    private fun dispose(tab: Tab) {
        val view = tab.webView ?: return
        tab.webView = null
        tab.pageScripts.clear()
        tab.scriptsFor = null
        (view.parent as? ViewGroup)?.removeView(view)
        view.destroy()
    }

    private fun changed(tab: Tab) {
        if (tab === current) events.pageChanged()
    }

    private fun record(message: String) {
        if (diagnostics.size == 200) diagnostics.removeFirst()
        diagnostics.addLast(message)
    }

    private inner class NavigationClient(private val tab: Tab) : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame && request.url.toString() == "about:blank") return false
            val url = BrowserPolicy.webUrl(request.url.toString())
            if (url == null) {
                if (request.isForMainFrame && tab === current) {
                    record("App-Weiterleitung blockiert")
                    events.notice(L("App-Weiterleitung blockiert", "App redirect blocked"))
                }
                return true
            }
            if (!request.isForMainFrame) return false
            val from = tab.committed ?: tab.address
            // A touch alone is no proof: ad scripts send the tab away from inside the tap handler. Where the
            // page script can report it, the navigation must go to the link or form that was touched.
            val hasGesture = request.hasGesture() && tab === current && view.hasWindowFocus() &&
                (!tapReports || !scriptsAllowed(from) ||
                    tab.freshTap()?.let { BrowserPolicy.sameTarget(it, url, tab.tappedForm) } == true)
            if (!BrowserPolicy.allowsNavigation(from, url, hasGesture, request.isRedirect, tab.trustedChain)) {
                if (tab === current) {
                    record("Weiterleitung blockiert · " + url.host)
                    events.notice(L("Weiterleitung blockiert · ", "Redirect blocked · ") + url.host, url)
                }
                return true
            }
            if (filteringAllowed(from) && blocker.blocksPage(url, from)) {
                if (tab === current) {
                    record("Von Filterliste blockiert · " + url.host)
                    events.notice(L("Von Filterliste blockiert · ", "Blocked by a filter list · ") + url.host, url)
                }
                return true
            }
            if (!request.isRedirect) tab.trustedChain = hasGesture
            prepare(tab, view, url)
            return false
        }

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            // WebView skips shouldOverrideUrlLoading for POST. A 204 leaves the existing document in place.
            if (request.isForMainFrame && request.method.equals("POST", ignoreCase = true)) {
                val from = tab.committed ?: tab.address
                val to = BrowserPolicy.webUrl(request.url.toString())
                if (to == null || !BrowserPolicy.allowsNavigation(from, to, request.hasGesture(), false, false)) {
                    view.post {
                        if (tab === current && tab.webView === view) {
                            record("Formular-Weiterleitung blockiert")
                            events.notice(L("Formular-Weiterleitung blockiert", "Form redirect blocked"))
                        }
                    }
                    return WebResourceResponse(
                        "text/plain", "UTF-8", 204, "No Content",
                        mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(byteArrayOf()),
                    )
                }
            }
            val page = if (request.isForMainFrame) BrowserPolicy.webUrl(request.url.toString())?.also { tab.requested = it }
                else tab.requested ?: tab.committed ?: tab.address
            val filtered = filteringAllowed(page)
            // An embedded frame (a video player, an ad) gets the rules for its own host before it loads.
            if (filtered && documentStart && !request.isForMainFrame && TrackerBlocker.typeOf(request) == FilterEngine.FRAME) {
                val frame = BrowserPolicy.webUrl(request.url.toString())
                if (frame != null && tab.frames.add(TrackerBlocker.origin(frame))) view.post {
                    if (tab.webView !== view) return@post
                    val script = blocker.frameScript(frame) ?: return@post
                    runCatching { WebViewCompat.addDocumentStartJavaScript(view, script, setOf(TrackerBlocker.origin(frame))) }
                        .getOrNull()?.let(tab.pageScripts::add)
                }
            }
            return blocker.intercept(request, page, filtered)
        }

        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            val target = BrowserPolicy.webUrl(url) ?: return
            prepare(tab, view, target)
            tab.progress = 0
            changed(tab)
        }

        override fun onPageCommitVisible(view: WebView, url: String) {
            val target = BrowserPolicy.webUrl(url) ?: return
            tab.committed = target
            rememberAddress(tab, target)
            tab.trustedChain = false
            changed(tab)
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
            val target = BrowserPolicy.webUrl(url) ?: return
            if (tab.committed?.let { BrowserPolicy.site(it) == BrowserPolicy.site(target) } == true) {
                rememberAddress(tab, target)
                changed(tab)
            }
        }

        override fun onPageFinished(view: WebView, url: String) {
            val target = BrowserPolicy.webUrl(url) ?: return
            if (view.url != url || tab.webView !== view) return
            tab.committed = target
            rememberAddress(tab, target)
            tab.trustedChain = false
            tab.title = view.title.orEmpty().take(250)
            tab.progress = 100
            if (!documentStart && scriptsAllowed(target)) {
                view.evaluateJavascript(browserScript, null)
                if (target.isHttps && BrowserPolicy.site(target) == "krussdomi.com")
                    view.evaluateJavascript(captionScript, null)
            }
            val scroll = tab.pendingScroll
            if (scroll != null) view.postVisualStateCallback(0, object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) {
                    restorePosition(tab, view, target, scroll, 0, 4)
                }
            })
            changed(tab)
            save()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame || tab !== current) return
            tab.trustedChain = false
            record("Ladefehler " + error.errorCode + " · " + request.url.host.orEmpty())
            events.notice(L("Seite konnte nicht geladen werden", "The page could not be loaded"))
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            tab.crashed = true
            tab.trustedChain = false
            dispose(tab)
            if (tab === current) {
                events.hideFullscreen()
                events.notice(L("Seitenprozess beendet. Tippe auf Neu laden.", "The page's process ended. Tap Reload."))
                changed(tab)
            }
            return true
        }
    }

    private inner class ChromeClient(private val tab: Tab) : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            tab.progress = newProgress
            changed(tab)
        }

        override fun onReceivedTitle(view: WebView, title: String) {
            tab.title = title.take(250)
            changed(tab)
        }

        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, message: android.os.Message): Boolean {
            if (tab === current) {
                record("Popup blockiert")
                // A tapped link that wanted a new window can still be opened on purpose.
                events.notice(L("Popup blockiert", "Popup blocked"), tab.freshTap()?.takeIf { isUserGesture && !tab.tappedForm })
            }
            return false
        }

        override fun onPermissionRequest(request: PermissionRequest) = request.deny()

        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            if (tab === current) events.showFullscreen(view, callback) else callback.onCustomViewHidden()
        }

        override fun onHideCustomView() {
            if (tab === current) events.hideFullscreen()
        }
    }
}
