package com.nowaddlearound.poubrowser

import com.nowaddlearound.poubrowser.FilterEngine.Companion.FRAME
import com.nowaddlearound.poubrowser.FilterEngine.Companion.IMAGE
import com.nowaddlearound.poubrowser.FilterEngine.Companion.SCRIPT
import com.nowaddlearound.poubrowser.FilterEngine.Companion.UNKNOWN
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream

class FilterEngineTest {
    private fun engine(vararg lines: String) = FilterEngine.parse(lines.asSequence())
    private val d = "$"

    private fun roundTrip(source: FilterEngine, stamp: String = "v1"): FilterEngine {
        val buffer = ByteArrayOutputStream()
        DataOutputStream(buffer).use { source.writeTo(it, stamp) }
        val bytes = buffer.toByteArray()
        assertNull(DataInputStream(ByteArrayInputStream(bytes)).use { FilterEngine.readFrom(it, "stale") })
        val restored = DataInputStream(ByteArrayInputStream(bytes)).use { FilterEngine.readFrom(it, stamp) }
        assertNotNull(restored)
        return restored!!
    }

    @Test fun hostRulesMatchWholeDomainsAndHonorExceptions() {
        val rules = engine(
            "||ads.example^", "@@||login.ads.example^", "||strict.login.ads.example^${d}important",
            "||fixed.example^", "||fixed.example^${d}badfilter", "||shop.example^${d}third-party",
        )
        for (candidate in listOf(rules, roundTrip(rules))) {
            fun blocks(host: String, page: String = "site.test") = candidate.blocks("https://$host/x.js", host, page, SCRIPT)
            assertTrue(blocks("pixel.ads.example"))
            assertFalse(blocks("notads.example"))
            assertFalse(blocks("ads.example.evil"))
            assertFalse(blocks("login.ads.example"))
            assertTrue(blocks("strict.login.ads.example"))
            assertFalse(blocks("fixed.example"))
            assertTrue(blocks("shop.example"))
            assertFalse(blocks("cdn.shop.example", page = "www.shop.example"))
        }
    }

    @Test fun pathRulesNeedTheirKeywordSeparatorsAndAnchors() {
        val rules = engine("/banner/ads/*", "-advert-", "||cdn.example/track.js", "|https://start.example/", "/pixel.gif|", "&adslot=")
        for (candidate in listOf(rules, roundTrip(rules))) {
            fun blocks(url: String) = candidate.blocks(url, url.substringAfter("://").substringBefore("/"), "site.test", UNKNOWN)
            assertTrue(blocks("https://a.test/banner/ads/top.js"))
            assertFalse(blocks("https://a.test/banner/adserver/top.js"))
            assertTrue(blocks("https://a.test/img-advert-1.png"))
            assertTrue(blocks("https://x.cdn.example/track.js?v=2"))
            assertFalse(blocks("https://cdn.example/other.js"))
            assertTrue(blocks("https://start.example/page"))
            assertFalse(blocks("https://a.test/?u=https://start.example/"))
            assertTrue(blocks("https://a.test/pixel.gif"))
            assertFalse(blocks("https://a.test/pixel.gif?x=1"))
            assertTrue(blocks("https://a.test/get?x=1&adslot=3"))
        }
    }

