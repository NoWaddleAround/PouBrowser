package com.nowaddlearound.poubrowser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowserPolicyTest {
    @Test fun addressBarAcceptsWebAddressesAndSearches() {
        assertEquals("https://xn--bcher-kva.de/seite", BrowserPolicy.destination("bücher.de/seite")?.toString())
        assertEquals("http://127.0.0.1:8765/path", BrowserPolicy.destination("http://127.0.0.1:8765/path")?.toString())
        assertEquals("one piece", BrowserPolicy.destination("one piece")?.queryParameter("q"))
        assertNull(BrowserPolicy.destination("javascript:alert(1)"))
        assertNull(BrowserPolicy.destination("https://bank.example@tracker.com"))
    }

    @Test fun cleanUrlStripsTrackingParametersAndPreservesAuthCallbacks() {
        assertEquals(
            "https://shop.example/item?id=42",
            BrowserPolicy.destination("https://shop.example/item?id=42&fbclid=xyz&utm_source=feed&gclid=123")?.toString(),
        )
        assertEquals(
            "https://shop.example/item",
            BrowserPolicy.destination("shop.example/item?utm_medium=social&igshid=abc")?.toString(),
        )
        val oauth = BrowserPolicy.webUrl("https://id.example/oauth/callback?code=999&utm_source=keep")!!
        assertEquals(oauth, BrowserPolicy.cleanUrl(oauth))
    }

    @Test fun aNavigationCountsAsTappedOnlyWhenItGoesToTheTouchedLinkOrForm() {
        val link = BrowserPolicy.webUrl("https://shop.example/item?id=1#top")!!
        assertTrue(BrowserPolicy.sameTarget(link, BrowserPolicy.webUrl("https://shop.example/item?id=1")!!, form = false))
        assertFalse(BrowserPolicy.sameTarget(link, BrowserPolicy.webUrl("https://shop.example/item?id=2")!!, form = false))
        assertFalse(BrowserPolicy.sameTarget(link, BrowserPolicy.webUrl("https://ads.example/item?id=1")!!, form = false))
        val form = BrowserPolicy.webUrl("https://search.example/find")!!
        assertTrue(BrowserPolicy.sameTarget(form, BrowserPolicy.webUrl("https://search.example/find?q=manga")!!, form = true))
        assertFalse(BrowserPolicy.sameTarget(form, BrowserPolicy.webUrl("https://search.example/other?q=manga")!!, form = true))
    }

    @Test fun redirectsRequireAUserGestureOrAnAlreadyTrustedServerRedirectChain() {
        val from = BrowserPolicy.webUrl("https://www.bbc.co.uk/")!!
        val own = BrowserPolicy.webUrl("https://news.bbc.co.uk/")!!
        val foreign = BrowserPolicy.webUrl("https://other.co.uk/")!!
        assertTrue(BrowserPolicy.allowsNavigation(from, own, false, false, false))
        assertFalse(BrowserPolicy.allowsNavigation(from, foreign, false, false, true))
        assertFalse(BrowserPolicy.allowsNavigation(from, foreign, false, true, false))
        assertTrue(BrowserPolicy.allowsNavigation(from, foreign, false, true, true))
        assertTrue(BrowserPolicy.allowsNavigation(from, foreign, true, false, false))
    }
}
