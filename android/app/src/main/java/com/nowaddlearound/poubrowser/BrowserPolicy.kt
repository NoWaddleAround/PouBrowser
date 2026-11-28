package com.nowaddlearound.poubrowser

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

internal object BrowserPolicy {
    class SearchEngine(val name: String, val prefix: String)

    /** The first is the default. The typed text goes at the end of `prefix`. */
    val searchEngines = listOf(
        SearchEngine("DuckDuckGo", "https://duckduckgo.com/?q="),
        SearchEngine("Google", "https://www.google.com/search?q="),
        SearchEngine("Brave Search", "https://search.brave.com/search?q="),
        SearchEngine("Startpage", "https://www.startpage.com/sp/search?query="),
        SearchEngine("Ecosia", "https://www.ecosia.org/search?q="),
        SearchEngine("Bing", "https://www.bing.com/search?q="),
    )
    private val webScheme = Regex("^https?://", RegexOption.IGNORE_CASE)
    private val otherScheme = Regex("^[a-z][a-z0-9+.-]*:", RegexOption.IGNORE_CASE)
    private val trackingParams = setOf(
        "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
        "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid",
        "twclid", "ttclid", "yclid", "mc_eid", "igshid", "_hsenc", "_hsmi", "mkt_tok",
    )

    fun webUrl(raw: String): HttpUrl? {
        if (!webScheme.containsMatchIn(raw) || raw.any { it == '\\' || it.isISOControl() }) return null
        return raw.toHttpUrlOrNull()?.takeIf { it.username.isEmpty() && it.password.isEmpty() }
    }

    /**
     * Bounce links that only pass the visitor on, as Brave's debouncing skips them: host test, path test and the
     * parameter that holds the real address.
     */
    private class Bounce(val host: (String) -> Boolean, val path: (String) -> Boolean, val parameters: List<String>)
    private val google = Regex("""^(www\.)?google\.[a-z.]+$""")
    private val bounces = listOf(
        Bounce({ google.matches(it) }, { it == "/url" }, listOf("q", "url")),
        Bounce({ it == "l.facebook.com" || it == "lm.facebook.com" }, { it == "/l.php" }, listOf("u")),
        Bounce({ it == "l.instagram.com" }, { true }, listOf("u")),
        Bounce({ it == "out.reddit.com" }, { true }, listOf("url")),
        Bounce({ it == "youtube.com" || it == "www.youtube.com" || it == "m.youtube.com" }, { it == "/redirect" }, listOf("q")),
        Bounce({ it.endsWith(".safelinks.protection.outlook.com") }, { true }, listOf("url")),
        Bounce({ it == "steamcommunity.com" }, { it.startsWith("/linkfilter") }, listOf("url", "u")),
        Bounce({ it == "vk.com" || it == "m.vk.com" }, { it == "/away.php" }, listOf("to")),
        Bounce({ it == "slack-redir.net" }, { it == "/link" }, listOf("url")),
    )

    /** The address a bounce link passes on to, or null when `url` is none. */
    fun unbounced(url: HttpUrl): HttpUrl? {
        val host = url.host.lowercase()
        val path = url.encodedPath.lowercase()
        val bounce = bounces.firstOrNull { it.host(host) && it.path(path) } ?: return null
        return bounce.parameters.firstNotNullOfOrNull { name -> url.queryParameter(name)?.trim()?.let(::webUrl) }
    }

    /** Strips known ad and campaign click-ID parameters while leaving login/OAuth callbacks untouched. */
    fun cleanUrl(url: HttpUrl): HttpUrl {
        if (url.querySize == 0) return url
        unbounced(url)?.let { return cleanUrl(it) }
        val lowerPath = url.encodedPath.lowercase()
        if ("oauth" in lowerPath || "callback" in lowerPath || "login" in lowerPath ||
            "signin" in lowerPath || "authorize" in lowerPath || "sso" in lowerPath
        ) return url
        var stripped = false
        val builder = url.newBuilder().query(null)
        for (index in 0 until url.querySize) {
            val name = url.queryParameterName(index)
            if (name.lowercase() in trackingParams) {
                stripped = true
            } else {
                builder.addQueryParameter(name, url.queryParameterValue(index))
            }
        }
        return if (stripped) builder.build() else url
    }

    fun searchUrl(query: String, engine: SearchEngine = searchEngines[0]): HttpUrl {
        val base = engine.prefix.toHttpUrlOrNull()!!
        return base.newBuilder().setQueryParameter(base.queryParameterName(base.querySize - 1), query).build()
    }

    fun destination(raw: String, engine: SearchEngine = searchEngines[0]): HttpUrl? {
        val input = raw.trim()
        if (input.isEmpty()) return null
        if (webScheme.containsMatchIn(input)) return webUrl(input)?.let(::cleanUrl)
        if (input.contains("://")) return null
        val authority = input.takeWhile { it !in "/?#" }
        val looksLikeHost = authority.contains('.') || authority.startsWith('[') ||
            authority.substringBefore(':').equals("localhost", ignoreCase = true)
        if (looksLikeHost && input.none(Char::isWhitespace)) {
            // Servers on this device or the home network rarely speak HTTPS, as in Chrome's address bar.
            val scheme = if (webUrl("http://$input")?.let { isLocal(it.host) } == true) "http" else "https"
            return webUrl("$scheme://$input")?.let(::cleanUrl)
        }
        if (otherScheme.containsMatchIn(input) && input.none(Char::isWhitespace)) return null
        return searchUrl(input, engine)
    }

