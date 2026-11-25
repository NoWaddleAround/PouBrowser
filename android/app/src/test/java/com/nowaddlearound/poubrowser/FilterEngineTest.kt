package com.nowaddlearound.poubrowser

import com.nowaddlearound.poubrowser.FilterEngine.Companion.FRAME
import com.nowaddlearound.poubrowser.FilterEngine.Companion.IMAGE
import com.nowaddlearound.poubrowser.FilterEngine.Companion.SCRIPT
import com.nowaddlearound.poubrowser.FilterEngine.Companion.UNKNOWN
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FilterEngineTest {
    private fun engine(vararg lines: String) = FilterEngine.parse(lines.asSequence())
    private val d = "$"

    @Test fun hostRulesMatchWholeDomainsAndHonorExceptions() {
        val rules = engine(
            "||ads.example^", "@@||login.ads.example^", "||strict.login.ads.example^${d}important",
            "||fixed.example^", "||fixed.example^${d}badfilter", "||shop.example^${d}third-party",
        )
        fun blocks(host: String, page: String = "site.test") = rules.blocks("https://$host/x.js", host, page, SCRIPT)
        assertTrue(blocks("pixel.ads.example"))
        assertFalse(blocks("notads.example"))
        assertFalse(blocks("ads.example.evil"))
        assertFalse(blocks("login.ads.example"))
        assertTrue(blocks("strict.login.ads.example"))
        assertFalse(blocks("fixed.example"))
        assertTrue(blocks("shop.example"))
        assertFalse(blocks("cdn.shop.example", page = "www.shop.example"))
    }

    @Test fun pathRulesNeedTheirKeywordSeparatorsAndAnchors() {
        val rules = engine("/banner/ads/*", "-advert-", "||cdn.example/track.js", "|https://start.example/", "/pixel.gif|", "&adslot=")
        fun blocks(url: String) = rules.blocks(url, url.substringAfter("://").substringBefore("/"), "site.test", UNKNOWN)
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

    @Test fun optionsLimitRulesToTypesAndPages() {
        val rules = engine(
            "||media.example^${d}image", "||widget.example^${d}domain=news.test|~sport.news.test",
            "/player.js${d}script,domain=video.test", "@@||media.example/logo.png", "||frames.example^${d}subdocument",
            "||redirected.example^${d}redirect=noop.js", "||away.example^${d}doc", "||ad.example^${d}popup",
            "*${d}script,1p,domain=~fine.test|/regex/", "*${d}script,1p,domain=torrents.*",
        )
        // A rule whose "only on" domains cannot be read must not turn into "everywhere".
        assertFalse(rules.blocks("https://site.test/app.js", "site.test", "site.test", SCRIPT))
        assertTrue(rules.blocks("https://torrents.co.uk/app.js", "torrents.co.uk", "www.torrents.co.uk", SCRIPT))
        assertTrue(rules.blocks("https://media.example/a.png", "media.example", "site.test", IMAGE))
        assertFalse(rules.blocks("https://media.example/a.js", "media.example", "site.test", SCRIPT))
        assertFalse(rules.blocks("https://media.example/logo.png", "media.example", "site.test", IMAGE))
        assertTrue(rules.blocks("https://widget.example/w.js", "widget.example", "www.news.test", SCRIPT))
        assertFalse(rules.blocks("https://widget.example/w.js", "widget.example", "sport.news.test", SCRIPT))
        assertFalse(rules.blocks("https://widget.example/w.js", "widget.example", "other.test", SCRIPT))
        assertTrue(rules.blocks("https://cdn.test/player.js", "cdn.test", "video.test", SCRIPT))
        assertFalse(rules.blocks("https://cdn.test/player.js", "cdn.test", "other.test", SCRIPT))
        assertTrue(rules.blocks("https://frames.example/", "frames.example", "site.test", FRAME))
        assertFalse(rules.blocks("https://frames.example/a.png", "frames.example", "site.test", IMAGE))
        assertFalse(rules.blocks("https://redirected.example/a.js", "redirected.example", "site.test", SCRIPT))
        assertTrue(rules.blocksPage("https://away.example/", "away.example", null))
        assertFalse(rules.blocks("https://away.example/a.js", "away.example", "site.test", SCRIPT))
        assertTrue(rules.blocksPage("https://ad.example/land", "ad.example", "site.test"))
        assertFalse(rules.blocksPage("https://ad.example/land", "ad.example", null))
        assertFalse(rules.blocksPage("https://media.example/", "media.example", "site.test"))
    }

    @Test fun pagesGetTheirOwnHidingStylesAndScriptlets() {
        val rules = engine(
            "##.ad-banner", "##.sponsor", "shop.test#@#.sponsor", "~plain.test##.sticky",
            "news.test,blog.test##.promo", "news.test#${d}#body { overflow: auto !important; }",
            "news.test#${d}#body { background: url(https://evil.test/x) }", "news.test#?#div:has-text(Anzeige)",
            "news.test##.box:style(margin: 0 !important)", "search.*##.shopping",
            "news.test#%#//scriptlet('set-constant', 'adsOff', 'true')", "news.test##+js(nowoif, /ads, 1\\,2/)",
            "news.test#@%#//scriptlet('abort-on-property-read', 'x')", "news.test#%#//scriptlet('abort-on-property-read', 'x')",
            "@@||calm.test^${d}generichide", "@@||free.test^${d}document", "news.test##^script:has-text(ads)",
        )
        assertTrue(".ad-banner{display:none!important}" in rules.genericCss)
        assertNull(rules.genericCssFor("news.test"))
        val shop = rules.genericCssFor("www.shop.test")!!
        assertTrue(".ad-banner" in shop)
        assertFalse(".sponsor" in shop)
        assertFalse(".sticky" in rules.genericCssFor("plain.test")!!)

        val news = rules.page("m.news.test")
        assertEquals(
            listOf(".promo{display:none!important}", "body { overflow: auto !important; }", ".box { margin: 0 !important }"),
            news.css,
        )
        assertEquals(listOf("div:has-text(Anzeige) { display: none !important; }"), news.extended)
        assertEquals(listOf("set-constant", "ubo-nowoif"), news.scriptlets.map { it.name })
        assertEquals(listOf("adsOff", "true"), news.scriptlets[0].args)
        assertEquals(listOf("/ads", "1,2/"), news.scriptlets[1].args)
        assertTrue(rules.page("other.test").isEmpty)
        assertEquals(listOf(".shopping{display:none!important}"), rules.page("www.search.co.uk").css)

        assertEquals(FilterEngine.EXEMPT_GENERIC, rules.exemptions("https://calm.test/a", "calm.test"))
        assertEquals(FilterEngine.EXEMPT_ALL, rules.exemptions("https://www.free.test/", "www.free.test"))
        assertEquals(0, rules.exemptions("https://news.test/", "news.test"))
    }
}
