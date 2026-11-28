package com.nowaddlearound.poubrowser

import org.junit.Assert.assertEquals
import org.junit.Test

class SuggestTest {
    @Test fun bookmarksFirstThenHistoryByVisitsThenRecency() {
        val bookmarks = listOf(Page("https://www.example.org/", "Kept", 5))
        val history = listOf(
            Page("https://example.com/new", "Example new", 30, visits = 1),
            Page("https://example.com/", "Example", 10, visits = 4),
            Page("https://example.com/old", "Example old", 20, visits = 1),
            Page("https://www.example.org/", "Kept", 40, visits = 9),
            Page("https://wikipedia.org/", "Wikipedia", 50, visits = 7),
        )
        assertEquals(
            listOf("https://www.example.org/", "https://example.com/", "https://example.com/new", "https://example.com/old"),
            suggest("EXA", bookmarks, history).map { it.url },
        )
        assertEquals(listOf("https://wikipedia.org/"), suggest("www.wiki", bookmarks, history).map { it.url })
        assertEquals(listOf("https://wikipedia.org/"), suggest("pedia", emptyList(), history).map { it.url })
        assertEquals(emptyList<Page>(), suggest("  ", bookmarks, history))
        assertEquals(6, suggest("e", emptyList(), List(9) { Page("https://e$it.com/", "", it.toLong()) }).size)
    }
}
