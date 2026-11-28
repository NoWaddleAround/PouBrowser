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

    @Test fun localAddressesOpenOverHttp() {
        assertEquals("http://127.0.0.1/", BrowserPolicy.destination("127.0.0.1")?.toString())
        assertEquals("http://127.0.0.1:8765/index.html", BrowserPolicy.destination("127.0.0.1:8765/index.html")?.toString())
        assertEquals("http://localhost:3000/", BrowserPolicy.destination("localhost:3000")?.toString())
        assertEquals("http://192.168.1.20/", BrowserPolicy.destination("192.168.1.20")?.toString())
        assertEquals("http://drucker.local/", BrowserPolicy.destination("drucker.local")?.toString())
        assertEquals("http://[::1]:8080/", BrowserPolicy.destination("[::1]:8080")?.toString())
        assertEquals("https://8.8.8.8/", BrowserPolicy.destination("8.8.8.8")?.toString())
        assertEquals("https://172.32.0.1/", BrowserPolicy.destination("172.32.0.1")?.toString())
        assertEquals("https://fcbarcelona.com/", BrowserPolicy.destination("fcbarcelona.com")?.toString())
        assertTrue(BrowserPolicy.isLocal("10.0.0.2"))
        assertFalse(BrowserPolicy.isLocal("example.com"))
    }

    @Test fun searchesGoToTheChosenEngine() {
        val engines = BrowserPolicy.searchEngines.associateBy { it.name }
        assertEquals("https://duckduckgo.com/?q=one%20piece%20%26%20co", BrowserPolicy.destination("one piece & co")?.toString())
        assertEquals("https://www.google.com/search?q=test", BrowserPolicy.destination("test", engines.getValue("Google"))?.toString())
        assertEquals("https://www.startpage.com/sp/search?query=a%2Bb", BrowserPolicy.searchUrl("a+b", engines.getValue("Startpage")).toString())
        assertEquals("https://search.brave.com/search?q=x", BrowserPolicy.searchUrl("x", engines.getValue("Brave Search")).toString())
        assertEquals("https://www.ecosia.org/search?q=x", BrowserPolicy.searchUrl("x", engines.getValue("Ecosia")).toString())
        assertEquals("https://www.bing.com/search?q=x", BrowserPolicy.searchUrl("x", engines.getValue("Bing")).toString())
        assertEquals("https://example.com/", BrowserPolicy.destination("example.com", engines.getValue("Bing"))?.toString())
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

    @Test fun forgettingExpiresCookiesOnTheHostAndItsParentsUpToTheSite() {
        assertEquals(
            listOf(
                "a=; Max-Age=0; Path=/; Secure",
                "a=; Max-Age=0; Path=/; Secure; Domain=de.m.wikipedia.org",
                "a=; Max-Age=0; Path=/; Secure; Domain=m.wikipedia.org",
                "a=; Max-Age=0; Path=/; Secure; Domain=wikipedia.org",
            ),
            BrowserPolicy.expiringCookies("a=1; a=2", "de.m.wikipedia.org", "wikipedia.org"),
        )
        assertEquals(
            listOf("x=; Max-Age=0; Path=/; Secure", "x=; Max-Age=0; Path=/; Secure; Domain=example.com",
                "__Host-y=; Max-Age=0; Path=/; Secure", "__Host-y=; Max-Age=0; Path=/; Secure; Domain=example.com"),
            BrowserPolicy.expiringCookies(" x = 1 ;__Host-y=a=b", "example.com", "example.com"),
        )
        assertEquals(emptyList<String>(), BrowserPolicy.expiringCookies(null, "example.com", "example.com"))
    }

    @Test fun blockedSitesCoverTheirSubdomains() {
        val sites = setOf("wikimedia.org", "example.com")
        assertEquals("wikimedia.org", BrowserPolicy.blockedSite("upload.wikimedia.org", sites))
        assertEquals("example.com", BrowserPolicy.blockedSite("Example.COM.", sites))
        assertNull(BrowserPolicy.blockedSite("notexample.com", sites))
        assertNull(BrowserPolicy.blockedSite("example.com.evil.net", sites))
        assertNull(BrowserPolicy.blockedSite("wikipedia.org", sites))
    }

    @Test fun typedSitesAreNormalised() {
        assertEquals("example.com", BrowserPolicy.siteOf(" https://www.Example.com/x "))
        assertEquals("wikimedia.org", BrowserPolicy.siteOf("upload.wikimedia.org"))
        assertEquals("bbc.co.uk", BrowserPolicy.siteOf("news.bbc.co.uk/path?q=1"))
        assertNull(BrowserPolicy.siteOf("hello world"))
        assertNull(BrowserPolicy.siteOf("localhost"))
        assertNull(BrowserPolicy.siteOf("javascript:alert(1)"))
        assertNull(BrowserPolicy.siteOf(""))
    }

    @Test fun hiddenElementsGetOneRuleEachAndNoBraces() {
        assertEquals(
            "#ad { display: none !important }\nbody > div:nth-of-type(1) > p:nth-of-type(2) { display: none !important }",
            BrowserPolicy.hidingCss(setOf("body > div:nth-of-type(1) > p:nth-of-type(2)", "#ad", " ", "a{} body")),
        )
        assertEquals("", BrowserPolicy.hidingCss(emptySet()))
    }

    private fun clean(raw: String) = BrowserPolicy.cleanUrl(BrowserPolicy.webUrl(raw)!!).toString()

    @Test fun bounceLinksGoStraightToTheTarget() {
        assertEquals("https://example.com/a?b=1", clean("https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26utm_source%3Dx&sa=D"))
        assertEquals("https://example.com/", clean("https://www.google.de/url?sa=t&url=https://example.com/"))
        assertEquals("https://example.com/", clean("https://www.google.com/url?q=https%3A%2F%2Fexample.com%2F%3Futm_source%3Dx"))
        assertEquals("https://example.com/x", clean("https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fx%3Ffbclid%3D1&h=AT0"))
        assertEquals("https://example.com/", clean("https://l.instagram.com/?u=https%3A%2F%2Fexample.com%2F&e=1"))
        assertEquals("https://example.com/", clean("https://out.reddit.com/t3_abc?url=https%3A%2F%2Fexample.com%2F&token=z"))
        assertEquals("https://example.com/", clean("https://www.youtube.com/redirect?event=video_description&q=https%3A%2F%2Fexample.com%2F"))
        assertEquals("https://example.com/", clean("https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com%2F&data=05"))
        assertEquals("https://example.com/", clean("https://steamcommunity.com/linkfilter/?u=https%3A%2F%2Fexample.com%2F"))
        assertEquals("https://example.com/", clean("https://vk.com/away.php?to=https%3A%2F%2Fexample.com%2F"))
        assertEquals("https://example.com/", clean("https://slack-redir.net/link?url=https%3A%2F%2Fexample.com%2F"))
        // Nested bounces unwrap all the way.
        assertEquals("https://example.com/", clean("https://www.google.com/url?q=" +
            java.net.URLEncoder.encode("https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2F", "UTF-8")))
        // Not a web address, or not a bounce page: left alone.
        assertEquals("https://www.google.com/url?q=javascript:alert(1)", clean("https://www.google.com/url?q=javascript:alert(1)"))
        assertEquals("https://www.google.com/search?q=https://example.com", clean("https://www.google.com/search?q=https://example.com"))
        assertEquals("https://notgoogle.com/url?q=https://example.com/", clean("https://notgoogle.com/url?q=https://example.com/"))
    }

    @Test fun textFragmentLinks() {
        val page = BrowserPolicy.webUrl("https://example.com/a#old")!!
        assertEquals("https://example.com/a#:~:text=Hallo%20Welt", BrowserPolicy.textFragment(page, " Hallo\n Welt "))
        assertEquals("https://example.com/a#:~:text=a%2Db%2C%20c%26d%20%C3%A4", BrowserPolicy.textFragment(page, "a-b, c&d ä"))
        val long = (1..12).joinToString(" ") { "w$it" }
        assertEquals("https://example.com/a#:~:text=w1%20w2%20w3%20w4%20w5,w8%20w9%20w10%20w11%20w12", BrowserPolicy.textFragment(page, long))
        assertNull(BrowserPolicy.textFragment(page, "  "))
    }

    @Test fun httpsFirstSkipsTheHomeNetwork() {
        assertEquals("https://example.com/x?y=1", BrowserPolicy.httpsFirst(BrowserPolicy.webUrl("http://example.com/x?y=1")!!)?.toString())
        assertNull(BrowserPolicy.httpsFirst(BrowserPolicy.webUrl("https://example.com/")!!))
        assertNull(BrowserPolicy.httpsFirst(BrowserPolicy.webUrl("http://localhost:8765/")!!))
        assertNull(BrowserPolicy.httpsFirst(BrowserPolicy.webUrl("http://192.168.1.1/")!!))
        assertNull(BrowserPolicy.httpsFirst(BrowserPolicy.webUrl("http://drucker.local/")!!))
        assertNull(BrowserPolicy.httpsFirst(BrowserPolicy.webUrl("http://router/")!!))
        assertNull(BrowserPolicy.httpsFirst(BrowserPolicy.webUrl("http://8.8.8.8/")!!))
        assertNull(BrowserPolicy.httpsFirst(BrowserPolicy.webUrl("http://example.com:8080/")!!))
    }

    @Test fun speechPiecesStayUnderTheLimit() {
        val text = (1..200).joinToString(" ") { "Satz $it." } + "\n" + "x".repeat(250)
        val pieces = BrowserPolicy.speechPieces(text, 100)
        assertTrue(pieces.all { it.length <= 100 })
        assertEquals(text.filterNot(Char::isWhitespace), pieces.joinToString("").filterNot(Char::isWhitespace))
        assertEquals(listOf("kurz"), BrowserPolicy.speechPieces(" kurz ", 100))
    }
}
