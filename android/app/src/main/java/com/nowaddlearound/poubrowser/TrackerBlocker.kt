package com.nowaddlearound.poubrowser

import android.content.Context
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayInputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import java.util.Properties
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The ad blocker: downloads the filter lists the iOS app uses, keeps them as a [FilterEngine]
 * (backed by a binary snapshot on disk for fast cold launches), drops matching requests and builds
 * the scripts that hide ad areas and defuse ad scripts inside pages.
 */
internal class TrackerBlocker(private val context: Context) {
    private class FilterList(val name: String, val days: Long, vararg val addresses: String)

    private val folder = File(context.filesDir, "filters")
    private val manifest = File(folder, "installed.properties")
    private val preferences = context.getSharedPreferences("tracker-filter", Context.MODE_PRIVATE)
    private val worker = Executors.newSingleThreadExecutor()
    private val busy = AtomicBoolean()
    private val client = OkHttpClient.Builder()
        .followRedirects(true)
        .followSslRedirects(false)
        .addNetworkInterceptor { chain ->
            val request = chain.request()
            if (!request.url.isHttps) throw IOException("HTTPS required")
            chain.proceed(request)
        }
        .callTimeout(40, TimeUnit.SECONDS)
        .build()

    @Volatile private var engine = FilterEngine.parse(seed.lineSequence())
    /** Opens once the lists saved by the last run are read, so the first page after a start is filtered too. */
    private val ready = CountDownLatch(1)
    /** Goes up with every new set of rules: tabs use it to notice that their page scripts are out of date. */
    @Volatile var version = 0
        private set
    @Volatile var status = L("Werbeblocker startet …", "Ad blocker starting …")
        private set
    @Volatile private var exempt = "" to 0

    private val waiting = ArrayList<() -> Unit>()

    /**
     * Runs `action` once the saved lists are read: right away when they already are, else from the
     * worker thread. The page a tab restores at launch waits for this, so it is filtered from its first request.
     */
    fun whenReady(action: () -> Unit) {
        synchronized(waiting) {
            if (ready.count > 0) {
                waiting.add(action)
                return
            }
        }
        action()
    }

    private fun opened() {
        val actions = synchronized(waiting) {
            ready.countDown()
            ArrayList(waiting).also { waiting.clear() }
        }
        actions.forEach { it() }
    }

    /** AdGuard's scriptlets as function source, under every name the lists use. */
    private val scriptlets: Map<String, String> by lazy {
        val byName = HashMap<String, String>()
        runCatching {
            val entries = JSONObject(asset("scriptlets.corelibs.json")).getJSONArray("scriptlets")
            for (index in 0 until entries.length()) {
                val entry = entries.getJSONObject(index)
                val names = entry.getJSONArray("names")
                for (name in 0 until names.length()) byName[names.getString(name)] = entry.getString("scriptlet")
            }
        }
        byName
    }
    private val extendedCss by lazy { asset("extended-css.min.js") }

    /** Dark Reader (MIT licence), kept inside a function so pages get no `DarkReader` object of their own to find. */
    val darkScript: String by lazy {
        "(() => {\nconst exports = {}, module = {};\n" + asset("darkreader.js") +
            "\ntry { exports.setFetchMethod(window.fetch); exports.enable({ brightness: 100, contrast: 95, sepia: 0 }); } catch (error) {}\n})();"
    }

    private fun asset(name: String) = context.assets.open(name).bufferedReader().use { it.readText() }

