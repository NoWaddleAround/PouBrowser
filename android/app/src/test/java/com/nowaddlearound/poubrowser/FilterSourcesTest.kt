package com.nowaddlearound.poubrowser

import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException

class FilterSourcesTest {
    @get:Rule val temp = TemporaryFolder()

    @Test fun interruptedMultipartRefreshUsesOnlyInstalledValidatorsAndRules() {
        val urls = listOf("https://test.invalid/base", "https://test.invalid/extra")
        val bodies = mutableMapOf("base" to "||old.example^", "extra" to "||extra.example^")
        var failExtra = false
        val requested = mutableListOf<Pair<String, String?>>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val name = request.url.pathSegments.last()
            val validator = request.header("If-None-Match")
            requested.add(name to validator)
            val rules = bodies.getValue(name)
            val tag = "\"" + rules + "\""
            val status = when {
                failExtra && name == "extra" -> 503
                validator == tag -> 304
                else -> 200
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(status).message("fixture")
                .header("ETag", tag).body((if (status == 200) rules else "").toResponseBody()).build()
        }.build()
        val active = temp.newFolder("installed")
        val next = File(temp.root, "next")
        assertTrue(FilterSources.stage(client, urls, null, active))
        assertFalse(FilterSources.stage(client, urls, active, next))
        assertFalse(next.exists())

        bodies["base"] = "||new.example^"
        failExtra = true
        assertThrows(IOException::class.java) { FilterSources.stage(client, urls, active, next) }
        failExtra = false
        requested.clear()
        assertTrue(FilterSources.stage(client, urls, active, next))
        assertEquals(listOf("base" to "\"||old.example^\"", "extra" to "\"||extra.example^\""), requested)
        fun engine(dir: File) = FilterEngine.Builder().also { builder ->
            FilterSources.read(dir, urls) { builder.add(it) }
        }.build()
        fun blocked(dir: File, host: String) = engine(dir).blocks("https://$host/ad", host, null, FilterEngine.IMAGE)
        assertTrue(blocked(active, "old.example"))
        assertFalse(blocked(active, "new.example"))
        assertTrue(blocked(next, "new.example"))
        assertTrue(blocked(next, "extra.example"))
        assertFalse(blocked(next, "old.example"))
    }
}
