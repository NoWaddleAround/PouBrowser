package com.nowaddlearound.poubrowser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DevToolsTest {
    @Test fun sourceIsOneEscapedSpanPerLine() {
        val html = DevTools.sourceHtml("<p>a & b</p>\n\n<script>x</script>")
        val body = html.substringAfter("<pre>").substringBefore("</pre>")
        assertEquals("<span>&lt;p>a &amp; b&lt;/p></span><span></span><span>&lt;script>x&lt;/script></span>", body)
        assertTrue("counter(line)" in html)
    }

    @Test fun typeNames() {
        assertEquals("image", DevTools.typeName(FilterEngine.IMAGE))
        assertEquals("document", DevTools.typeName(FilterEngine.DOCUMENT))
        assertEquals("–", DevTools.typeName(FilterEngine.UNKNOWN))
    }
}