    /** `page` is the page the request belongs to; null for service workers, which get the page-independent rules only. */
    fun intercept(request: WebResourceRequest, page: HttpUrl? = null, type: Int = typeOf(request)): WebResourceResponse? {
        val scheme = request.url.scheme
        if (request.isForMainFrame || (scheme != "http" && scheme != "https")) return null
        val host = request.url.host?.lowercase()?.trimEnd('.') ?: return null
        ready.await(3, TimeUnit.SECONDS)
        if (page != null && exemptions(page) and FilterEngine.EXEMPT_ALL != 0) return null
        // Rules speak about the document a request comes from. Inside an embedded frame (a video player)
        // that is the frame, which the Referer header names, not the page around it.
        val from = request.requestHeaders["Referer"]?.let(BrowserPolicy::webUrl)?.host ?: page?.host
        if (!engine.blocks(request.url.toString(), host, from, type)) return null
        // To see what gets dropped on a page that breaks: adb shell setprop log.tag.PouBlock DEBUG
        if (Log.isLoggable("PouBlock", Log.DEBUG)) Log.d("PouBlock", type.toString() + " " + request.url + " from " + from)
        return WebResourceResponse(
            "text/plain", "UTF-8", 403, "Blocked by PouBrowser",
            mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(byteArrayOf()),
        )
    }

    /** Whether a list bans the page a tab is being sent to (malware and ad landing pages). */
    fun blocksPage(to: HttpUrl, from: HttpUrl?): Boolean =
        (from == null || exemptions(from) and FilterEngine.EXEMPT_ALL == 0) &&
            engine.blocksPage(to.toString(), to.host, from?.host)

    /**
     * Global hide-everywhere CSS script (`setOf("*")`) shared across cross-site navigations, plus
     * per-page override state so standard pages do not re-register 1+ MB of CSS over JNI on every click.
     */
    class ScriptPlan(
        val useWildcardGeneric: Boolean,
        val customGenericOriginScript: String?,
        val originPageScript: String?,
    )

