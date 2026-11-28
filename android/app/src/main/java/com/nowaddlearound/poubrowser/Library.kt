package com.nowaddlearound.poubrowser

import android.content.Context
import okhttp3.HttpUrl
import org.json.JSONArray
import org.json.JSONObject

/** A bookmark or a history entry. For a bookmark `time` is when it was added; for history the last visit. */
internal data class Page(val url: String, val title: String, val time: Long, val visits: Int = 0)

private fun bare(text: String) = text.trim().lowercase().removePrefix("https://").removePrefix("http://").removePrefix("www.")

internal fun byVisits(history: List<Page>) = history.sortedWith(compareByDescending<Page> { it.visits }.thenByDescending { it.time })

/** Address suggestions: bookmarks first, then history by visits, then by the last visit. Never leaves the device. */
internal fun suggest(query: String, bookmarks: List<Page>, history: List<Page>, limit: Int = 6): List<Page> {
    val text = query.trim().lowercase()
    if (text.isEmpty()) return emptyList()
    val address = bare(text)
    fun hit(page: Page) = page.title.lowercase().contains(text) || bare(page.url).contains(address)
    return (bookmarks.filter(::hit) + byVisits(history.filter(::hit))).distinctBy { it.url }.take(limit)
}

/** The Netscape bookmark file that Chrome, Firefox, Safari and Brave import and export. Folders are flattened. */
internal object BookmarkFile {
    private val link = Regex("""<a\s([^>]*)>(.*?)</a>""", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
    private val href = Regex("""href\s*=\s*"([^"]*)"""", RegexOption.IGNORE_CASE)
    private val added = Regex("""add_date\s*=\s*"(\d+)"""", RegexOption.IGNORE_CASE)
    private val tag = Regex("<[^>]*>")

    fun parse(html: String): List<Page> = link.findAll(html).mapNotNull { match ->
        val attributes = match.groupValues[1]
        val url = unescape(href.find(attributes)?.groupValues?.get(1)?.trim() ?: return@mapNotNull null)
        if (BrowserPolicy.webUrl(url) == null) return@mapNotNull null
        val time = added.find(attributes)?.groupValues?.get(1)?.toLongOrNull()?.times(1000) ?: 0L
        Page(url, unescape(match.groupValues[2].replace(tag, "")).trim(), time)
    }.distinctBy { it.url }.toList()

    fun write(pages: List<Page>): String = buildString {
        append("<!DOCTYPE NETSCAPE-Bookmark-file-1>\n")
        append("<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">\n")
        append("<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n")
        for (page in pages) append("    <DT><A HREF=\"").append(escape(page.url)).append("\" ADD_DATE=\"").append(page.time / 1000)
            .append("\">").append(escape(page.title.ifBlank { page.url })).append("</A>\n")
        append("</DL><p>\n")
    }

    private fun escape(text: String) = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

    private fun unescape(text: String) = text.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"")
        .replace("&#39;", "'").replace("&#x27;", "'").replace("&nbsp;", " ").replace("&amp;", "&")
}

/** Bookmarks and history, newest first, kept as JSON in the app's private preferences. */
internal class Library(context: Context) {
    private val store = context.getSharedPreferences("library", Context.MODE_PRIVATE)
    var bookmarks = read("bookmarks")
        private set
    var history = read("history")
        private set
    /** The user added or removed a bookmark (for sync). */
    var changed: () -> Unit = {}

    fun isBookmarked(url: HttpUrl) = bookmarks.any { it.url == key(url) }

    /** Adds the page, or removes it when it is already bookmarked. Returns whether it is bookmarked now. */
    fun toggleBookmark(url: HttpUrl, title: String): Boolean {
        val added = !isBookmarked(url)
        if (added) {
            bookmarks = listOf(Page(key(url), title, System.currentTimeMillis())) + bookmarks
            write("bookmarks", bookmarks)
            changed()
        } else removeBookmark(key(url))
        return added
    }

    fun removeBookmark(url: String) {
        bookmarks = bookmarks.filter { it.url != url }
        write("bookmarks", bookmarks)
        changed()
    }

    /** Imported bookmarks that are not bookmarked yet go behind the existing ones. Returns how many were added. */
    fun addBookmarks(pages: List<Page>): Int {
        val known = bookmarks.map { it.url }.toMutableSet()
        val now = System.currentTimeMillis()
        val fresh = pages.mapNotNull { page ->
            val address = BrowserPolicy.webUrl(page.url)?.let(::key)?.takeIf(known::add) ?: return@mapNotNull null
            Page(address, page.title, page.time.takeIf { it > 0 } ?: now)
        }
        if (fresh.isEmpty()) return 0
        bookmarks = bookmarks + fresh
        write("bookmarks", bookmarks)
        changed()
        return fresh.size
    }

    /** Bookmarks taken over from the sync file. */
    fun replaceBookmarks(pages: List<Page>) {
        bookmarks = pages.filter { BrowserPolicy.webUrl(it.url) != null }.distinctBy { it.url }
        write("bookmarks", bookmarks)
    }

    fun visited(url: HttpUrl, title: String) {
        val address = key(url)
        val old = history.find { it.url == address }
        val entry = Page(address, title.ifBlank { old?.title.orEmpty() }, System.currentTimeMillis(), (old?.visits ?: 0) + 1)
        history = (listOf(entry) + history.filter { it.url != address }).take(1000)
        write("history", history)
    }

    /** A title that arrives after the page finished loading. */
    fun retitle(url: HttpUrl, title: String) {
        val address = key(url)
        if (title.isBlank() || history.none { it.url == address && it.title != title }) return
        history = history.map { if (it.url == address) it.copy(title = title) else it }
        write("history", history)
    }

    fun removeVisit(url: String) {
        history = history.filter { it.url != url }
        write("history", history)
    }

    fun removeSite(site: String) {
        history = history.filter { page -> BrowserPolicy.webUrl(page.url)?.let(BrowserPolicy::site) != site }
        write("history", history)
    }

    fun clearHistory() {
        history = emptyList()
        store.edit().remove("history").commit()
    }

    private fun key(url: HttpUrl) = url.newBuilder().fragment(null).build().toString()

    private fun read(name: String): List<Page> = runCatching {
        val rows = JSONArray(store.getString(name, "[]"))
        (0 until rows.length()).mapNotNull { index ->
            val row = rows.optJSONObject(index) ?: return@mapNotNull null
            Page(row.optString("url"), row.optString("title"), row.optLong("time"), row.optInt("visits"))
        }.filter { BrowserPolicy.webUrl(it.url) != null }
    }.getOrDefault(emptyList())

    private fun write(name: String, pages: List<Page>) {
        val rows = JSONArray()
        for (page in pages) rows.put(JSONObject().apply {
            put("url", page.url)
            put("title", page.title.take(250))
            put("time", page.time)
            put("visits", page.visits)
        })
        store.edit().putString(name, rows.toString()).apply()
    }
}