    @Test fun optionsLimitRulesToTypesAndPages() {
        val rules = engine(
            "||media.example^${d}image", "||widget.example^${d}domain=news.test|~sport.news.test",
            "/player.js${d}script,domain=video.test", "@@||media.example/logo.png", "||frames.example^${d}subdocument",
            "||redirected.example^${d}redirect=noop.js", "||away.example^${d}doc", "||ad.example^${d}popup",
            "*${d}script,1p,domain=~fine.test|/regex/", "*${d}script,1p,domain=torrents.*",
        )
        for (candidate in listOf(rules, roundTrip(rules))) {
            // A rule whose "only on" domains cannot be read must not turn into "everywhere".
            assertFalse(candidate.blocks("https://site.test/app.js", "site.test", "site.test", SCRIPT))
            assertTrue(candidate.blocks("https://torrents.co.uk/app.js", "torrents.co.uk", "www.torrents.co.uk", SCRIPT))
            assertTrue(candidate.blocks("https://media.example/a.png", "media.example", "site.test", IMAGE))
            assertFalse(candidate.blocks("https://media.example/a.js", "media.example", "site.test", SCRIPT))
            assertFalse(candidate.blocks("https://media.example/logo.png", "media.example", "site.test", IMAGE))
            assertTrue(candidate.blocks("https://widget.example/w.js", "widget.example", "www.news.test", SCRIPT))
            assertFalse(candidate.blocks("https://widget.example/w.js", "widget.example", "sport.news.test", SCRIPT))
            assertFalse(candidate.blocks("https://widget.example/w.js", "widget.example", "other.test", SCRIPT))
            assertTrue(candidate.blocks("https://cdn.test/player.js", "cdn.test", "video.test", SCRIPT))
            assertFalse(candidate.blocks("https://cdn.test/player.js", "cdn.test", "other.test", SCRIPT))
            assertTrue(candidate.blocks("https://frames.example/", "frames.example", "site.test", FRAME))
            assertFalse(candidate.blocks("https://frames.example/a.png", "frames.example", "site.test", IMAGE))
            assertFalse(candidate.blocks("https://redirected.example/a.js", "redirected.example", "site.test", SCRIPT))
            assertTrue(candidate.blocksPage("https://away.example/", "away.example", null))
            assertFalse(candidate.blocks("https://away.example/a.js", "away.example", "site.test", SCRIPT))
            assertTrue(candidate.blocksPage("https://ad.example/land", "ad.example", "site.test"))
            assertFalse(candidate.blocksPage("https://ad.example/land", "ad.example", null))
            assertFalse(candidate.blocksPage("https://media.example/", "media.example", "site.test"))
        }
    }

    @Test fun pagesGetTheirOwnHidingStylesAndScriptlets() {
        val rules = engine(
            "##.ad-banner", "##.sponsor", "shop.test#@#.sponsor", "~plain.test##.sticky",
            "news.test,blog.test##.promo", "news.test#${d}#body { overflow: auto !important; }",
            "news.test#${d}#body { background: url(https://evil.test/x) }", "news.test#?#div:has-text(Anzeige)",
            "news.test#?#div.overlay:remove()",
            "news.test##.box:style(margin: 0 !important)", "search.*##.shopping",
            "news.test#%#//scriptlet('set-constant', 'adsOff', 'true')", "news.test##+js(nowoif, /ads, 1\\,2/)",
            "news.test#@%#//scriptlet('abort-on-property-read', 'x')", "news.test#%#//scriptlet('abort-on-property-read', 'x')",
            "@@||calm.test^${d}generichide", "@@||free.test^${d}document", "news.test##^script:has-text(ads)",
        )
        for (candidate in listOf(rules, roundTrip(rules, "cosmetic-stamp"))) {
            assertEquals(rules.count, candidate.count)
            assertTrue(".ad-banner{display:none!important}" in candidate.genericCss)
            assertNull(candidate.genericCssFor("news.test"))
            val shop = candidate.genericCssFor("www.shop.test")!!
            assertTrue(".ad-banner" in shop)
            assertFalse(".sponsor" in shop)
            assertFalse(".sticky" in candidate.genericCssFor("plain.test")!!)

            val news = candidate.page("m.news.test")
            assertEquals(
                listOf(".promo{display:none!important}", "body { overflow: auto !important; }", ".box { margin: 0 !important }"),
                news.css,
            )
            assertEquals(
                listOf("div:has-text(Anzeige) { display: none !important; }", "div.overlay { remove: true; }"),
                news.extended,
            )
            assertEquals(listOf("set-constant", "ubo-nowoif"), news.scriptlets.map { it.name })
            assertEquals(listOf("adsOff", "true"), news.scriptlets[0].args)
            assertEquals(listOf("/ads", "1,2/"), news.scriptlets[1].args)
            assertTrue(candidate.page("other.test").isEmpty)
            assertEquals(listOf(".shopping{display:none!important}"), candidate.page("www.search.co.uk").css)

            assertEquals(FilterEngine.EXEMPT_GENERIC, candidate.exemptions("https://calm.test/a", "calm.test"))
            assertEquals(FilterEngine.EXEMPT_ALL, candidate.exemptions("https://www.free.test/", "www.free.test"))
            assertEquals(0, candidate.exemptions("https://news.test/", "news.test"))
        }
    }
}