    /**
     * The last few plans, for the next navigation on the same host and for switching between tabs. On a host
     * with `#@#` exceptions (google.com, youtube.com, ebay.de) the plan rebuilds the whole generic sheet,
     * about 650 KB and 10-30 ms on the UI thread, two or three times per page load.
     */
    private val planCache = object : LinkedHashMap<String, ScriptPlan>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ScriptPlan>) = size > 4
    }
    private var planEngine: FilterEngine? = null

    fun planScripts(page: HttpUrl): ScriptPlan {
        val exempt = exemptions(page)
        val engine = engine
        val key = "${page.host}|$exempt"
        synchronized(planCache) {
            if (planEngine !== engine) { planCache.clear(); planEngine = engine }
            planCache[key]?.let { return it }
        }
        return plan(page, engine, exempt).also { synchronized(planCache) { if (planEngine === engine) planCache[key] = it } }
    }

    private fun plan(page: HttpUrl, engine: FilterEngine, exempt: Int): ScriptPlan {
        if (exempt and (FilterEngine.EXEMPT_ALL or FilterEngine.EXEMPT_COSMETIC) != 0) {
            return ScriptPlan(useWildcardGeneric = false, customGenericOriginScript = null, originPageScript = null)
        }
        val hostRules = frameScript(page)
        if (exempt and FilterEngine.EXEMPT_GENERIC != 0) {
            return ScriptPlan(useWildcardGeneric = false, customGenericOriginScript = null, originPageScript = hostRules)
        }
        val ownGeneric = engine.genericCssFor(page.host)
        return if (ownGeneric != null) {
            ScriptPlan(useWildcardGeneric = false, customGenericOriginScript = styleScript(ownGeneric), originPageScript = hostRules)
        } else {
            ScriptPlan(useWildcardGeneric = true, customGenericOriginScript = null, originPageScript = hostRules)
        }
    }

    /** Scriptlets and styles for one document, or null when no rule names its host. */
    fun frameScript(frame: HttpUrl): String? {
        val rules = engine.page(frame.host)
        if (rules.isEmpty) return null
        val parts = ArrayList<String>()
        // Scriptlets first: they have to be in place before the page's own scripts run.
        for (scriptlet in rules.scriptlets) {
            val function = scriptlets[scriptlet.name] ?: scriptlets[scriptlet.name + ".js"] ?: continue
            val args = scriptlet.args.joinToString(",", "[", "]") { quote(it) }
            parts.add("try{($function)({name:${quote(scriptlet.name)},args:$args,engine:\"corelibs\",version:\"pou\",verbose:false},$args)}catch(e){}")
        }
        for (script in rules.js) parts.add("try{(function(){$script\n})()}catch(e){}")
        if (rules.css.isNotEmpty()) parts.add(styleScript(rules.css.joinToString("\n")))
        if (rules.extended.isNotEmpty()) {
            val list = rules.extended.joinToString(",", "[", "]") { quote(it) }
            // One bad rule must not cost the page the others, so each is tried alone first.
            parts.add(
                "try{(function(){$extendedCss\nconst rules=$list.filter(rule=>{try{new ExtendedCss({cssRules:[rule]});return true}catch(e){return false}});" +
                    "const run=()=>{try{new ExtendedCss({cssRules:rules}).apply()}catch(e){}};" +
                    "if(document.readyState==='loading')addEventListener('DOMContentLoaded',run);else run()})()}catch(e){}",
            )
        }
        return parts.joinToString("\n").takeIf { it.isNotEmpty() }
    }

    private var genericFor = -1
    private var generic = ""
    @Synchronized fun genericScript(): String {
        if (genericFor != version) {
            generic = styleScript(engine.genericCss)
            genericFor = version
        }
        return generic
    }

    /** Adds a style sheet as early as the document allows: at document start there may be no root element yet. */
    fun styleScript(css: String) =
        "(()=>{const s=document.createElement('style');s.textContent=${quote(css)};" +
            "const put=()=>{const r=document.head||document.documentElement;if(r)r.appendChild(s);return !!r};" +
            "if(!put())new MutationObserver((m,o)=>{if(put())o.disconnect()}).observe(document,{childList:true,subtree:true})})();"

    private fun exemptions(page: HttpUrl): Int {
        val url = page.toString()
        val known = exempt
        if (known.first == url) return known.second
        return engine.exemptions(url, page.host).also { exempt = url to it }
    }

    fun refresh(force: Boolean = false) {
        if (!busy.compareAndSet(false, true)) return
        worker.execute {
            try {
                folder.mkdirs()
                val installed = Properties()
                if (manifest.exists()) manifest.inputStream().use(installed::load)
                if (ready.count > 0) {
                    restore(installed)
                    opened()
                }
                val now = System.currentTimeMillis()
                val due = lists.filter { list ->
                    val age = now - preferences.getLong("updated." + list.name, 0)
                    val directory = activeDirectory(list, installed)
                    force || directory == null || list.addresses.indices.any { !File(directory, "$it.txt").isFile } ||
                        age !in 0 until TimeUnit.DAYS.toMillis(list.days)
                }
                if (due.isEmpty()) return@execute
                // An interrupted manual refresh must be retried even if its original interval has not expired.
                val pending = preferences.edit()
                due.forEach { pending.remove("updated." + it.name) }
                if (!pending.commit()) throw IOException("Could not schedule filter update")
                status = L("Filterlisten werden geladen …", "Loading filter lists …")
                val pool = Executors.newFixedThreadPool(minOf(due.size, 3))
                val results = try {
                    pool.invokeAll(due.map { list -> Callable {
                        val slot = if (installed.getProperty(list.name) == "a") "b" else "a"
                        val changed = try {
                            FilterSources.stage(client, list.addresses.toList(), activeDirectory(list, installed),
                                File(folder, list.name + "-" + slot))
                        } catch (_: IOException) {
                            null
                        }
                        Triple(list, slot, changed)
                    } }).map { it.get() }
                } finally {
                    pool.shutdown()
                }

                val next = Properties().also { it.putAll(installed) }
                val fresh = preferences.edit()
                for ((list, slot, changed) in results) {
                    if (changed == true) next.setProperty(list.name, slot)
                    if (changed != null) fresh.putLong("updated." + list.name, now)
                }
                if (next != installed) {
                    next.setProperty("revision", UUID.randomUUID().toString())
                    val built = buildEngine(next) ?: throw IOException("Missing filter sources")
                    next.setProperty("snapshot", if (installed.getProperty("snapshot") == "a") "b" else "a")
                    writeSnapshot(built, stamp(next), snapshot(next))
                    val stage = File(folder, "installed.next")
                    stage.outputStream().use { next.store(it, null) }
                    Files.move(stage.toPath(), manifest.toPath(), ATOMIC_MOVE, REPLACE_EXISTING)
                    activate(built)
                }
                fresh.apply()
                if (version > 0) updateStatusFromCurrentEngine()
                else status = L("Werbeblocker: nur Grundschutz", "Ad blocker: basic protection only")
                val failed = results.filter { it.third == null }
                if (failed.isNotEmpty()) status += L(" · Aktualisierung fehlgeschlagen: ", " · Update failed: ") +
                    failed.joinToString { it.first.name }
            } catch (error: Exception) {
                status = L("Filteraktualisierung fehlgeschlagen", "Filter update failed")
                Log.w("PouBlock", status, error)
            } finally {
                opened()
                busy.set(false)
            }
        }
    }

    private fun activeDirectory(list: FilterList, installed: Properties): File? =
        installed.getProperty(list.name)?.takeIf { it == "a" || it == "b" }?.let { File(folder, list.name + "-" + it) }

    private fun legacy(list: FilterList) = File(folder, list.name + ".txt")

    private fun stamp(installed: Properties): String = buildString {
        installed.getProperty("revision")?.let { append(it).append(';') }
        for (list in lists) {
            if (activeDirectory(list, installed) != null) continue
            val saved = legacy(list)
            if (saved.exists()) append(list.name).append(':').append(saved.length()).append(':').append(saved.lastModified()).append(';')
        }
    }

    private fun buildEngine(installed: Properties): FilterEngine? {
        val builder = FilterEngine.Builder()
        seed.lineSequence().forEach(builder::add)
        var found = false
        for (list in lists) {
            val dir = activeDirectory(list, installed)
            if (dir != null) FilterSources.read(dir, list.addresses.toList(), builder::add)
            else if (legacy(list).isFile) legacy(list).bufferedReader().useLines { it.forEach(builder::add) }
            else continue
            found = true
        }
        return if (found) builder.build() else null
    }

    private fun activate(built: FilterEngine) {
        engine = built
        exempt = "" to 0
        version++
        updateStatusFromCurrentEngine()
    }

    private fun snapshot(installed: Properties) = when (installed.getProperty("snapshot")) {
        "a" -> File(folder, "engine-a.bin")
        "b" -> File(folder, "engine-b.bin")
        else -> File(folder, "engine.bin")
    }

    private fun restore(installed: Properties) {
        val stamp = stamp(installed)
        if (stamp.isEmpty()) return
        val cached = runCatching {
            DataInputStream(BufferedInputStream(snapshot(installed).inputStream())).use { FilterEngine.readFrom(it, stamp) }
        }.getOrNull()
        if (cached != null) {
            activate(cached)
        } else {
            // A missing source must not stop the download that repairs it.
            try {
                buildEngine(installed)?.let { built ->
                    activate(built)
                    writeSnapshot(built, stamp, snapshot(installed))
                }
            } catch (error: IOException) {
                Log.w("PouBlock", "Could not restore filter snapshot", error)
            }
        }
    }

    private fun writeSnapshot(built: FilterEngine, stamp: String, destination: File) {
        val stage = File(folder, "engine.next")
        DataOutputStream(BufferedOutputStream(stage.outputStream())).use { built.writeTo(it, stamp) }
        Files.move(stage.toPath(), destination.toPath(), ATOMIC_MOVE, REPLACE_EXISTING)
    }

    private fun updateStatusFromCurrentEngine() {
        status = L("Werbeblocker aktiv · ", "Ad blocker active · ") +
            java.text.NumberFormat.getIntegerInstance().format(engine.count) + L(" Regeln", " rules")
    }

    companion object {
        // The lists of the iOS app, in their Android editions where AdGuard has one.
        private val lists = listOf(
            FilterList("adguard-base", 3, "https://filters.adtidy.org/android/filters/2.txt"),
            FilterList("adguard-mobile", 3, "https://filters.adtidy.org/android/filters/11.txt"),
            FilterList("adguard-popups", 3, "https://filters.adtidy.org/android/filters/19.txt"),
            // Mostly hiding rules and click-away scriptlets: they reach pages through the same page scripts.
            FilterList("adguard-cookies", 3, "https://filters.adtidy.org/android/filters/18.txt"),
            FilterList("easyprivacy", 3, "https://easylist.to/easylist/easyprivacy.txt"),
            // "Quick fixes" changes several times a day, hence the daily refresh.
            FilterList(
                "ublock", 1,
                "https://ublockorigin.github.io/uAssets/filters/filters.min.txt",
                "https://ublockorigin.github.io/uAssets/filters/badware.min.txt",
                "https://ublockorigin.github.io/uAssets/filters/privacy.min.txt",
                "https://ublockorigin.github.io/uAssets/filters/quick-fixes.min.txt",
                "https://ublockorigin.github.io/uAssets/filters/unbreak.min.txt",
            ),
        )

        private val seed = """
            ||adnxs.com^
            ||adsystem.com^
            ||advertising.com^
            ||amazon-adsystem.com^
            ||analytics.google.com^
            ||app-measurement.com^
            ||criteo.com^
            ||doubleclick.net^
            ||googleadservices.com^
            ||googlesyndication.com^
            ||googletagmanager.com^
            ||moatads.com^
            ||outbrain.com^
            ||pubmatic.com^
            ||scorecardresearch.com^
            ||taboola.com^
        """.trimIndent()

        private val images = setOf("png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp")
        private val fonts = setOf("woff", "woff2", "ttf", "otf", "eot")
        private val media = setOf("mp4", "webm", "m3u8", "ts", "m4s", "mpd", "mp3", "m4a", "aac", "ogg")

        /** WebView does not say what a request is for: the Accept header and the file ending have to do. */
        fun typeOf(request: WebResourceRequest): Int {
            val accept = (request.requestHeaders["Accept"] ?: request.requestHeaders["accept"]).orEmpty()
            if (accept.startsWith("text/html")) return FilterEngine.FRAME
            if (accept.startsWith("image/")) return FilterEngine.IMAGE
            if (accept.startsWith("text/css")) return FilterEngine.CSS
            if (accept.startsWith("application/json") || accept.startsWith("text/event-stream")) return FilterEngine.XHR
            if (request.requestHeaders.containsKey("Range")) return FilterEngine.MEDIA
            return typeOfEnding(request.url.path.orEmpty())
        }

        fun typeOfEnding(path: String): Int {
            val ending = path.substringBefore('?').substringAfterLast('/').substringAfterLast('.', "").lowercase()
            return when (ending) {
                "js", "mjs" -> FilterEngine.SCRIPT
                "css" -> FilterEngine.CSS
                "json", "xml", "vtt", "srt", "ass", "ssa", "txt" -> FilterEngine.XHR
                in images -> FilterEngine.IMAGE
                in fonts -> FilterEngine.FONT
                in media -> FilterEngine.MEDIA
                else -> FilterEngine.UNKNOWN
            }
        }

        /** The form WebView wants for "run this script on that site only". */
        fun origin(url: HttpUrl): String {
            val host = if (':' in url.host) "[" + url.host + "]" else url.host
            val standard = if (url.isHttps) 443 else 80
            return url.scheme + "://" + host + if (url.port == standard) "" else ":" + url.port
        }

        /** A JavaScript string literal. */
        fun quote(text: String): String {
            val out = StringBuilder(text.length + 16).append('"')
            for (char in text) when (char) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '<' -> out.append("\\u003c")
                '\u2028' -> out.append("\\u2028")
                '\u2029' -> out.append("\\u2029")
                else -> if (char < ' ') out.append(String.format("\\u%04x", char.code)) else out.append(char)
            }
            return out.append('"').toString()
        }
    }
}
