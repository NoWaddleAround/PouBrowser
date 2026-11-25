package com.nowaddlearound.poubrowser

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

internal object BrowserPolicy {
    private val search = "https://duckduckgo.com/".toHttpUrlOrNull()!!
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

    /** Strips known ad and campaign click-ID parameters while leaving login/OAuth callbacks untouched. */
    fun cleanUrl(url: HttpUrl): HttpUrl {
        if (url.querySize == 0) return url
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

    fun destination(raw: String): HttpUrl? {
        val input = raw.trim()
        if (input.isEmpty()) return null
        if (webScheme.containsMatchIn(input)) return webUrl(input)?.let(::cleanUrl)
        if (input.contains("://")) return null
        val authority = input.takeWhile { it !in "/?#" }
        val looksLikeHost = authority.contains('.') || authority.startsWith('[') ||
            authority.substringBefore(':').equals("localhost", ignoreCase = true)
        if (looksLikeHost && input.none(Char::isWhitespace)) return webUrl("https://$input")?.let(::cleanUrl)
        if (otherScheme.containsMatchIn(input) && input.none(Char::isWhitespace)) return null
        return search.newBuilder().addQueryParameter("q", input).build()
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

    fun site(url: HttpUrl): String = url.topPrivateDomain() ?: url.host.trimEnd('.')

    fun allowsNavigation(
        from: HttpUrl?,
        to: HttpUrl,
        userGesture: Boolean,
        serverRedirect: Boolean,
        trustedChain: Boolean,
    ): Boolean = from == null || site(from) == site(to) || userGesture || (serverRedirect && trustedChain)
}
