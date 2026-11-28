package com.nowaddlearound.poubrowser

import org.junit.Assert.assertEquals
import org.junit.Test

class BookmarkFileTest {
    @Test fun readsChromeExportWithFolders() {
        val html = """
            <!DOCTYPE NETSCAPE-Bookmark-file-1>
            <DL><p>
                <DT><H3 ADD_DATE="1700000000">Bookmarks bar</H3>
                <DL><p>
                    <DT><A HREF="https://example.com/a?x=1&amp;y=2" ADD_DATE="1700000001" ICON="data:image/png;base64,AAA">Tom &amp; Jerry</A>
                    <DT><H3>Nested</H3>
                    <DL><p>
                        <DT><a add_date="5" href="http://news.example.org/">News <b>today</b></a>
                    </DL><p>
                </DL><p>
                <DT><A HREF="javascript:alert(1)">Bookmarklet</A>
                <DT><A HREF="https://example.com/a?x=1&amp;y=2">Duplicate</A>
            </DL><p>
        """.trimIndent()
        assertEquals(listOf(
            Page("https://example.com/a?x=1&y=2", "Tom & Jerry", 1_700_000_001_000),
            Page("http://news.example.org/", "News today", 5_000),
        ), BookmarkFile.parse(html))
    }

    @Test fun exportReadsBackTheSame() {
        val pages = listOf(
            Page("https://example.com/?q=\"a\"&b=<c>", "A \"quoted\" <title> & more", 1_234_000),
            Page("https://example.org/", "", 0),
        )
        val html = BookmarkFile.write(pages)
        assert(html.startsWith("<!DOCTYPE NETSCAPE-Bookmark-file-1>"))
        assertEquals(listOf(pages[0], Page("https://example.org/", "https://example.org/", 0)), BookmarkFile.parse(html))
    }
}
