package com.nowaddlearound.poubrowser

import android.Manifest
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.content.ClipData
import android.content.ClipboardManager
import android.net.http.SslError
import android.webkit.ConsoleMessage
import android.webkit.HttpAuthHandler
import android.webkit.SslErrorHandler
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebViewDatabase
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ProfileStore
import androidx.webkit.ScriptHandler
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebStorageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.WebViewRenderProcess
import androidx.webkit.WebViewRenderProcessClient
import okhttp3.HttpUrl
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayInputStream
import java.text.NumberFormat
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

internal class BrowserSession(
    private val context: Context,
    private val blocker: TrackerBlocker,
    private val events: Events,
) {
    interface Events {
        fun pageChanged()
        /** `lasting`: no timer; stays until tapped, replaced or the tab opens another page. */
        fun notice(text: String, destination: HttpUrl? = null, lasting: Boolean = false)
        fun clearNotice()
        fun showFullscreen(view: View, callback: WebChromeClient.CustomViewCallback)
        fun hideFullscreen()
        /** `link` or `image` (an image to save) or both, from a long press. */
        fun showLinkActions(link: HttpUrl?, image: HttpUrl? = null)
        /** A long press on a video or audio player; `kind` is "video" or "audio". */
        fun showMediaActions(kind: String, url: HttpUrl)
        /** A link led to a file the page cannot show (zip, pdf, apk): ask before saving it. */
        fun offerDownload(url: HttpUrl, name: String) {}
        /** An `<input type=file>`; true when a picker opened and `done` will be called. */
        fun pickFiles(params: WebChromeClient.FileChooserParams, done: ValueCallback<Array<Uri>?>): Boolean = false
        /** The count of requests stopped on the tab in front changed. */
        fun blockedChanged() {}
        /** A tab's console lines or requests for the developer tools changed. */
        fun devChanged() {}
        /** A page in the front tab wants `what` (location, camera, microphone): ask the user, then Android for `permissions`. */
        /** `navigator.share()` from the page in front, right after the user's own tap. */
        fun share(text: String, title: String?) {}
        fun askSitePermission(host: String, what: String, permissions: Array<String>, done: (Boolean) -> Unit) = done(false)
        /** A notice whose button runs `run` instead of opening an address. */
        fun noticeAction(text: String, action: String, lasting: Boolean = false, run: () -> Unit) = notice(text)
        /** HTTP sign-in of a router, NAS or intranet page: the user's name and password, or null. */
        fun askLogin(host: String, realm: String, done: (Pair<String, String>?) -> Unit) = done(null)
        /** A certificate the system does not trust: true when the user goes on anyway. */
        fun askCertificate(host: String, reason: String, done: (Boolean) -> Unit) = done(false)
        /** The page in front hangs: true to end its process. */
        fun askUnresponsive(done: (Boolean) -> Unit) = done(false)
        /** A tab's sound started or stopped. */
        fun mediaChanged() {}
    }

    enum class WipeResult { COMPLETE, PARTIAL, SAVE_FAILED }

    private class ClosedTab(val url: HttpUrl, val title: String, val scroll: Int)

    class Tab internal constructor(
        address: HttpUrl? = null,
        var title: String = "",
        var scroll: Int = 0,
        /** A private tab's WebView profile, shared by all open private tabs: cleared when the last one closes. */
        val profile: String? = null,
    ) {
        @Volatile var address = address
        val isPrivate get() = profile != null
        val host get() = address?.host?.removePrefix("www.")
        val label get() = title.ifBlank { host ?: L("Neuer Tab", "New tab") }

        private var cachedBitmap: Bitmap? = null
        var preview: ByteArray? = null
            set(value) {
                field = value
                cachedBitmap = null
            }

        internal fun thumbnail(): Bitmap? {
            cachedBitmap?.let { return it }
            val bytes = preview ?: return null
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.also { cachedBitmap = it }
        }

        var progress = 100
        var webView: WebView? = null
            internal set
        internal var defaultUserAgent: String = ""
        internal var history: Bundle? = null
        @Volatile internal var committed: HttpUrl? = null
        internal var pendingScroll: Int? = null
        internal var trustedChain = false
        internal var crashed = false
        internal var started = false
        /** The main frame failed to load: its error page stays out of the history. */
        internal var failed = false
        /** The link or form the finger last touched, as the page script reported it. */
        internal var tapped: HttpUrl? = null
        internal var tappedForm = false
        internal var tappedAt = 0L
        /** The last finger down on the view: media.js reports count only right after one. */
        internal var touchedAt = 0L
        /** When media.js last reported a press on a player. */
        internal var mediaAt = 0L
        /** The tab whose tapped popup this tab is: kept alive for `window.opener`, selected again on close. */
        internal var opener: Tab? = null

        /** The page the tab is loading or showing: what its requests are judged against. */
        @Volatile internal var requested: HttpUrl? = null
        /** Wildcard scripts (`*`: Dark Reader and global generic CSS) kept across cross-site navigations. */
        internal val globalScripts = ArrayList<ScriptHandler>()
        internal var globalScriptsFor: String? = null
        /** Host-scoped scripts (`https://example.com`) swapped when moving between origins. */
        internal val originScripts = ArrayList<ScriptHandler>()
        internal var originScriptsFor: String? = null
        internal val frames: MutableSet<String> = ConcurrentHashMap.newKeySet()
        /** Requests the filter lists dropped on the page now open. */
        internal val blocked = AtomicInteger()
        /** The dead page the archive notice is about. */
        internal var archiveFor: HttpUrl? = null
        /** "Hide element" waits for the tap that picks the element. */
        internal var picking = false
        /** "Inspect element" waits for the tap that picks the element. */
        internal var inspecting = false
        /** Developer tools: the page's console (main thread only) and its requests (any thread, locked on itself). */
        internal val console = ArrayDeque<DevEntry>()
        internal val requests = ArrayDeque<DevRequest>()
        /** Goes up with every change of `console` or `requests`, so the panel redraws only then. */
        internal val devVersion = AtomicInteger()

        internal fun freshTap() = tapped?.takeIf { SystemClock.uptimeMillis() - tappedAt < 3000 }

        /** Frames that played sound on the page now open, and whether each still plays; the last one gets the video tools. */
        internal val media = HashMap<JavaScriptReplyProxy, Boolean>()
        internal var mediaFrame: JavaScriptReplyProxy? = null
        val playing get() = media.values.any { it }
        val hasMedia get() = mediaFrame != null
        var muted = false
            internal set
        /** The http address this tab tried over https first (HTTPS-First); null once a page loaded. */
        internal var upgradedFrom: HttpUrl? = null
        internal var askedUnresponsive = false
        internal var reloadWhenGone = false
    }

    private val mainThread = Handler(Looper.getMainLooper())
    private val badgeUpdatePending = AtomicBoolean()
    private val devUpdatePending = AtomicBoolean()

    private fun scheduleDevUpdate(tab: Tab) {
        tab.devVersion.incrementAndGet()
        if (!devUpdatePending.compareAndSet(false, true)) return
        mainThread.post {
            devUpdatePending.set(false)
            events.devChanged()
        }
    }

    private fun addConsole(tab: Tab, entry: DevEntry) {
        tab.console.addLast(entry)
        if (tab.console.size > 1000) tab.console.removeFirst()
        scheduleDevUpdate(tab)
    }

    /** Any thread: `shouldInterceptRequest` runs on WebView's network threads. */
    private fun addRequest(tab: Tab, request: WebResourceRequest, blocked: Boolean) {
        val type = if (request.isForMainFrame) FilterEngine.DOCUMENT else TrackerBlocker.typeOf(request)
        synchronized(tab.requests) {
            if (request.isForMainFrame) tab.requests.clear()
            tab.requests.addLast(DevRequest(request.url.toString(), DevTools.typeName(type), blocked))
            if (tab.requests.size > 500) tab.requests.removeFirst()
        }
        scheduleDevUpdate(tab)
    }

    private fun scheduleBlockedBadge() {
        if (!badgeUpdatePending.compareAndSet(false, true)) return
        mainThread.post {
            badgeUpdatePending.set(false)
            events.blockedChanged()
        }
    }

    private val preferences = context.getSharedPreferences("browser", Context.MODE_PRIVATE)
    val library = Library(context)
    private val roster = restoreTabs()
    private val recent = mutableListOf<Tab>()
    private val closed = ArrayDeque<ClosedTab>()
    private val diagnostics = ArrayDeque<String>()
    private val browserScript = readAsset("browser.js")
    private val captionScript = readAsset("captions.js")
    private val mediaScript = readAsset("media.js")
    private val privacyScript by lazy { pageWrapped(readAsset("privacy.js")) }
    private val consentScript by lazy { pageWrapped(readAsset("autoconsent.js")) }
    /** Sites the user let load over http after https failed; for this app run only, as in Chrome. */
    private val httpSites = mutableSetOf<String>()
    /** Sites whose cookie banner was already reported in this app run. */
    private val cookieNotices = mutableSetOf<String>()
    private val media = MediaDownloads(context) { events.notice(it) }
    private val pickScript by lazy { readAsset("pick.js") }
    private val inspectScript by lazy { readAsset("inspect.js") }
    private val sourceClient by lazy { okhttp3.OkHttpClient() }
    private val documentStart = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
    // With both, the page script reports tapped links. Older WebViews fall back to "any touch counts".
    private val tapReports = documentStart && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
    private val scriptlessSites = preferences.getStringSet("scriptless", emptySet()).orEmpty().toMutableSet()
    private val desktopSites = preferences.getStringSet("desktop", emptySet()).orEmpty().toMutableSet()
    private val forgetSites = preferences.getStringSet("forget", emptySet()).orEmpty().toMutableSet()
    /** Sites where a tapped popup (Google, PayPal sign-in) opens as a tab that keeps `window.opener`. */
    private val popupSites = preferences.getStringSet("popups", emptySet()).orEmpty().toMutableSet()
    // Sites where the user switched the ad blocker off because the site refuses to work with one.
    // Popups and forced redirects stay blocked there.
    private val unfilteredSites: MutableSet<String> =
        ConcurrentHashMap.newKeySet<String>().apply { addAll(preferences.getStringSet("unfiltered", emptySet()).orEmpty()) }
    /** Sites the user blocked: nothing loads from them or their subdomains. Read from request threads. */
    private val blockedSites: MutableSet<String> =
        ConcurrentHashMap.newKeySet<String>().apply { addAll(preferences.getStringSet("blockedSites", emptySet()).orEmpty()) }

    val tabs: List<Tab> get() = roster
    /** A site list changed here, by its part name in the sync file. */
    var syncChanged: (String) -> Unit = {}
    val scriptlessList get() = scriptlessSites.sorted()
    val unfilteredList get() = unfilteredSites.sorted()
    val popupList get() = popupSites.sorted()
    val blockedList get() = blockedSites.sorted()
    val hasClosedTabs: Boolean get() = closed.isNotEmpty()
    var current = roster[preferences.getInt("current", 0).coerceIn(roster.indices)]
        private set
    val activeView get() = current.webView ?: makeWebView(current)
    val log get() = diagnostics.joinToString("\n")
    val supportsFullWipe get() = WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)
    val supportsPrivate = WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)
    /** Picking needs the page to report the tap, keeping it hidden needs document-start scripts. */
    val supportsHiding get() = tapReports
    /** Repaints web pages in dark colours with the Dark Reader library. */
    var darkPages = preferences.getBoolean("dark", false)
        set(value) {
            field = value
            preferences.edit().putBoolean("dark", value).apply()
            reload()
        }
    /** Answers cookie banners with "reject" (DuckDuckGo's autoconsent). */
    var rejectCookies = preferences.getBoolean("rejectCookies", true)
        set(value) {
            field = value
            preferences.edit().putBoolean("rejectCookies", value).apply()
            reload()
        }
    /** Tries https before http, as Chrome's "Always use secure connections". */
    var httpsOnly = preferences.getBoolean("httpsOnly", true)
        set(value) {
            field = value
            preferences.edit().putBoolean("httpsOnly", value).apply()
        }
    var pipEnabled = preferences.getBoolean("pip", true)
        set(value) {
            field = value
            preferences.edit().putBoolean("pip", value).apply()
        }
    /** All requests the filter lists ever dropped; saved with the tabs. */
    private val totalBlocked = AtomicLong(preferences.getLong("blocked", 0))
    val blockedTotal get() = totalBlocked.get()
    var searchEngine = BrowserPolicy.searchEngines.firstOrNull { it.name == preferences.getString("search", null) }
        ?: BrowserPolicy.searchEngines[0]
        set(value) {
            field = value
            preferences.edit().putString("search", value.name).apply()
        }

    init {
        recent.add(current)
        // Private profiles of earlier runs. WebView deletes only profiles this run has not loaded.
        if (supportsPrivate) ProfileStore.getInstance().let { store ->
            store.allProfileNames.filter { it.startsWith("private-") }.forEach { runCatching { store.deleteProfile(it) } }
        }
    }

    fun select(tab: Tab) {
        if (tab !in roster) return
        if (current !== tab) {
            remember(current)
            current.webView?.onPause()
            current = tab
            events.clearNotice()   // a lasting notice ("Load anyway") belongs to the tab it came from
        }
        recent.remove(tab)
        recent.add(0, tab)
        activeView.onResume()
        // An opener stays loaded while its popup is open, or `window.opener.postMessage` goes nowhere.
        recent.drop(3).filter { old -> roster.none { it.opener === old } }.forEach(::park)
        save()
        events.pageChanged()
    }

    fun newTab() = select(Tab().also(roster::add))

    fun newPrivateTab() = select(Tab(profile = privateProfile()).also(roster::add))

    /** As in Chrome Incognito: one sign-in for all open private tabs, a fresh profile after the last one closes. */
    private var privateSession: String? = null

    private fun privateProfile() = privateSession ?: ("private-" + UUID.randomUUID()).also { privateSession = it }

    fun openInNewTab(rawUrl: HttpUrl, inBackground: Boolean = false) {
        val cleaned = BrowserPolicy.cleanUrl(rawUrl)
        if (refused(current, cleaned)) return
        // A link out of a private tab stays private.
        val tab = Tab(address = cleaned, profile = current.profile?.let { privateProfile() })
        val insertAt = (roster.indexOf(current) + 1).coerceIn(0, roster.size)
        roster.add(insertAt, tab)
        if (inBackground) {
            save()
            events.pageChanged()
            events.notice(L("Im Hintergrund geöffnet · ", "Opened in background · ") + cleaned.host)
        } else {
            select(tab)
        }
    }

    fun openExternal(raw: String?) {
        val url = raw?.let(BrowserPolicy::webUrl)?.let(BrowserPolicy::cleanUrl) ?: return
        if (current.address == null) open(url)
        else openInNewTab(url, inBackground = false)
    }

    fun close(tab: Tab) {
        val index = roster.indexOf(tab)
        if (index < 0) return
        remember(tab)
        if (!tab.isPrivate) tab.address?.let { url ->
            if (closed.size >= 10) closed.removeFirst()
            closed.addLast(ClosedTab(url, tab.title, tab.scroll))
        }
        discard(tab)
        if (roster.isEmpty()) roster.add(Tab())
        if (current === tab) select(tab.opener?.takeIf { it in roster } ?: roster[index.coerceAtMost(roster.lastIndex)])
        else {
            save()
            events.pageChanged()
        }
        val site = tab.address?.let(BrowserPolicy::site) ?: return
        if (site in forgetSites && roster.none { it.address?.let(BrowserPolicy::site) == site }) forget(site)
    }

    /** Takes a tab out for good; the last private tab takes the private cookies and storage with it. */
    private fun discard(tab: Tab) {
        roster.remove(tab)
        recent.remove(tab)
        dispose(tab)
        val profile = tab.profile ?: return
        if (roster.any { it.profile == profile }) return
        clearProfile(profile)
        if (privateSession == profile) privateSession = null
    }

    /** WebView keeps every profile it loaded until the app ends: the data goes now, the profile at the next start. */
    private fun clearProfile(name: String) {
        val profile = runCatching { ProfileStore.getInstance().getProfile(name) }.getOrNull() ?: return
        profile.cookieManager.removeAllCookies(null)
        profile.webStorage.deleteAllData()
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)) WebStorageCompat.deleteBrowsingData(profile.webStorage) {}
    }

    /** Deletes a site's cookies, storage and history and closes its tabs. Bookmarks and site settings stay. */
    fun iconFile(host: String) = java.io.File(context.filesDir, "icons/$host.png")

    fun forget(site: String) {
        context.filesDir.resolve("icons").listFiles()?.filter { it.nameWithoutExtension.let { h -> h == site || h.endsWith(".$site") } }
            ?.forEach { it.delete() }
        val hosts = mutableSetOf(site, "www.$site")
        for (tab in roster.toList()) {
            val url = tab.address ?: continue
            if (BrowserPolicy.site(url) != site) continue
            hosts += url.host
            discard(tab)
        }
        for (page in library.history) BrowserPolicy.webUrl(page.url)?.takeIf { BrowserPolicy.site(it) == site }?.let { hosts += it.host }
        library.removeSite(site)
        closed.removeAll { BrowserPolicy.site(it.url) == site }
        val cookies = CookieManager.getInstance()
        val storage = WebStorage.getInstance()
        for (host in hosts) for (scheme in listOf("https", "http")) {
            storage.deleteOrigin("$scheme://$host")
            for (cookie in BrowserPolicy.expiringCookies(cookies.getCookie("$scheme://$host"), host, site))
                cookies.setCookie("https://$host", cookie)
        }
        cookies.flush()
        // deleteOrigin leaves localStorage alone, and cookies on paths or unseen subdomains stay above: newer WebViews get those too.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA))
            WebStorageCompat.deleteBrowsingDataForSite(storage, site) {}
        if (roster.isEmpty()) roster.add(Tab())
        if (current !in roster) select(recent.firstOrNull() ?: roster.last())
        else {
            save()
            events.pageChanged()
        }
        events.notice(L("$site vergessen", "$site forgotten"))
    }

    fun reopenClosedTab() {
        val item = closed.removeLastOrNull() ?: return
        val tab = Tab(item.url, item.title, item.scroll)
        roster.add(tab)
        select(tab)
    }

    fun openInput(value: String) {
        val address = BrowserPolicy.destination(value, searchEngine)
        if (address != null) open(address)
        else if (value.isNotBlank()) events.notice(L("Ungültige Webadresse", "Not a web address"))
    }

    fun open(url: HttpUrl) {
        current.crashed = false
        load(current, activeView, BrowserPolicy.cleanUrl(url))
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

    fun desktopAllowed(url: HttpUrl?): Boolean = url != null && BrowserPolicy.site(url) in desktopSites

    fun forgetsWhenClosed(url: HttpUrl?): Boolean = url != null && BrowserPolicy.site(url) in forgetSites

    fun toggleForgetWhenClosed() {
        val site = current.address?.let(BrowserPolicy::site) ?: return
        if (!forgetSites.add(site)) forgetSites.remove(site)
        preferences.edit().putStringSet("forget", forgetSites.toSet()).apply()
    }

    /** CSS selectors of the elements the user hid on a site. */
    fun hidden(url: HttpUrl?): Set<String> = url?.let { preferences.getStringSet("hidden." + BrowserPolicy.site(it), null) }.orEmpty()

    /** The next tap on the page hides what it lands on; pick.js reports the element's selector. */
    fun pickElement() {
        current.picking = true
        activeView.evaluateJavascript(pickScript, null)
    }

    /** The next tap on the page writes the element's path, size and HTML into the console. False without page scripts. */
    fun inspectElement(): Boolean {
        val tab = current
        val view = tab.webView ?: return false
        if (!tapReports || !view.settings.javaScriptEnabled) return false
        tab.picking = false
        tab.inspecting = true
        addConsole(tab, DevEntry("info", L("Element antippen …", "Tap an element …")))
        view.evaluateJavascript(inspectScript, null)
        return true
    }

    /** Runs typed JavaScript in the page, like Chrome's console (native, so the page's CSP does not stop it). */
    fun evaluate(code: String) {
        val tab = current
        val view = tab.webView ?: return
        addConsole(tab, DevEntry("input", code))
        if (!view.settings.javaScriptEnabled) {
            addConsole(tab, DevEntry("error", L("JavaScript ist auf dieser Seite aus", "JavaScript is off on this site")))
            return
        }
        // A try statement's value is its block's last value, so statements and `var` work as in a console.
        // Syntax errors never get here: the page's console reports them.
        view.evaluateJavascript("try {\n$code\n} catch (error) { ({ $EVAL_ERROR: String(error && error.stack || error) }) }") { result ->
            val error = runCatching { JSONObject(result).optString(EVAL_ERROR, null) }.getOrNull()
            addConsole(tab, if (error != null) DevEntry("error", error) else DevEntry("result", result.orEmpty().take(4000)))
        }
    }

    fun clearConsole() {
        current.console.clear()
        scheduleDevUpdate(current)
    }

    /** The front page as the server sends it, fetched again with the tab's cookies; else its current DOM. */
    fun pageSource(done: (String) -> Unit) {
        val tab = current
        val view = tab.webView
        val url = tab.address
        if (view == null || url == null) return done("")
        val agent = view.settings.userAgentString
        val cookie = cookiesOf(tab)?.getCookie(url.toString())
        Thread {
            val text = runCatching {
                val request = okhttp3.Request.Builder().url(url.newBuilder().fragment(null).build()).header("User-Agent", agent)
                    .apply { if (cookie != null) header("Cookie", cookie) }.build()
                sourceClient.newCall(request).execute().use { if (it.isSuccessful) it.peekBody(8L shl 20).string() else null }
            }.getOrNull()
            mainThread.post {
                if (text != null) done(text)
                else if (tab.webView === view && view.settings.javaScriptEnabled)
                    view.evaluateJavascript("'<!-- DOM -->\\n' + document.documentElement.outerHTML") { result ->
                        done(runCatching { JSONTokener(result).nextValue() as String }.getOrDefault(""))
                    }
                else done("")
            }
        }.start()
    }

    fun restoreHidden() {
        val url = current.address ?: return
        preferences.edit().remove("hidden." + BrowserPolicy.site(url)).apply()
        reload()
    }

    /** Text size in percent for a site, 100 unless the user changed it. */
    fun zoom(url: HttpUrl?): Int = url?.let { preferences.getInt("zoom." + BrowserPolicy.site(it), 100) } ?: 100

    /** `step` in percent; 0 goes back to 100 %. */
    fun changeZoom(step: Int) {
        val url = current.address ?: return
        val value = if (step == 0) 100 else (zoom(url) + step).coerceIn(50, 300)
        val key = "zoom." + BrowserPolicy.site(url)
        preferences.edit().apply { if (value == 100) remove(key) else putInt(key, value) }.apply()
        activeView.settings.textZoom = value
    }

    fun toggleFiltering() {
        val url = current.address ?: return
        val site = BrowserPolicy.site(url)
        if (!unfilteredSites.add(site)) unfilteredSites.remove(site)
        preferences.edit().putStringSet("unfiltered", unfilteredSites.toSet()).apply()
        syncChanged("unfilteredSites")
        reload()
    }

    fun allowFiltering(site: String) {
        unfilteredSites.remove(site)
        preferences.edit().putStringSet("unfiltered", unfilteredSites.toSet()).apply()
        syncChanged("unfilteredSites")
        if (current.address?.let(BrowserPolicy::site) == site) reload()
    }

    private fun blockedSite(host: String?) = host?.let { BrowserPolicy.blockedSite(it, blockedSites) }

    /** Adds `site` to the block list and closes its tabs. */
    fun blockSite(site: String) {
        blockedSites.add(site)
        preferences.edit().putStringSet("blockedSites", blockedSites.toSet()).apply()
        syncChanged("blockedSites")
        for (tab in roster.toList()) if (blockedSite(tab.address?.host) != null) discard(tab)
        closed.removeAll { blockedSite(it.url.host) != null }
        // Images and scripts in memory would still show on a reload without asking shouldInterceptRequest.
        current.webView?.clearCache(false)
        if (roster.isEmpty()) roster.add(Tab())
        if (current !in roster) select(recent.firstOrNull() ?: roster.last())
        else {
            save()
            events.pageChanged()
        }
        events.notice(L("$site gesperrt", "$site blocked"))
    }

    fun unblockSite(site: String) {
        blockedSites.remove(site)
        preferences.edit().putStringSet("blockedSites", blockedSites.toSet()).apply()
        syncChanged("blockedSites")
    }

    /** The site lists by their part name in the sync file, with the preference that holds each. */
    private fun siteList(part: String) = when (part) {
        "blockedSites" -> blockedSites to "blockedSites"
        "unfilteredSites" -> unfilteredSites to "unfiltered"
        "scriptlessSites" -> scriptlessSites to "scriptless"
        else -> null
    }

    fun sites(part: String) = siteList(part)?.first?.sorted().orEmpty()

    /** A list taken over from the sync file; it counts from the next page load on. */
    fun replaceSites(part: String, sites: List<String>) {
        val (set, key) = siteList(part) ?: return
        set.retainAll(sites.toSet())
        set.addAll(sites)
        preferences.edit().putStringSet(key, set.toSet()).apply()
    }

    /** Stops a page load to a blocked site, with a notice when `tab` is in front. */
    private fun refused(tab: Tab, url: HttpUrl): Boolean {
        val site = blockedSite(url.host) ?: return false
        record("Gesperrte Seite blockiert · " + url.host)
        if (tab === current) events.notice(L("Gesperrte Seite: $site", "Blocked site: $site"))
        return true
    }

    fun popupsAllowed(url: HttpUrl?): Boolean = url != null && BrowserPolicy.site(url) in popupSites

    fun togglePopups() {
        val url = current.address ?: return
        setPopups(BrowserPolicy.site(url), allowed = !popupsAllowed(url))
    }

    /** The page script learns of the change only in a new web view: the site's tabs get theirs, history kept. */
    fun setPopups(site: String, allowed: Boolean) {
        val changed = if (allowed) popupSites.add(site) else popupSites.remove(site)
        if (!changed) return
        preferences.edit().putStringSet("popups", popupSites.toSet()).apply()
        // The mark is fixed when a web view is made: on allowing, every tab may still go to the site later.
        val affected = if (allowed) roster.toList() else roster.filter { it.address?.let(BrowserPolicy::site) == site }
        affected.forEach(::park)
        if (current in affected) select(current)
    }

    fun toggleScripts() {
        val url = current.address ?: return
        setScripts(BrowserPolicy.site(url), allowed = !scriptsAllowed(url))
    }

    fun setScripts(site: String, allowed: Boolean) {
        val changed = if (allowed) scriptlessSites.remove(site) else scriptlessSites.add(site)
        if (!changed) return
        preferences.edit().putStringSet("scriptless", scriptlessSites.toSet()).apply()
        syncChanged("scriptlessSites")
        for (tab in roster) {
            if (tab === current || tab.address?.let(BrowserPolicy::site) != site) continue
            remember(tab)
            tab.history = null
            dispose(tab)
        }
        if (current.address?.let(BrowserPolicy::site) == site) reload()
    }

    fun toggleDesktop() {
        val url = current.address ?: return
        val site = BrowserPolicy.site(url)
        if (!desktopSites.add(site)) desktopSites.remove(site)
        preferences.edit().putStringSet("desktop", desktopSites.toSet()).apply()
        reload()
    }

    fun save() {
        remember(current)
        val saved = JSONArray()
        val kept = roster.filter { !it.isPrivate }
        for (tab in kept) {
            saved.put(JSONObject().apply {
                put("url", tab.address?.toString().orEmpty())
                put("title", tab.title.take(250))
                put("scroll", tab.scroll)
            })
        }
        preferences.edit().putString("tabs", saved.toString()).putInt("current", kept.indexOf(current))
            .putLong("blocked", totalBlocked.get()).apply()
    }

    fun trim() {
        for (tab in roster) {
            tab.preview = null
            if (tab !== current) park(tab)
        }
    }

    fun wipe(onComplete: (WipeResult) -> Unit) {
        activeView.clearCache(true)
        roster.toList().forEach(::discard)
        diagnostics.clear()
        library.clearHistory()
        context.filesDir.resolve("icons").deleteRecursively()
        closed.clear()
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
        // Before anything else touches the view.
        tab.profile?.let {
            ProfileStore.getInstance().getOrCreateProfile(it)
            WebViewCompat.setProfile(view, it)
        }
        tab.webView = view
        tab.defaultUserAgent = view.settings.userAgentString
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
        // Payment apps (Google Pay and others) for PaymentRequest, as in Chrome; they show their own confirmation.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.PAYMENT_REQUEST)) WebSettingsCompat.setPaymentRequestEnabled(view.settings, true)
        configureDesktop(tab, view, tab.address)
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
            WebViewCompat.addWebMessageListener(view, "pouPick", setOf("*")) { _, message, _, mainFrame, _ ->
                val selector = message.data.orEmpty()
                if (selector.startsWith("inspect:")) {
                    if (tab.inspecting && mainFrame) {
                        tab.inspecting = false
                        addConsole(tab, DevEntry("element", selector.removePrefix("inspect:").take(5000)))
                    }
                    return@addWebMessageListener
                }
                val url = tab.address
                // Only the pick the user started counts: page scripts can call this too.
                if (!tab.picking || !mainFrame || url == null || selector.isBlank() || selector.length > 1000) return@addWebMessageListener
                tab.picking = false
                preferences.edit().putStringSet("hidden." + BrowserPolicy.site(url), hidden(url) + selector).apply()
                if (tab === current) events.clearNotice()
            }
            WebViewCompat.addWebMessageListener(view, "pouMedia", setOf("*")) { _, message, _, _, _ ->
                // Page scripts can post here too: only a report right after the user's own press opens the dialog.
                if (tab !== current || SystemClock.uptimeMillis() - tab.touchedAt > 3000) return@addWebMessageListener
                tab.mediaAt = SystemClock.uptimeMillis()
                val data = runCatching { JSONObject(message.data.orEmpty()) }.getOrNull() ?: return@addWebMessageListener
                val url = BrowserPolicy.webUrl(data.optString("url"))
                if (data.optBoolean("stream") || url == null) events.notice(L("Dieses Video ist ein Stream und lässt sich nicht als Datei laden",
                    "This video is a stream and can't be saved as a file"))
                else events.showMediaActions(if (data.optString("kind") == "audio") "audio" else "video", url)
            }
            WebViewCompat.addDocumentStartJavaScript(view, mediaScript, setOf("*"))
            // WebView has no Web Share; Chrome hands it to Android's share sheet. Main frame only, after a tap.
            WebViewCompat.addWebMessageListener(view, "pouShare", setOf("*")) { _, message, _, mainFrame, _ ->
                if (!mainFrame || tab !== current || SystemClock.uptimeMillis() - tab.touchedAt > 5000) return@addWebMessageListener
                val data = runCatching { JSONObject(message.data.orEmpty()) }.getOrNull() ?: return@addWebMessageListener
                val url = data.optString("url").takeIf { BrowserPolicy.webUrl(it) != null }.orEmpty()
                val text = listOf(data.optString("text"), url).filter { it.isNotBlank() }.joinToString("\n")
                if (text.isNotEmpty()) events.share(text.take(10_000), data.optString("title").take(250))
            }
            WebViewCompat.addDocumentStartJavaScript(view, SHARE_SCRIPT, setOf("*"))
            // privacy.js and autoconsent.js report here. Pages can post too: both only show a notice.
            WebViewCompat.addWebMessageListener(view, "pouPrivacy", setOf("*")) { _, message, _, _, _ ->
                if (tab !== current) return@addWebMessageListener
                val data = message.data.orEmpty()
                val text = data.substringAfter('\n', "").take(100_000)
                when (data.substringBefore('\n')) {
                    "clipboard" -> if (text.isNotBlank()) events.noticeAction(
                        L("Seite hat den kopierten Text verändert", "Page changed the copied text"), L("Original kopieren", "Copy original"),
                        lasting = true,
                    ) {
                        context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Text", text))
                        events.notice(L("Original kopiert", "Original copied"))
                    }
                    "cookies" -> {
                        val site = tab.address?.let(BrowserPolicy::site) ?: return@addWebMessageListener
                        if (cookieNotices.add(site)) {
                            record("Cookie-Banner abgelehnt · $site")
                            events.notice(L("Cookie-Banner abgelehnt", "Cookie banner rejected"))
                        }
                    }
                }
            }
            // Which frames play sound, for the video tools, mute and the media notification.
            WebViewCompat.addWebMessageListener(view, "pouPlay", setOf("*")) { _, message, _, _, frame ->
                val data = runCatching { JSONObject(message.data.orEmpty()) }.getOrNull() ?: return@addWebMessageListener
                if (data.has("answer")) {
                    if (tab === current) videoAnswer(data.optString("answer"))
                    return@addWebMessageListener
                }
                val playing = data.optBoolean("play")
                tab.media[frame] = playing
                if (playing) {
                    tab.mediaFrame = frame
                    if (tab.muted) runCatching { frame.postMessage("[\"mute\",true]") }
                }
                events.mediaChanged()
            }
            WebViewCompat.addDocumentStartJavaScript(view, PLAY_SCRIPT, setOf("*"))
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_VIEW_RENDERER_CLIENT_BASIC_USAGE)) {
            WebViewCompat.setWebViewRenderProcessClient(view, object : WebViewRenderProcessClient() {
                override fun onRenderProcessUnresponsive(view: WebView, renderer: WebViewRenderProcess?) {
                    if (tab !== current || tab.webView !== view || tab.askedUnresponsive) return
                    tab.askedUnresponsive = true
                    record("Seite reagiert nicht · " + tab.host.orEmpty())
                    events.askUnresponsive { end ->
                        if (end && tab.askedUnresponsive && tab.webView === view) {
                            tab.reloadWhenGone = true
                            if (renderer?.terminate() != true) tab.reloadWhenGone = false
                        }
                        tab.askedUnresponsive = false
                    }
                }

                override fun onRenderProcessResponsive(view: WebView, renderer: WebViewRenderProcess?) {
                    tab.askedUnresponsive = false
                }
            })
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            // Before browser.js, which reads and removes the mark before any page script runs.
            val popupOrigins = popupSites.flatMap { listOf("https://$it", "https://*.$it", "http://$it", "http://*.$it") }
            if (popupOrigins.isNotEmpty())
                runCatching { WebViewCompat.addDocumentStartJavaScript(view, "window.__pouPopups = true;", popupOrigins.toSet()) }
            WebViewCompat.addDocumentStartJavaScript(view, browserScript, setOf("*"))
            WebViewCompat.addDocumentStartJavaScript(view, captionScript, setOf("*"))
        }
        view.setOnTouchListener { _, event ->
            if (event.actionMasked == android.view.MotionEvent.ACTION_DOWN) tab.touchedAt = SystemClock.uptimeMillis()
            false
        }
        view.setOnLongClickListener {
            val hit = view.hitTestResult
            val type = hit.type
            val extra = hit.extra?.let(BrowserPolicy::webUrl)
            // A link around a data: or blob: image still has a link to offer.
            if (type !in linkAndImageHits || extra == null && type != WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) return@setOnLongClickListener false
            val pressed = tab.touchedAt
            // A press on a video or audio player leaves WebView's previous hit in place. media.js reports those
            // presses 550 ms after the touch: wait for it, so an old link or image does not answer for the player.
            view.postDelayed({
                if (tab !== current || tab.webView !== view || tab.mediaAt >= pressed) return@postDelayed
                when (type) {
                    WebView.HitTestResult.SRC_ANCHOR_TYPE -> events.showLinkActions(extra)
                    WebView.HitTestResult.IMAGE_TYPE -> events.showLinkActions(null, extra)
                    // `extra` is the image here; the link's own address comes from requestFocusNodeHref.
                    else -> view.requestFocusNodeHref(Handler(Looper.getMainLooper()) { message ->
                        val link = message.data.getString("url")?.let(BrowserPolicy::webUrl)
                        if (tab === current && (link != null || extra != null)) events.showLinkActions(link, extra)
                        true
                    }.obtainMessage())
                }
            }, if (tapReports && view.settings.javaScriptEnabled) 350L else 0L)
            // Not consumed: a consumed long press cancels the page's touch, and media.js would never report.
            false
        }
        view.webViewClient = NavigationClient(tab)
        view.webChromeClient = ChromeClient(tab)
        // Asked every time: a page alone must not fill the Downloads folder.
        view.setDownloadListener { url, _, disposition, mime, _ ->
            val target = BrowserPolicy.webUrl(url)
            if (tab === current && target != null) events.offerDownload(target, URLUtil.guessFileName(url, disposition, mime))
            else events.notice(L("Dateidownload blockiert", "File download blocked"))
        }
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

    /** Saves `url` with the front tab's cookies (its own profile's in a private tab), User-Agent and page as Referer. */
    fun downloadMedia(url: HttpUrl, audioOnly: Boolean, name: String? = null) {
        val tab = current
        val view = tab.webView ?: return
        val source = MediaDownloads.Source(url.toString(), view.settings.userAgentString,
            tab.address?.newBuilder()?.fragment(null)?.build()?.toString(), cookiesOf(tab)?.getCookie(url.toString()))
        if (audioOnly) media.downloadAudio(source) else media.download(source, name)
    }

    /** The tab's cookie jar: its own profile's in a private tab. */
    private fun cookiesOf(tab: Tab) = if (tab.profile == null) CookieManager.getInstance()
        else runCatching { ProfileStore.getInstance().getProfile(tab.profile)?.cookieManager }.getOrNull()

    private fun load(tab: Tab, view: WebView, requested: HttpUrl) {
        val url = httpsFirst(tab, requested)
        if (refused(tab, url)) return
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

    private fun configureDesktop(tab: Tab, view: WebView, url: HttpUrl?) {
        val desktop = desktopAllowed(url)
        view.settings.apply {
            if (tab.defaultUserAgent.isNotEmpty()) {
                userAgentString = if (desktop) DESKTOP_USER_AGENT else tab.defaultUserAgent
            }
            useWideViewPort = desktop
            loadWithOverviewMode = desktop
        }
    }

    /**
     * Gets the view ready for a page before it loads: the JavaScript and Desktop switches, plus the scripts
     * that must run ahead of the page's own. Wildcard scripts (`*`: Dark Reader, generic CSS) stay registered
     * across cross-site clicks, while host-specific scripts swap per origin.
     */
    private fun prepare(tab: Tab, view: WebView, url: HttpUrl) {
        configureScripts(view, url)
        configureDesktop(tab, view, url)
        view.settings.textZoom = zoom(url)
        tab.requested = url
        if (!documentStart) return
        val filtered = filteringAllowed(url)
        val plan = if (filtered) blocker.planScripts(url) else null
        val useWildcard = plan?.useWildcardGeneric == true

        val wantedGlobal = "$useWildcard|$darkPages|${blocker.version}|$filtered|$rejectCookies"
        if (wantedGlobal != tab.globalScriptsFor) {
            tab.globalScriptsFor = wantedGlobal
            tab.globalScripts.forEach(ScriptHandler::remove)
            tab.globalScripts.clear()
            if (darkPages) {
                runCatching { WebViewCompat.addDocumentStartJavaScript(view, blocker.darkScript, setOf("*")) }
                    .getOrNull()?.let(tab.globalScripts::add)
            }
            if (useWildcard) {
                runCatching { WebViewCompat.addDocumentStartJavaScript(view, blocker.genericScript(), setOf("*")) }
                    .getOrNull()?.let(tab.globalScripts::add)
            }
            // Every frame of a protected page: ping links, fingerprint noise, clipboard watch, cookie banners.
            if (filtered && tapReports) {
                for (script in listOfNotNull(privacyScript, RTC_SCRIPT, consentScript.takeIf { rejectCookies }))
                    runCatching { WebViewCompat.addDocumentStartJavaScript(view, script, setOf("*")) }
                        .getOrNull()?.let(tab.globalScripts::add)
            }
        }

        val origin = TrackerBlocker.origin(url)
        val hiding = BrowserPolicy.hidingCss(hidden(url))
        val wantedOrigin = "$origin|$filtered|${blocker.version}|${hiding.hashCode()}"
        if (wantedOrigin != tab.originScriptsFor) {
            tab.originScriptsFor = wantedOrigin
            tab.originScripts.forEach(ScriptHandler::remove)
            tab.originScripts.clear()
            tab.frames.clear()
            val origins = setOf(origin)
            if (hiding.isNotEmpty()) {
                runCatching { WebViewCompat.addDocumentStartJavaScript(view, blocker.styleScript(hiding), origins) }
                    .getOrNull()?.let(tab.originScripts::add)
            }
            if (plan != null) {
                plan.customGenericOriginScript?.let { script ->
                    runCatching { WebViewCompat.addDocumentStartJavaScript(view, script, origins) }
                        .getOrNull()?.let(tab.originScripts::add)
                }
                plan.originPageScript?.let { script ->
                    runCatching { WebViewCompat.addDocumentStartJavaScript(view, script, origins) }
                        .getOrNull()?.let(tab.originScripts::add)
                }
            }
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
        if (tab.media.isNotEmpty()) {
            tab.media.clear()
            tab.mediaFrame = null
            events.mediaChanged()
        }
        tab.globalScripts.clear()
        tab.globalScriptsFor = null
        tab.originScripts.clear()
        tab.originScriptsFor = null
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

    /** A dead page may live on at the Internet Archive. Not for the archive itself. */
    private fun offerArchive(tab: Tab, raw: String): Boolean {
        val url = BrowserPolicy.webUrl(raw) ?: return false
        // The web archive has no copy of pages on this device or the home network.
        if (tab !== current || BrowserPolicy.site(url) == "archive.org" || BrowserPolicy.isLocal(url.host)) return false
        val archived = BrowserPolicy.webUrl("https://web.archive.org/web/2/" + url.newBuilder().fragment(null).build()) ?: return false
        tab.archiveFor = url
        record("Seite nicht erreichbar · " + url.host)
        events.notice(L("Seite nicht erreichbar – Archiv-Version?", "Page unavailable – archived copy?"), archived, lasting = true)
        return true
    }

    /** The https address to load instead of `url`, or `url` itself. */
    private fun httpsFirst(tab: Tab, url: HttpUrl): HttpUrl {
        if (!httpsOnly || BrowserPolicy.site(url) in httpSites) return url
        val secure = BrowserPolicy.httpsFirst(url) ?: return url
        tab.upgradedFrom = url
        return secure
    }

    /** https did not work for the page the user wanted over http: say so, and offer it unencrypted. */
    private fun httpsFailed(tab: Tab, view: WebView) {
        val plain = tab.upgradedFrom ?: return
        tab.upgradedFrom = null
        tab.failed = true
        record("Keine sichere Verbindung · " + plain.host)
        if (tab !== current) return
        events.noticeAction(
            L("${plain.host} bietet keine sichere Verbindung", "${plain.host} has no secure connection"),
            L("Trotzdem laden (unsicher)", "Load anyway (not secure)"), lasting = true,
        ) {
            if (tab.webView !== view) return@noticeAction
            httpSites += BrowserPolicy.site(plain)
            load(tab, view, plain)
        }
    }

    /** Video tools for the frame that played last: `speed`, `seek` (seconds) or `boost` (factor). */
    fun videoAction(action: String, value: Double) {
        val tab = current
        val call = JSONArray().put(action).put(value).toString()
        val frame = tab.mediaFrame
        if (frame != null) runCatching { frame.postMessage(call) }.onFailure { videoAnswer("none") }
        else tab.webView?.evaluateJavascript("window.pouVideo ? pouVideo(...$call) : 'none'") { result ->
            if (tab === current) videoAnswer(runCatching { JSONTokener(result).nextValue() as String }.getOrDefault("none"))
        }
    }

    private fun videoAnswer(answer: String) {
        val number = NumberFormat.getNumberInstance().apply { maximumFractionDigits = 2 }
        val value = answer.substringAfter(':', "").toDoubleOrNull()
        events.notice(when {
            answer.startsWith("speed:") && value != null -> L("Tempo ", "Speed ") + number.format(value) + "×"
            answer.startsWith("seek:") && value != null -> (if (value > 0) "+" else "−") + number.format(kotlin.math.abs(value)) + " s"
            answer.startsWith("boost:") && value != null -> L("Lautstärke ", "Volume ") + number.format(value * 100) + " %"
            answer == "boost-foreign" -> L("Lauter geht hier nicht: Ton kommt von fremdem Server", "Can't boost: sound comes from another server")
            else -> L("Kein Video gefunden", "No video found")
        })
    }

    /** Mutes or unmutes every player of the tab in front, frames included; players that start later follow. */
    fun toggleMute() {
        val tab = current
        tab.muted = !tab.muted
        val call = "[\"mute\",${tab.muted}]"
        for (frame in tab.media.keys) runCatching { frame.postMessage(call) }
        events.notice(if (tab.muted) L("Tab stumm", "Tab muted") else L("Ton an", "Sound on"))
    }

    /** The tab whose sound the media notification controls: one that plays, else the last one that did. */
    val mediaTab: Tab? get() = roster.firstOrNull { it.playing } ?: recent.firstOrNull { it.hasMedia && it in roster }

    /** Play or pause from the notification or the lock screen. */
    fun togglePlayback() {
        val frame = mediaTab?.let { tab -> tab.media.entries.firstOrNull { it.value }?.key ?: tab.mediaFrame } ?: return
        runCatching { frame.postMessage("[\"toggle\",0]") }
    }

    fun pausePlayback() {
        for (tab in roster) for ((frame, playing) in tab.media) if (playing) runCatching { frame.postMessage("[\"pause\",0]") }
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
            if (request.isForMainFrame && refused(tab, url)) return true
            if (!request.isForMainFrame) return false
            if (url.encodedPath.lowercase().endsWith(".ics")) {
                if (tab === current) {
                    record("Kalender-Datei blockiert · " + url.host)
                    events.notice(L("Kalender-Datei blockiert · ", "Calendar file blocked · ") + url.host)
                }
                return true
            }
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
            // A popup's first page counts as opened from its opener, for the filter lists' `$popup` rules.
            if (filteringAllowed(from) && blocker.blocksPage(url, from ?: tab.opener?.let { it.committed ?: it.address })) {
                if (tab === current) {
                    record("Von Filterliste blockiert · " + url.host)
                    events.notice(L("Von Filterliste blockiert · ", "Blocked by a filter list · ") + url.host, url)
                }
                return true
            }
            // An https page that sends back to http of the same host has no secure version.
            val upgraded = tab.upgradedFrom
            if (request.isRedirect && upgraded != null && url.scheme == "http" && url.host == upgraded.host && BrowserPolicy.site(url) !in httpSites) {
                httpsFailed(tab, view)
                return true
            }
            if (!request.isRedirect) tab.upgradedFrom = null
            httpsFirst(tab, url).takeIf { it != url }?.let {
                load(tab, view, it)
                return true
            }
            if (hasGesture && !request.isRedirect && request.method.equals("GET", ignoreCase = true)) {
                val cleaned = BrowserPolicy.cleanUrl(url)
                if (cleaned != url) {
                    load(tab, view, cleaned)
                    return true
                }
            }
            if (!request.isRedirect) tab.trustedChain = hasGesture
            prepare(tab, view, url)
            return false
        }

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            // Blocked sites first, whatever the ad blocker switch says. Main frames get here on reload and history too.
            blockedSite(request.url.host)?.let { site ->
                view.post {
                    if (tab.webView !== view) return@post
                    record("Gesperrte Seite blockiert · " + request.url.host)
                    if (request.isForMainFrame && tab === current) events.notice(L("Gesperrte Seite: $site", "Blocked site: $site"))
                }
                addRequest(tab, request, blocked = true)
                return WebResourceResponse(
                    "text/plain", "UTF-8", 403, "Forbidden",
                    mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(byteArrayOf()),
                )
            }
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
            val filtered = filteringAllowed(page) && !request.isForMainFrame
            val type = if (filtered) TrackerBlocker.typeOf(request) else FilterEngine.UNKNOWN
            // An embedded frame (a video player, an ad) gets the rules for its own host before it loads.
            if (documentStart && type == FilterEngine.FRAME) {
                val frame = BrowserPolicy.webUrl(request.url.toString())
                if (frame != null && tab.frames.add(TrackerBlocker.origin(frame))) view.post {
                    if (tab.webView !== view) return@post
                    val script = blocker.frameScript(frame) ?: return@post
                    runCatching { WebViewCompat.addDocumentStartJavaScript(view, script, setOf(TrackerBlocker.origin(frame))) }
                        .getOrNull()?.let(tab.originScripts::add)
                }
            }
            if (request.isForMainFrame) {
                tab.blocked.set(0)
                scheduleBlockedBadge()
            }
            val blocked = if (filtered) blocker.intercept(request, page, type) else null
            addRequest(tab, request, blocked != null)
            if (blocked != null) {
                tab.blocked.incrementAndGet()
                totalBlocked.incrementAndGet()
                scheduleBlockedBadge()
            }
            return blocked
        }

        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            val target = BrowserPolicy.webUrl(url) ?: return
            prepare(tab, view, target)
            if (tab.media.isNotEmpty() || tab.mediaFrame != null) {
                tab.media.clear()
                tab.mediaFrame = null
                events.mediaChanged()
            }
            tab.inspecting = false
            tab.console.clear()
            scheduleDevUpdate(tab)
            if (tab.picking) {
                tab.picking = false
                if (tab === current) events.clearNotice()
            }
            tab.archiveFor?.let {
                if (it == target) return@let
                tab.archiveFor = null
                if (tab === current) events.clearNotice()
            }
            tab.failed = false
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
            if (!tab.failed) tab.upgradedFrom = null
            if (!tab.failed && !tab.isPrivate) library.visited(target, tab.title)
            if (!documentStart && scriptsAllowed(target)) {
                view.evaluateJavascript(browserScript, null)
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
            if (!request.isForMainFrame) return
            tab.failed = true
            if (tab.upgradedFrom?.host == request.url.host && request.url.scheme == "https") return httpsFailed(tab, view)
            if (tab !== current) return
            tab.trustedChain = false
            record("Ladefehler " + error.errorCode + " · " + request.url.host.orEmpty())
            val gone = error.errorCode == ERROR_HOST_LOOKUP || error.errorCode == ERROR_CONNECT
            if (!gone || !offerArchive(tab, request.url.toString()))
                events.notice(L("Seite konnte nicht geladen werden", "The page could not be loaded"))
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            if (request.isForMainFrame && (response.statusCode == 404 || response.statusCode == 410))
                offerArchive(tab, request.url.toString())
        }

        override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String) {
            if (tab !== current) return handler.cancel()
            events.askLogin(host, realm) { login ->
                if (login != null && tab.webView === view) handler.proceed(login.first, login.second) else handler.cancel()
            }
        }

        /** As in Chrome: a warning with the reason for the page itself; images and scripts with bad certificates stay out. */
        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            val url = BrowserPolicy.webUrl(error.url)
            if (url != null && tab.upgradedFrom?.host == url.host) {
                handler.cancel()
                return httpsFailed(tab, view)
            }
            val page = tab.requested
            if (tab !== current || url == null || page == null || url.host != page.host) return handler.cancel()
            val reason = when (error.primaryError) {
                SslError.SSL_EXPIRED -> L("Das Zertifikat ist abgelaufen.", "The certificate has expired.")
                SslError.SSL_IDMISMATCH -> L("Das Zertifikat gilt für eine andere Adresse.", "The certificate is for another address.")
                SslError.SSL_NOTYETVALID -> L("Das Zertifikat gilt noch nicht.", "The certificate is not valid yet.")
                SslError.SSL_DATE_INVALID -> L("Das Datum des Zertifikats ist ungültig.", "The certificate's date is invalid.")
                SslError.SSL_UNTRUSTED -> L("Das Zertifikat stammt von keiner vertrauenswürdigen Stelle.", "The certificate is not from a trusted authority.")
                else -> L("Das Zertifikat ist ungültig.", "The certificate is invalid.")
            }
            record("Zertifikatsfehler · " + url.host)
            events.askCertificate(url.host, reason) { proceed ->
                if (proceed && tab.webView === view) handler.proceed() else handler.cancel()
            }
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            val reload = tab.reloadWhenGone
            tab.reloadWhenGone = false
            tab.askedUnresponsive = false
            tab.crashed = true
            tab.trustedChain = false
            dispose(tab)
            if (reload && tab === current) {
                mainThread.post { if (tab === current) reload() }
                return true
            }
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

        /** Site icons for the start page tiles; private tabs leave none behind. */
        override fun onReceivedIcon(view: WebView, icon: Bitmap) {
            if (tab.isPrivate || tab.failed) return
            val host = view.url?.let(BrowserPolicy::webUrl)?.host?.removePrefix("www.") ?: return
            runCatching {
                val file = iconFile(host)
                file.parentFile?.mkdirs()
                file.outputStream().use { icon.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
        }

        override fun onReceivedTitle(view: WebView, title: String) {
            tab.title = title.take(250)
            if (!tab.failed && !tab.isPrivate) view.url?.let(BrowserPolicy::webUrl)?.let { library.retitle(it, tab.title) }
            changed(tab)
        }

        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, message: android.os.Message): Boolean {
            // Allowed site: a tapped popup becomes a tab right after this one, in the opener's profile (a private
            // opener's too: private tabs share theirs, so the sign-in reaches the opener).
            if (tab === current && isUserGesture && popupsAllowed(tab.address)) {
                val popup = Tab(profile = tab.profile).also { it.opener = tab }
                roster.add(roster.indexOf(tab) + 1, popup)
                val child = makeWebView(popup)
                (message.obj as WebView.WebViewTransport).webView = child
                message.sendToTarget()
                record("Popup erlaubt")
                select(popup)
                return true
            }
            if (tab === current) {
                record("Popup blockiert")
                // A tapped link that wanted a new window can still be opened on purpose.
                events.notice(L("Popup blockiert", "Popup blocked"), tab.freshTap()?.takeIf { isUserGesture && !tab.tappedForm })
            }
            return false
        }

        /** `window.close()` from a popup this app opened. */
        override fun onCloseWindow(window: WebView) {
            if (tab.webView === window) close(tab)
        }

        /** As in Chrome: asked every time, only for the tab in front, nothing remembered. */
        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
            if (tab !== current) return callback.invoke(origin, false, false)
            val location = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            events.askSitePermission(Uri.parse(origin).host ?: origin, L("deinen Standort", "your location"), location) { allowed ->
                callback.invoke(origin, allowed && tab === current, false)
            }
        }

        // DRM (Netflix, Spotify) without asking; camera and microphone after the user and Android allowed them.
        override fun onPermissionRequest(request: PermissionRequest) {
            val drm = PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID
            val camera = PermissionRequest.RESOURCE_VIDEO_CAPTURE in request.resources
            val microphone = PermissionRequest.RESOURCE_AUDIO_CAPTURE in request.resources
            fun answer(allowed: Boolean) {
                val granted = listOfNotNull(
                    // Not in private tabs: the DRM device ID would tie the private visit to the normal ones.
                    drm.takeIf { it in request.resources && !tab.isPrivate && tab === current },
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE.takeIf { allowed && camera },
                    PermissionRequest.RESOURCE_AUDIO_CAPTURE.takeIf { allowed && microphone },
                )
                // Throws when the page already went away and WebView answered the request itself.
                runCatching { if (granted.isEmpty()) request.deny() else request.grant(granted.toTypedArray()) }
            }
            if (!camera && !microphone || tab !== current) return answer(false)
            val what = when {
                camera && microphone -> L("deine Kamera und dein Mikrofon", "your camera and microphone")
                camera -> L("deine Kamera", "your camera")
                else -> L("dein Mikrofon", "your microphone")
            }
            val needed = listOfNotNull(Manifest.permission.CAMERA.takeIf { camera }, Manifest.permission.RECORD_AUDIO.takeIf { microphone })
            events.askSitePermission(request.origin.host ?: request.origin.toString(), what, needed.toTypedArray()) { allowed ->
                answer(allowed && tab === current)
            }
        }

        override fun onShowFileChooser(view: WebView, done: ValueCallback<Array<Uri>?>, params: FileChooserParams) =
            tab === current && events.pickFiles(params, done)

        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
            val level = when (message.messageLevel()) {
                ConsoleMessage.MessageLevel.ERROR -> "error"
                ConsoleMessage.MessageLevel.WARNING -> "warn"
                ConsoleMessage.MessageLevel.DEBUG -> "debug"
                else -> "log"
            }
            val place = if (level == "error" || level == "warn")
                " (" + message.sourceId().substringAfterLast('/').ifEmpty { "?" } + ":" + message.lineNumber() + ")" else ""
            addConsole(tab, DevEntry(level, message.message().take(4000) + place))
            return false
        }

        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            if (tab === current) events.showFullscreen(view, callback) else callback.onCustomViewHidden()
        }

        override fun onHideCustomView() {
            if (tab === current) events.hideFullscreen()
        }
    }

    /** A shared page script with its app-side names, which no page and no other site can read. */
    private fun pageWrapped(file: String) = "(() => {\nconst pouKey = \"$SESSION_KEY\";\n" +
        "const pouTell = (kind, text) => { try { pouPrivacy.postMessage(kind + \"\\n\" + text); } catch (e) {} };\n$file\n})();"

    companion object {
        /** Seeds the fingerprint noise: new at every app start, so sites cannot link visits across runs either. */
        private val SESSION_KEY = UUID.randomUUID().toString().replace("-", "")
        /**
         * WebRTC in Android's WebView hands pages the phone's own network address (192.168.…) as a "host" candidate,
         * where Chrome shows a random name.local. Those candidates are dropped from the events and the descriptions;
         * calls still connect over the public and relay candidates.
         * shortcut: getStats() still lists them; patch it too if a fingerprinting test reads it.
         */
        private val RTC_SCRIPT = """
            (() => {
              const Peer = window.RTCPeerConnection;
              if (!Peer || Peer.__pouHosts) return;
              const raw = line => {
                const parts = String(line || '').split(' ');
                const at = parts.indexOf('typ');
                return at > 0 && parts[at + 1] === 'host' && !/\.local${'$'}/i.test(parts[at - 2] || '');
              };
              const clean = description => !description || !description.sdp ? description : new RTCSessionDescription({
                type: description.type, sdp: description.sdp.split(/\r\n/).filter(line => !(line.startsWith('a=candidate:') && raw(line))).join('\r\n'),
              });
              const Hidden = function (...args) {
                const peer = new Peer(...args);
                peer.addEventListener('icecandidate', event => { if (event.candidate && raw(event.candidate.candidate)) event.stopImmediatePropagation(); });
                return peer;
              };
              Hidden.prototype = Peer.prototype;
              Object.setPrototypeOf(Hidden, Peer);
              Object.defineProperty(Hidden, '__pouHosts', { value: true });
              for (const name of ['localDescription', 'currentLocalDescription', 'pendingLocalDescription']) {
                const own = Object.getOwnPropertyDescriptor(Peer.prototype, name);
                if (own && own.get) Object.defineProperty(Peer.prototype, name, { get() { return clean(own.get.call(this)); }, configurable: true });
              }
              window.RTCPeerConnection = Hidden;
              if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = Hidden;
            })();
        """.trimIndent()
        /** Reports playing and paused players to the app and runs its video tools, mute and play/pause in that frame. */
        private val PLAY_SCRIPT = """
            (() => {
              const port = window.pouPlay;
              if (!port) return;
              try { delete window.pouPlay; } catch (_) {}
              let muted = false, last = null;
              const send = data => { try { port.postMessage(JSON.stringify(data)); } catch (_) {} };
              const players = () => [...document.querySelectorAll('video, audio')];
              addEventListener('play', event => {
                const media = event.composedPath()[0];
                if (!(media instanceof HTMLMediaElement)) return;
                last = media;
                if (muted) media.muted = true;
                send({ play: true });
              }, true);
              for (const type of ['pause', 'ended']) addEventListener(type, event => {
                if (event.composedPath()[0] instanceof HTMLMediaElement) send({ play: players().some(media => !media.paused) || (last && !last.paused) });
              }, true);
              port.onmessage = event => {
                const [action, value] = JSON.parse(event.data);
                if (action === 'mute') {
                  muted = value;
                  for (const media of players().concat(last ? [last] : [])) media.muted = value;
                } else if (action === 'toggle') {
                  if (last) last.paused ? last.play().catch(() => {}) : last.pause();
                } else if (action === 'pause') {
                  if (last) last.pause();
                } else {
                  send({ answer: typeof window.pouVideo === 'function' ? window.pouVideo(action, value) : 'none' });
                }
              };
            })();
        """.trimIndent()
        private val linkAndImageHits = setOf(
            WebView.HitTestResult.SRC_ANCHOR_TYPE, WebView.HitTestResult.IMAGE_TYPE, WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE,
        )
        /** The key under which `evaluate` returns a thrown error. */
        private const val EVAL_ERROR = "__pouEvalError"
        private val SHARE_SCRIPT = """
            const send = window.pouShare;
            try { delete window.pouShare; } catch (_) {}
            if (window === top && !navigator.share && send) {
              navigator.share = function (data) {
                data = data || {};
                if (data.files && data.files.length) return Promise.reject(new DOMException('Files cannot be shared', 'NotAllowedError'));
                if (!navigator.userActivation.isActive) return Promise.reject(new DOMException('Needs a tap', 'NotAllowedError'));
                const url = data.url ? new URL(data.url, location.href).href : '';
                if (!url && !data.text && !data.title) return Promise.reject(new TypeError('Nothing to share'));
                send.postMessage(JSON.stringify({ title: String(data.title || ''), text: String(data.text || ''), url: url }));
                return Promise.resolve();
              };
              navigator.canShare = function (data) { return !!data && !(data.files && data.files.length) && !!(data.url || data.text || data.title); };
            }
        """.trimIndent()
        private const val DESKTOP_USER_AGENT =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    }
}