    /**
     * Whether a navigation goes where the user tapped. A link must match up to the fragment. A form
     * adds its fields as the query, so there only the page counts.
     */
    fun sameTarget(tapped: HttpUrl, to: HttpUrl, form: Boolean): Boolean {
        val a = tapped.newBuilder().fragment(null)
        val b = to.newBuilder().fragment(null)
        if (form) {
            a.query(null)
            b.query(null)
        }
        return a.build() == b.build()
    }

    /**
     * Cookie lines that expire every cookie named in `header` (a `Cookie` header as CookieManager gives it),
     * once host-only and once for the host and each parent domain up to `site`.
     * shortcut: only cookies with `Path=/` are matched; others need the platform's per-site delete.
     */
    fun expiringCookies(header: String?, host: String, site: String): List<String> {
        val names = header.orEmpty().split(';').map { it.substringBefore('=').trim() }.filter { it.isNotEmpty() }.distinct()
        val domains = generateSequence(host) { it.substringAfter('.', "") }.takeWhile { it == site || it.endsWith(".$site") }
        val scopes = listOf("") + domains.map { "; Domain=$it" }
        return names.flatMap { name -> scopes.map { "$name=; Max-Age=0; Path=/; Secure$it" } }
    }

    /** One rule per selector, so a selector the browser cannot parse does not void the others. */
    fun hidingCss(selectors: Collection<String>): String =
        selectors.filter { it.isNotBlank() && '{' !in it && '}' !in it }.sorted().joinToString("\n") { "$it { display: none !important }" }

    /**
     * A link that opens `url` with `selected` marked (Chrome's and Safari's "Copy link to highlight"):
     * short selections whole, longer ones by their first and last five words.
     */
    fun textFragment(url: HttpUrl, selected: String): String? {
        val words = selected.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (words.isEmpty()) return null
        val whole = words.joinToString(" ")
        val directive = if (whole.length <= 300 && words.size <= 10) encodeFragment(whole)
            else encodeFragment(words.take(5).joinToString(" ")) + "," + encodeFragment(words.takeLast(5).joinToString(" "))
        return url.newBuilder().fragment(null).build().toString() + "#:~:text=" + directive
    }

    /** Percent-encoding for a text directive: only letters, digits and `._~` stay; `-`, `,` and `&` have meaning there. */
    private fun encodeFragment(text: String) = buildString {
        for (byte in text.toByteArray(Charsets.UTF_8)) {
            val c = byte.toInt() and 0xFF
            if (c in 'a'.code..'z'.code || c in 'A'.code..'Z'.code || c in '0'.code..'9'.code || c.toChar() in "._~") append(c.toChar())
            else append('%').append("0123456789ABCDEF"[c shr 4]).append("0123456789ABCDEF"[c and 15])
        }
    }

    /**
     * The https address to try first for an http page, as in Chrome's HTTPS-First mode; null for the home
     * network, single names ("router") and plain IP addresses, which rarely have certificates.
     */
    fun httpsFirst(url: HttpUrl): HttpUrl? {
        if (url.scheme != "http" || url.port != 80 || isLocal(url.host) || '.' !in url.host ||
            url.host.all { it.isDigit() || it == '.' } || ':' in url.host) return null
        return url.newBuilder().scheme("https").build()
    }

    /** Text in pieces the speech engine takes (`limit` characters), cut at paragraph or sentence ends where possible. */
    fun speechPieces(text: String, limit: Int): List<String> {
        val pieces = mutableListOf<String>()
        var rest = text.trim()
        while (rest.isNotEmpty()) {
            if (rest.length <= limit) {
                pieces += rest
                break
            }
            val window = rest.substring(0, limit)
            val cut = listOf(window.lastIndexOf('\n'), window.lastIndexOf(". "), window.lastIndexOf(' ')).firstOrNull { it > limit / 2 } ?: limit
            val end = if (cut == limit) limit else cut + 1
            pieces += rest.substring(0, end).trim()
            rest = rest.substring(end).trim()
        }
        return pieces.filter { it.isNotEmpty() }
    }

    fun site(url: HttpUrl): String = url.topPrivateDomain() ?: url.host.trimEnd('.')

    /** This device or the local network: loopback, private IPv4 ranges, link-local, localhost, .local. */
    fun isLocal(host: String): Boolean {
        val name = host.lowercase().trimEnd('.')
        if (name == "localhost" || name.endsWith(".localhost") || name.endsWith(".local")) return true
        if (name == "::1" || name.startsWith("fe80:") || name.startsWith("fc") || name.startsWith("fd")) return ':' in name
        val parts = name.split('.').map { it.toIntOrNull() ?: return false }
        if (parts.size != 4) return false
        val (a, b) = parts
        return a == 127 || a == 10 || a == 192 && b == 168 || a == 172 && b in 16..31 || a == 169 && b == 254
    }

    /** The entry of `sites` that `host` is, or is a subdomain of. */
    fun blockedSite(host: String, sites: Set<String>): String? =
        generateSequence(host.lowercase().trimEnd('.')) { it.substringAfter('.', "") }
            .takeWhile { it.isNotEmpty() }.firstOrNull { it in sites }

    /** A typed address as a site key: "https://www.Example.com/x" → "example.com"; null when it is none. */
    fun siteOf(raw: String): String? {
        val input = raw.trim()
        if (input.isEmpty() || input.any(Char::isWhitespace)) return null
        val url = webUrl(if (webScheme.containsMatchIn(input)) input else "https://$input") ?: return null
        return site(url).takeIf { '.' in it }
    }

    fun allowsNavigation(
        from: HttpUrl?,
        to: HttpUrl,
        userGesture: Boolean,
        serverRedirect: Boolean,
        trustedChain: Boolean,
    ): Boolean = from == null || site(from) == site(to) || userGesture || (serverRedirect && trustedChain)
}
