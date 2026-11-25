package com.nowaddlearound.poubrowser

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

internal object BrowserPolicy {
    private val search = "https://duckduckgo.com/".toHttpUrlOrNull()!!
    private val webScheme = Regex("^https?://", RegexOption.IGNORE_CASE)
    private val otherScheme = Regex("^[a-z][a-z0-9+.-]*:", RegexOption.IGNORE_CASE)

    fun webUrl(raw: String): HttpUrl? {
        if (!webScheme.containsMatchIn(raw) || raw.any { it == '\\' || it.isISOControl() }) return null
        return raw.toHttpUrlOrNull()?.takeIf { it.username.isEmpty() && it.password.isEmpty() }
    }

    fun destination(raw: String): HttpUrl? {
        val input = raw.trim()
        if (input.isEmpty()) return null
        if (webScheme.containsMatchIn(input)) return webUrl(input)
        if (input.contains("://")) return null
        val authority = input.takeWhile { it !in "/?#" }
        val looksLikeHost = authority.contains('.') || authority.startsWith('[') ||
            authority.substringBefore(':').equals("localhost", ignoreCase = true)
        if (looksLikeHost && input.none(Char::isWhitespace)) return webUrl("https://$input")
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
