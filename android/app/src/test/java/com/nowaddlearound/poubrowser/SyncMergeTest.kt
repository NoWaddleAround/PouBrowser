package com.nowaddlearound.poubrowser

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncMergeTest {
    private val passwords = """{"updated":1700000000000,"data":"c2VjcmV0","salt":"c2FsdA=="}"""
    private val file = """{"format":1,"parts":{
        "bookmarks":{"updated":1764000000000,"data":[{"url":"https://a.com/","title":"A","date":1}]},
        "blockedSites":{"updated":1764000000000,"data":["bad.com"]},
        "passwords":$passwords}}"""

    private fun local(stamp: Double = 0.0, vararg sites: String) = SyncMerge.Local(stamp, JSONArray(sites.toList()))
    private fun none() = SyncMerge.parts.associateWith { local() }

    @Test fun firstSyncJoinsBothSidesAndKeepsUnknownParts() {
        val mine = none() + mapOf(
            "bookmarks" to SyncMerge.Local(0.0, SyncMerge.bookmarksJson(listOf(Page("https://a.com/", "old A", 5), Page("https://b.com/", "B", 6)))),
            "blockedSites" to local(0.0, "evil.com"),
        )
        val result = SyncMerge.merge(file, mine, 2e12)
        assertEquals(listOf("bookmarks", "blockedSites"), result.took)
        assertEquals(listOf("https://a.com/", "https://b.com/"), SyncMerge.bookmarks(result.apply.getValue("bookmarks")).map { it.url })
        assertEquals("A", SyncMerge.bookmarks(result.apply.getValue("bookmarks"))[0].title)
        assertEquals(listOf("bad.com", "evil.com"), SyncMerge.sites(result.apply.getValue("blockedSites")))
        assertEquals(2e12, result.stamps.getValue("bookmarks"), 0.0)
        val parts = JSONObject(result.file!!).getJSONObject("parts")
        assertEquals(2000000000000L, parts.getJSONObject("blockedSites").get("updated"))
        assertEquals(2, parts.getJSONObject("bookmarks").getJSONArray("data").length())
        assertEquals(JSONObject(passwords).toString(), parts.getJSONObject("passwords").toString())
        assertTrue(!parts.has("unfilteredSites"))   // empty and never changed: not written
    }

    @Test fun newerRemoteReplacesWithoutWriting() {
        val result = SyncMerge.merge(file, none() + mapOf("bookmarks" to SyncMerge.Local(1.0, JSONArray()), "blockedSites" to local(5.0, "x.com")), 2e12)
        assertEquals(listOf("bad.com"), SyncMerge.sites(result.apply.getValue("blockedSites")))
        assertEquals(1764000000000.0, result.stamps.getValue("blockedSites"), 0.0)
        assertNull(result.file)
    }

    @Test fun newerLocalAndMissingPartsAreWritten() {
        val mine = none() + mapOf("blockedSites" to local(1764000000001.5, "new.com"), "scriptlessSites" to local(0.0, "nojs.com"),
            "bookmarks" to SyncMerge.Local(1764000000000.0, JSONArray()))
        val result = SyncMerge.merge(file, mine, 2e12)
        assertTrue(result.apply.isEmpty())
        val parts = JSONObject(result.file!!).getJSONObject("parts")
        assertEquals(1764000000001.5, parts.getJSONObject("blockedSites").getDouble("updated"), 0.0)
        assertEquals("new.com", parts.getJSONObject("blockedSites").getJSONArray("data").getString(0))
        assertEquals(2e12, result.stamps.getValue("scriptlessSites"), 0.0)
        assertEquals(1764000000000L, parts.getJSONObject("bookmarks").get("updated"))   // equal stamps: untouched
        assertEquals(JSONObject(passwords).toString(), parts.getJSONObject("passwords").toString())
    }

    @Test fun noFileAndNothingLocalWritesNothing() {
        assertNull(SyncMerge.merge(null, none(), 2e12).file)
        assertEquals(1, JSONObject(SyncMerge.merge("", none() + mapOf("unfilteredSites" to local(0.0, "a.com")), 2e12).file!!).getInt("format"))
    }

    @Test(expected = Exception::class) fun brokenFileIsNotOverwritten() {
        SyncMerge.merge("{not json", none(), 2e12)
    }
}
