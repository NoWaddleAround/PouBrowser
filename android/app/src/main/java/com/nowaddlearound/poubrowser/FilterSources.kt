package com.nowaddlearound.poubrowser

import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.Properties

/** Downloads into the inactive directory. The caller switches directories only after building the engine. */
internal object FilterSources {
    private const val maxBytes = 16L * 1024 * 1024

    fun stage(client: OkHttpClient, urls: List<String>, installed: File?, next: File): Boolean {
        val validators = Properties()
        if (installed != null) {
            try {
                File(installed, "validators").inputStream().use(validators::load)
            } catch (_: IOException) {
                validators.clear()
            }
        }
        val reused = mutableListOf<Int>()
        val nextValidators = Properties()
        urls.forEachIndexed { index, url ->
            val source = installed?.let { File(it, "$index.txt") }
            val cached = source != null && source.isFile && validators["url.$index"] == url &&
                validators["bytes.$index"] == source.length().toString()
            val request = Request.Builder().url(url)
            if (cached) {
                validators.getProperty("etag.$index")?.let { request.header("If-None-Match", it) }
                validators.getProperty("modified.$index")?.let { request.header("If-Modified-Since", it) }
            }
            val sent = request.build()
            client.newCall(sent).execute().use { response ->
                val unchanged = response.code == 304 && cached &&
                    (sent.header("If-None-Match") != null || sent.header("If-Modified-Since") != null)
                if (unchanged) {
                    reused.add(index)
                } else {
                    val body = response.body
                    if (response.code != 200 || body == null) throw IOException("HTTP " + response.code)
                    val buffer = body.source()
                    if (buffer.request(maxBytes + 1)) throw IOException("Filter file too large")
                    next.mkdirs()
                    File(next, "$index.txt").outputStream().use { buffer.inputStream().copyTo(it) }
                }
                nextValidators.setProperty("url.$index", url)
                val file = if (unchanged) requireNotNull(source) else File(next, "$index.txt")
                nextValidators.setProperty("bytes.$index", file.length().toString())
                for ((key, header) in listOf("etag" to "ETag", "modified" to "Last-Modified")) {
                    val value = response.header(header) ?: if (unchanged) validators.getProperty("$key.$index") else null
                    if (value != null) nextValidators.setProperty("$key.$index", value)
                }
            }
        }
        if (reused.size == urls.size) return false
        for (index in reused) {
            File(requireNotNull(installed), "$index.txt").copyTo(File(next, "$index.txt"), overwrite = true)
        }
        File(next, "validators").outputStream().use { nextValidators.store(it, null) }
        return true
    }

    fun read(directory: File, urls: List<String>, add: (String) -> Unit) {
        for (index in urls.indices) File(directory, "$index.txt").bufferedReader().useLines { it.forEach(add) }
    }
}
