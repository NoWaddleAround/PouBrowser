package com.nowaddlearound.poubrowser

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.util.concurrent.ConcurrentHashMap
import java.util.regex.Pattern

/**
 * The ad blocker's rules: which requests to drop, and what to hide or run inside a page. Reads the
 * Adblock Plus / AdGuard / uBlock Origin filter syntax, so Android uses the same lists as the iOS app.
 * Rules it cannot honour (redirects, header and response rewriting) are left out.
 */
internal class FilterEngine private constructor(
    private val plainHosts: Set<String>,
    private val requests: Index,
    private val pages: Index,
    private val genericHide: Array<String>,
    private val cosmetic: Map<String, Array<String>>,
    private val uncosmetic: Map<String, Set<String>>,
    val count: Int,
) {
    class Scriptlet(val name: String, val args: List<String>)

    /** What one page gets: finished CSS rules, rules for the extended-CSS library, scripts and scriptlets. */
    class PageRules(val css: List<String>, val extended: List<String>, val js: List<String>, val scriptlets: List<Scriptlet>) {
        val isEmpty get() = css.isEmpty() && extended.isEmpty() && js.isEmpty() && scriptlets.isEmpty()
    }

    /** `pageHost` is the page the request comes from; null when unknown (service workers). */
    fun blocks(url: String, host: String, pageHost: String?, type: Int): Boolean {
        val third = pageHost?.let { siteOf(it) != siteOf(host) }
        var block = false
        var blockImportant = false
        var allow = false
        var allowImportant = false
        if (type and (DOCUMENT or POPUP) == 0) forEachSuffix(host) { if (it in plainHosts) block = true }
        requests.candidates(url, host, pageHost) { rule, viaHost ->
            val exception = rule.flags and EXCEPTION != 0
            val important = rule.flags and IMPORTANT != 0
            val known = if (exception) (if (important) allowImportant else allow) else (if (important) blockImportant else block)
            if (!known && rule.applies(type, third, pageHost) && rule.matches(url, viaHost)) {
                if (exception) { if (important) allowImportant = true else allow = true }
                else if (important) blockImportant = true else block = true
            }
        }
        return !allowImportant && (blockImportant || (block && !allow))
    }

    /** Whether a list bans the page itself: `$document` rules, and `$popup` rules for a page another page sends the tab to. */
    fun blocksPage(url: String, host: String, fromHost: String?): Boolean =
        blocks(url, host, host, DOCUMENT) || (fromHost != null && blocks(url, host, fromHost, POPUP))

    /** Exceptions that switch the blocker off for a whole page: a mask of [EXEMPT_ALL], [EXEMPT_COSMETIC], [EXEMPT_GENERIC]. */
    fun exemptions(url: String, host: String): Int {
        var mask = 0
        pages.candidates(url, host, host) { rule, viaHost ->
            if (rule.excludes(host) || !rule.matches(url, viaHost)) return@candidates
            if (rule.types and DOCUMENT != 0) mask = mask or EXEMPT_ALL
            if (rule.flags and ELEMHIDE != 0) mask = mask or EXEMPT_COSMETIC
            if (rule.flags and GENERICHIDE != 0) mask = mask or EXEMPT_GENERIC
        }
        return mask
    }

    /** The hide-everywhere selectors as one style sheet; one rule per selector, so a bad one only loses itself. */
    val genericCss: String by lazy { genericHide.joinToString("\n") { it + HIDE } }

    /** Null when the full [genericCss] applies to this host, else the sheet without the selectors excepted there. */
    fun genericCssFor(host: String): String? {
        val off = HashSet<String>()
        for (key in keys(host)) uncosmetic[key]?.let(off::addAll)
        if (off.isEmpty() || genericHide.none { it in off }) return null
        return genericHide.filter { it !in off }.joinToString("\n") { it + HIDE }
    }

    fun page(host: String): PageRules {
        val keys = keys(host)
        val off = HashSet<String>()
        for (key in keys) uncosmetic[key]?.let(off::addAll)
        val css = ArrayList<String>()
        val extended = ArrayList<String>()
        val js = ArrayList<String>()
        val scriptlets = ArrayList<Scriptlet>()
        val seen = HashSet<String>()
        for (key in keys) for (entry in cosmetic[key].orEmpty()) {
            val body = entry.substring(1)
            if (body in off || !seen.add(entry)) continue
            when (entry[0]) {
                'h' -> css.add(body + HIDE)
                's' -> css.add(body)
                'x' -> extended.add(when {
                    body.endsWith("}") -> body
                    body.endsWith(":remove()") -> body.removeSuffix(":remove()") + " { remove: true; }"
                    else -> "$body { display: none !important; }"
                })
                'j' -> js.add(body)
                'l' -> scriptlet(body)?.let(scriptlets::add)
            }
        }
        return PageRules(css, extended, js, scriptlets)
    }

    /** Host and its parent domains, each also with the public suffix as `*` (`google.*`), then "" for rules that apply everywhere. */
    private fun keys(host: String): List<String> {
        val keys = ArrayList<String>()
        val suffix = siteOf(host).substringAfter('.', "")
        forEachSuffix(host) {
            keys.add(it)
            if (suffix.isNotEmpty() && it.endsWith(".$suffix")) keys.add(it.removeSuffix(suffix) + "*")
        }
        keys.add("")
        return keys
    }

    internal class Rule(val pattern: String, val flags: Int, val types: Int, val exclude: Array<String>?) {
        @Volatile private var compiled: Pattern? = null
        @Volatile private var broken = false

        fun excludes(pageHost: String): Boolean {
            val list = exclude ?: return false
            var found = false
            forEachSuffix(pageHost) { if (it in list) found = true }
            return found
        }

        fun applies(type: Int, third: Boolean?, pageHost: String?): Boolean {
            if (types == 0) { if (type and (DOCUMENT or POPUP) != 0) return false } else if (types and type == 0) return false
            if (flags and THIRD != 0 && third != true) return false
            if (flags and FIRST != 0 && third != false) return false
            if (exclude != null && (pageHost == null || excludes(pageHost))) return false
            return true
        }

        /** `viaHost`: found through its host in the index, which for a bare `||host^` rule is the whole match. */
        fun matches(url: String, viaHost: Boolean): Boolean {
            if (viaHost && flags and HOST_ONLY != 0) return true
            if (broken) return false
            val regex = compiled ?: try {
                compile().also { compiled = it }
            } catch (_: RuntimeException) {
                broken = true
                return false
            }
            return regex.matcher(url).find()
        }

        // Compiled on first use: only rules whose host or keyword shows up in a request ever get here.
        private fun compile(): Pattern {
            val options = if (flags and MATCH_CASE != 0) 0 else Pattern.CASE_INSENSITIVE
            if (flags and REGEX != 0) return Pattern.compile(pattern.substring(1, pattern.length - 1), options)
            val regex = StringBuilder()
            var start = 0
            var end = pattern.length
            if (pattern.startsWith("||")) {
                regex.append("^[a-z][a-z0-9+.-]*://(?:[^/?#]*\\.)?")
                start = 2
            } else if (pattern.startsWith("|")) {
                regex.append('^')
                start = 1
            }
            val toEnd = end > start && pattern[end - 1] == '|'
            if (toEnd) end--
            for (index in start until end) {
                val char = pattern[index]
                when {
                    char == '*' -> regex.append(".*")
                    char == '^' -> regex.append("(?:[^\\w.%-]|$)")   // a separator, or the end of the address
                    char.code > 127 || char.isLetterOrDigit() || char == '_' -> regex.append(char)
                    else -> regex.append('\\').append(char)
                }
            }
            if (toEnd) regex.append('$')
            return Pattern.compile(regex.toString(), options)
        }
    }

    /** Finds the few rules worth testing for a request: by host, by a keyword of the address, or by the page it is on. */
    internal class Index(
        private val byHost: Map<String, Array<Rule>>,
        private val byToken: Map<String, Array<Rule>>,
        private val byPage: Map<String, Array<Rule>>,
        private val rest: Array<Rule>,
    ) {
        inline fun candidates(url: String, host: String, pageHost: String?, action: (Rule, Boolean) -> Unit) {
            forEachSuffix(host) { suffix -> byHost[suffix]?.forEach { action(it, true) } }
            forEachToken(url) { token -> byToken[token]?.forEach { action(it, false) } }
            if (pageHost != null) {
                val ending = siteOf(pageHost).substringAfter('.', "")
                forEachSuffix(pageHost) { suffix ->
                    byPage[suffix]?.forEach { action(it, false) }
                    // Rules written for "name.*": the page's public suffix stands in for the star.
                    if (ending.isNotEmpty() && suffix.endsWith(".$ending")) byPage[suffix.removeSuffix(ending) + "*"]?.forEach { action(it, false) }
                }
            }
            for (rule in rest) action(rule, false)
        }
    }

    class Builder {
        private val plain = HashSet<String>()
        private val rules = ArrayList<Rule>()
        private val includes = ArrayList<List<String>?>()
        private val raws = ArrayList<String>()
        private val bad = HashSet<String>()
        private val generic = LinkedHashSet<String>()
        private val cosmetic = HashMap<String, ArrayList<String>>()
        private val uncosmetic = HashMap<String, HashSet<String>>()
        private val shared = HashMap<String, String>()

        fun add(line: String) {
            val text = line.trim()
            if (text.isEmpty() || text[0] == '!' || text[0] == '[' || text.startsWith("# ") || text == "#") return
            if (!text.startsWith("||") && !text.startsWith("@@") && !text.startsWith("|")) {
                val match = cosmeticShape.matchEntire(text)
                if (match != null && domainsShape.matches(match.groupValues[1])) {
                    addCosmetic(match.groupValues[1], match.groupValues[2], match.groupValues[3])
                    return
                }
            }
            addNetwork(text)
        }

        private fun addNetwork(text: String) {
            var body = text
            var flags = 0
            if (body.startsWith("@@")) {
                flags = EXCEPTION
                body = body.substring(2)
            }
            val exception = flags != 0
            var types = 0
            var negated = 0
            var include: ArrayList<String>? = null
            var exclude: ArrayList<String>? = null
            var unsupported = false
            var unreadable = false
            val cut = body.lastIndexOf('$')
            if (cut >= 0 && cut < body.length - 1 && optionsShape.matches(body.substring(cut + 1))) {
                var badfilter = false
                val kept = ArrayList<String>()
                for (option in body.substring(cut + 1).split(',')) {
                    val name = option.substringBefore('=').lowercase()
                    if (name == "badfilter") {
                        badfilter = true
                        continue
                    }
                    kept.add(option)
                    val type = typeNames[name.removePrefix("~")]
                    when {
                        type != null -> if (name.startsWith("~")) negated = negated or type else types = types or type
                        name == "all" -> types = SUBRESOURCES or DOCUMENT or POPUP
                        name == "third-party" || name == "3p" -> flags = flags or THIRD
                        name == "~third-party" || name == "1p" || name == "first-party" -> flags = flags or FIRST
                        name == "important" -> flags = flags or IMPORTANT
                        name == "match-case" -> flags = flags or MATCH_CASE
                        name == "_" -> Unit
                        exception && (name == "elemhide" || name == "ehide") -> flags = flags or ELEMHIDE
                        exception && (name == "generichide" || name == "ghide") -> flags = flags or GENERICHIDE
                        name == "domain" || name == "from" -> for (entry in option.substringAfter('=', "").lowercase().split('|')) {
                            val negative = entry.startsWith("~")
                            val domain = entry.removePrefix("~")
                            if (domain.isEmpty()) continue
                            // "name.*" (any ending) is understood in "only on" lists. A domain the engine cannot
                            // read makes the rule unusable: left out of an "except on" list it would over-block,
                            // and an "only on" list emptied of all its domains would apply everywhere.
                            val anyEnding = !negative && domain.endsWith(".*") && '*' !in domain.dropLast(1)
                            if (('*' in domain && !anyEnding) || '/' in domain) {
                                if (negative) unsupported = true else unreadable = true
                                continue
                            }
                            if (negative) (exclude ?: ArrayList<String>().also { exclude = it }).add(domain)
                            else (include ?: ArrayList<String>().also { include = it }).add(domain)
                        }
                        else -> unsupported = true
                    }
                    if ((name == "domain" || name == "from") && include == null && (unreadable || exclude == null)) unsupported = true
                }
                body = body.substring(0, cut)
                if (badfilter) {
                    bad.add((if (exception) "@@" else "") + body + if (kept.isEmpty()) "" else "$" + kept.joinToString(","))
                    return
                }
            }
            if (unsupported) return
            if (types == 0 && negated != 0) types = SUBRESOURCES and negated.inv()
            if (flags == 0 && types == 0 && include == null && exclude == null) {
                val host = plainShape.matchEntire(body)?.groupValues?.get(1)?.lowercase()
                if (host != null && validHost(host)) {
                    plain.add(host)
                    return
                }
            }
            if (body.length > 1 && body.startsWith("/") && body.endsWith("/")) flags = flags or REGEX
            rules.add(Rule(body, flags, types, exclude?.toTypedArray()))
            includes.add(include)
            raws.add(text)
        }

        private fun addCosmetic(domains: String, marker: String, rawBody: String) {
            var body = rawBody.trim()
            val exception = marker.startsWith("#@")
            var kind = when (marker.replace("@", "")) {
                "##" -> 'h'
                "#?#", "#$?#" -> 'x'
                "#$#" -> 's'
                else -> 'j'
            }
            if (kind == 'h') {
                when {
                    body.startsWith("+js(") && body.endsWith(")") -> kind = 'l'
                    body.startsWith("^") -> return   // rewrites the page's HTML before it is parsed: not possible here
                    styleCall.containsMatchIn(body) -> {
                        val match = styleCall.find(body)!!
                        body = body.substring(0, match.range.first) + " { " + match.groupValues[1] + " }"
                        kind = 's'
                    }
                }
            } else if (kind == 'j' && body.startsWith("//scriptlet(")) kind = 'l'
            if ((kind == 'h' || kind == 's') && extendedPseudo.containsMatchIn(body)) kind = 'x'
            // Style rules come from the lists into every matching page: none may fetch anything or break out of its block.
            if (kind == 's' || kind == 'x') {
                val lower = body.lowercase()
                if ("url(" in lower || "@import" in lower || "image-set(" in lower || "expression(" in lower || '\\' in lower) return
            }
            if (kind == 'h' && ('{' in body || '}' in body)) return
            if (kind == 's' && !body.endsWith("}")) return
            body = shared.getOrPut(body) { body }

            val on = ArrayList<String>()
            val off = ArrayList<String>()
            for (entry in domains.lowercase().split(',')) {
                if (entry.isEmpty()) continue
                if (entry.startsWith("~")) off.add(entry.substring(1)) else on.add(entry)
            }
            if (exception) {
                if (on.isEmpty()) on.add("")
                for (domain in on) uncosmetic.getOrPut(domain) { HashSet() }.add(body)
                return
            }
            for (domain in off) uncosmetic.getOrPut(domain) { HashSet() }.add(body)
            if (on.isEmpty()) {
                if (kind == 'h') {
                    generic.add(body)
                    return
                }
                on.add("")
            }
            val entry = kind + body
            for (domain in on) cosmetic.getOrPut(domain) { ArrayList() }.add(entry)
        }

        fun build(): FilterEngine {
            for (key in bad) plainShape.matchEntire(key)?.let { plain.remove(it.groupValues[1].lowercase()) }
            val requests = IndexBuilder()
            val pages = IndexBuilder()
            var count = plain.size
            for (position in rules.indices) {
                if (raws[position] in bad) continue
                val rule = rules[position]
                val pageRule = rule.flags and EXCEPTION != 0 &&
                    (rule.flags and (ELEMHIDE or GENERICHIDE) != 0 || rule.types and DOCUMENT != 0)
                (if (pageRule) pages else requests).add(rule, includes[position])
                count++
            }
            uncosmetic[""]?.let { generic.removeAll(it) }
            count += generic.size + cosmetic.values.sumOf { it.size }
            return FilterEngine(
                plain, requests.build(), pages.build(), generic.toTypedArray(),
                cosmetic.mapValues { it.value.toTypedArray() }, uncosmetic, count,
            )
        }
    }

    private class IndexBuilder {
        private val byHost = HashMap<String, ArrayList<Rule>>()
        private val byToken = HashMap<String, ArrayList<Rule>>()
        private val byPage = HashMap<String, ArrayList<Rule>>()
        private val rest = ArrayList<Rule>()

        fun add(rule: Rule, include: List<String>?) {
            if (include != null) {
                for (domain in include) byPage.getOrPut(domain) { ArrayList() }.add(rule)
                return
            }
            if (rule.flags and REGEX != 0) {
                rest.add(rule)
                return
            }
            val pattern = rule.pattern.lowercase()
            if (pattern.startsWith("||")) {
                var end = 2
                while (end < pattern.length && (pattern[end].isLetterOrDigit() || pattern[end] == '.' || pattern[end] == '-')) end++
                val host = pattern.substring(2, end)
                val tail = pattern.substring(end)
                if (validHost(host) && (tail.isEmpty() || tail[0] in "^/:?|")) {
                    val bare = tail.isEmpty() || tail == "^"
                    byHost.getOrPut(host) { ArrayList() }
                        .add(if (bare) Rule(rule.pattern, rule.flags or HOST_ONLY, rule.types, rule.exclude) else rule)
                    return
                }
            }
            val token = keyword(pattern)
            if (token != null) byToken.getOrPut(token) { ArrayList() }.add(rule) else rest.add(rule)
        }

        fun build() = Index(byHost.arrays(), byToken.arrays(), byPage.arrays(), rest.toTypedArray())

        private fun HashMap<String, ArrayList<Rule>>.arrays(): Map<String, Array<Rule>> =
            HashMap<String, Array<Rule>>(size * 2).also { for ((key, value) in this) it[key] = value.toTypedArray() }
    }

    companion object {
        const val SCRIPT = 1
        const val IMAGE = 2
        const val CSS = 4
        const val XHR = 8
        const val FRAME = 16
        const val MEDIA = 32
        const val FONT = 64
        const val OTHER = 128
        const val DOCUMENT = 256
        const val POPUP = 512
        const val SUBRESOURCES = 255
        /**
         * A request whose kind WebView does not tell and its address does not show: a script, a fetch or
         * a media stream. Not "other": a rule against web sockets or beacons must not take a page's data with it.
         */
        const val UNKNOWN = SCRIPT or XHR or MEDIA

        const val EXEMPT_ALL = 1
        const val EXEMPT_COSMETIC = 2
        const val EXEMPT_GENERIC = 4

        private const val EXCEPTION = 1
        private const val IMPORTANT = 2
        private const val THIRD = 4
        private const val FIRST = 8
        private const val MATCH_CASE = 16
        private const val HOST_ONLY = 32
        private const val REGEX = 64
        private const val ELEMHIDE = 128
        private const val GENERICHIDE = 256

        private const val HIDE = "{display:none!important}"

        private val typeNames = mapOf(
            "script" to SCRIPT, "image" to IMAGE, "stylesheet" to CSS, "css" to CSS,
            "xmlhttprequest" to XHR, "xhr" to XHR, "subdocument" to FRAME, "frame" to FRAME,
            "media" to MEDIA, "font" to FONT, "other" to OTHER, "websocket" to OTHER, "ping" to OTHER,
            "beacon" to OTHER, "object" to OTHER, "object-subrequest" to OTHER,
            "document" to DOCUMENT, "doc" to DOCUMENT, "popup" to POPUP,
        )
        private val cosmeticShape = Regex("^([^#\\s]*)(#@?(?:[$][?]|[$]|[?]|%)?#)(.+)$")
        private val domainsShape = Regex("^[a-zA-Z0-9.,~*_-]*$")
        private val optionsShape = Regex("^~?[a-zA-Z0-9_-]+(=[^,]*)?(,~?[a-zA-Z0-9_-]+(=[^,]*)?)*$")
        private val plainShape = Regex("^\\|\\|([a-zA-Z0-9.-]+)\\^$")
        private val styleCall = Regex(":style\\((.*)\\)$")
        private val extendedPseudo = Regex(
            ":(?:has-text|contains|matches-css|matches-css-before|matches-css-after|matches-attr|matches-property|" +
                "matches-path|matches-media|upward|nth-ancestor|xpath|min-text-length|if|if-not|remove|watch-attr|others|-abp-[a-z-]+)\\(",
        )
        private val commonTokens = setOf("http", "https", "www", "com", "net", "org", "html", "php", "js", "css", "cdn")

        private val sites = ConcurrentHashMap<String, String>()

        /** Registrable domain of a host ("bbc.co.uk"), cached: asked for on every request. */
        fun siteOf(host: String): String {
            sites[host]?.let { return it }
            val site = "http://$host/".toHttpUrlOrNull()?.topPrivateDomain() ?: host
            if (sites.size > 4000) sites.clear()
            sites[host] = site
            return site
        }

        fun parse(lines: Sequence<String>): FilterEngine = Builder().apply { lines.forEach(::add) }.build()

        private fun validHost(host: String) =
            host.isNotEmpty() && host.length <= 253 && !host.startsWith(".") && !host.endsWith(".") && ".." !in host

        internal inline fun forEachSuffix(host: String, action: (String) -> Unit) {
            var suffix = host
            while (true) {
                action(suffix)
                val dot = suffix.indexOf('.')
                if (dot < 0) return
                suffix = suffix.substring(dot + 1)
            }
        }

        internal fun Char.isToken() = this in 'a'..'z' || this in '0'..'9'

        internal inline fun forEachToken(url: String, action: (String) -> Unit) {
            var start = -1
            for (index in 0..url.length) {
                val inside = index < url.length && url[index].lowercaseChar().isToken()
                if (inside) {
                    if (start < 0) start = index
                } else if (start >= 0) {
                    if (index - start >= 2) action(url.substring(start, index).lowercase())
                    start = -1
                }
            }
        }

        /**
         * The longest run of letters and digits in a pattern that must show up in a matching address as a
         * whole word: fenced in by separators on both sides, not by a wildcard or an open end.
         */
        private fun keyword(pattern: String): String? {
            var best: String? = null
            var start = -1
            for (index in 0..pattern.length) {
                val inside = index < pattern.length && pattern[index].isToken()
                if (inside) {
                    if (start < 0) start = index
                    continue
                }
                if (start >= 0) {
                    val fencedLeft = start > 0 && pattern[start - 1] != '*'
                    val fencedRight = index < pattern.length && pattern[index] != '*'
                    val word = pattern.substring(start, index)
                    if (fencedLeft && fencedRight && word.length >= 2 && word !in commonTokens && word.length > (best?.length ?: 0)) best = word
                    start = -1
                }
            }
            return best
        }

        /** `//scriptlet('name', 'arg')` (AdGuard) or `+js(name, arg)` (uBlock Origin, whose names get the `ubo-` prefix). */
        internal fun scriptlet(body: String): Scriptlet? {
            val parts = ArrayList<String>()
            if (body.startsWith("+js(")) {
                val inner = body.substring(4, body.length - 1)
                val part = StringBuilder()
                var index = 0
                while (index <= inner.length) {
                    val char = if (index < inner.length) inner[index] else ','
                    if (char == '\\' && index + 1 < inner.length && inner[index + 1] == ',') {
                        part.append(',')
                        index += 2
                        continue
                    }
                    if (char == ',' ) {
                        var value = part.toString().trim()
                        if (value.length >= 2 && value[0] == value[value.length - 1] && value[0] in "'\"`") value = value.substring(1, value.length - 1)
                        parts.add(value)
                        part.setLength(0)
                    } else part.append(char)
                    index++
                }
                if (parts.isEmpty() || parts[0].isEmpty()) return null
                return Scriptlet("ubo-" + parts[0], parts.drop(1))
            }
            val inner = body.removePrefix("//scriptlet(").removeSuffix(")")
            var index = 0
            while (index < inner.length) {
                val quote = inner[index]
                if (quote != '\'' && quote != '"') {
                    index++
                    continue
                }
                val part = StringBuilder()
                index++
                while (index < inner.length && inner[index] != quote) {
                    if (inner[index] == '\\' && index + 1 < inner.length && inner[index + 1] == quote) index++
                    part.append(inner[index])
                    index++
                }
                parts.add(part.toString())
                index++
            }
            if (parts.isEmpty() || parts[0].isEmpty()) return null
            return Scriptlet(parts[0], parts.drop(1))
        }
    }
}
