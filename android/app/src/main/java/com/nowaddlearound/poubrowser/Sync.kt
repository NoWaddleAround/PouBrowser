package com.nowaddlearound.poubrowser

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.text.format.DateFormat
import org.json.JSONArray
import org.json.JSONObject
import java.util.Date
import java.util.concurrent.Executors

/**
 * The merge of iOS `Sync.run()`, without any I/O: each part of `PouBrowser-Sync.json` carries the time it last
 * changed, the newer side wins part by part, a device's first sync (stamp 0) joins both sides. Parts this app does
 * not handle (`passwords`) stay in the file exactly as read.
 */
internal object SyncMerge {
    const val FILE = "PouBrowser-Sync.json"
    /** Android keeps no passwords of its own (the system autofill does), so `passwords` is not among them. */
    val parts = listOf("bookmarks", "blockedSites", "unfilteredSites", "scriptlessSites")

    class Local(val stamp: Double, val data: JSONArray)

    /** `file`: the JSON to write back, null when nothing changed. `apply`: parts to take over, with their data. */
    class Outcome(val file: String?, val stamps: Map<String, Double>, val apply: Map<String, JSONArray>, val took: List<String>)

    /** `text`: the file as read, null or blank when there is none. Throws on a file that is not sync JSON. */
    fun merge(text: String?, local: Map<String, Local>, now: Double): Outcome {
        val remote = if (text.isNullOrBlank()) JSONObject() else JSONObject(text).optJSONObject("parts") ?: JSONObject()
        val stamps = HashMap<String, Double>()
        val apply = HashMap<String, JSONArray>()
        val took = ArrayList<String>()
        var wrote = false
        for (part in parts) {
            val mine = local[part] ?: continue
            val entry = remote.optJSONObject(part)
            val theirs = entry?.optDouble("updated", 0.0)?.takeIf { !it.isNaN() } ?: 0.0
            if (entry != null && theirs > mine.stamp) {
                val incoming = valid(part, entry.opt("data")) ?: continue
                took += part
                if (mine.stamp == 0.0) {
                    val joined = join(part, incoming, mine.data)
                    apply[part] = joined
                    remote.put(part, JSONObject().put("updated", number(now)).put("data", joined))
                    stamps[part] = now
                    wrote = true
                } else {
                    apply[part] = incoming
                    stamps[part] = theirs
                }
            } else if ((mine.stamp > theirs || theirs == 0.0) && (mine.stamp > 0 || mine.data.length() > 0)) {
                val stamp = if (mine.stamp > 0) mine.stamp else now
                stamps[part] = stamp
                remote.put(part, JSONObject().put("updated", number(stamp)).put("data", mine.data))
                wrote = true
            }
        }
        val file = if (wrote) JSONObject().put("format", 1).put("parts", remote).toString(2) else null
        return Outcome(file, stamps, apply, took)
    }

    /** Bookmarks as the file holds them: `date` in ms. */
    fun bookmarksJson(pages: List<Page>) = JSONArray().apply {
        for (page in pages) put(JSONObject().put("url", page.url).put("title", page.title).put("date", page.time))
    }

    fun bookmarks(rows: JSONArray): List<Page> = (0 until rows.length()).mapNotNull { index ->
        val row = rows.optJSONObject(index) ?: return@mapNotNull null
        val url = row.optString("url")
        Page(url, row.optString("title").ifEmpty { url }, row.optDouble("date", 0.0).toLong())
    }

    fun sites(rows: JSONArray) = (0 until rows.length()).mapNotNull { rows.opt(it) as? String }

    private fun valid(part: String, data: Any?): JSONArray? {
        val rows = data as? JSONArray ?: return null
        val fits = (0 until rows.length()).all { if (part == "bookmarks") rows.opt(it) is JSONObject else rows.opt(it) is String }
        return rows.takeIf { fits }
    }

    /** Remote first; local bookmarks whose address the remote side lacks; sites as a sorted union. */
    private fun join(part: String, remote: JSONArray, local: JSONArray): JSONArray {
        if (part != "bookmarks") return JSONArray((sites(remote) + sites(local)).toSortedSet().toList())
        val known = (0 until remote.length()).map { remote.getJSONObject(it).optString("url") }.toSet()
        val joined = JSONArray()
        for (index in 0 until remote.length()) joined.put(remote.get(index))
        for (index in 0 until local.length()) local.getJSONObject(index).takeIf { it.optString("url") !in known }?.let(joined::put)
        return joined
    }

    /** Whole milliseconds as integers, as iOS writes them; fractions (iOS change stamps) kept. */
    private fun number(value: Double): Any = if (value == Math.floor(value)) value.toLong() else value
}

/**
 * Account-free sync with the iOS/Mac app through `PouBrowser-Sync.json` in a folder the user picks once
 * (any Storage Access Framework provider: Google Drive, Dropbox, local storage).
 */
internal class Sync(private val context: Context, private val session: BrowserSession, private val applied: () -> Unit) {
    private val prefs = context.getSharedPreferences("sync", Context.MODE_PRIVATE)
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val pending = Runnable { run() }
    private val access = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    /** Taking parts over changes the lists, which must not count as local changes. */
    private var applying = false
    var status = ""
        private set
    val folder: Uri? get() = prefs.getString("sync.folder", null)?.let(Uri::parse)

    init {
        session.syncChanged = ::changed
        session.library.changed = { changed("bookmarks") }
    }

    fun choose(tree: Uri, done: () -> Unit) {
        runCatching { context.contentResolver.takePersistableUriPermission(tree, access) }.onFailure {
            status = L("Ordner ließ sich nicht merken", "Could not keep the folder")
            return done()
        }
        folder?.takeIf { it != tree }?.let(::release)
        prefs.edit().putString("sync.folder", tree.toString()).apply()
        run(done)
    }

    fun stop() {
        folder?.let(::release)
        prefs.edit().remove("sync.folder").apply()
        status = ""
    }

    private fun release(tree: Uri) = runCatching { context.contentResolver.releasePersistableUriPermission(tree, access) }

    /** A part changed on this device: stamp it and write in about 2 s. */
    fun changed(part: String) {
        if (applying) return
        prefs.edit().putString("sync.stamp.$part", System.currentTimeMillis().toDouble().toString()).apply()
        if (folder == null) return
        main.removeCallbacks(pending)
        main.postDelayed(pending, 2000)
    }

    fun folderName(): String? = folder?.let { tree ->
        runCatching {
            val uri = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
            context.contentResolver.query(uri, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)
                ?.use { if (it.moveToFirst()) it.getString(0) else null }
        }.getOrNull()
    }

    /** Reads the file, takes every newer part, writes back what is newer here. */
    fun run(done: () -> Unit = {}) {
        val tree = folder ?: return done()
        main.removeCallbacks(pending)
        val local = SyncMerge.parts.associateWith { part ->
            SyncMerge.Local(prefs.getString("sync.stamp.$part", null)?.toDoubleOrNull() ?: 0.0,
                if (part == "bookmarks") SyncMerge.bookmarksJson(session.library.bookmarks) else JSONArray(session.sites(part)))
        }
        val now = System.currentTimeMillis().toDouble()
        worker.execute {
            val outcome = runCatching {
                val file = find(tree)
                val text = file?.let { uri -> context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() } }
                SyncMerge.merge(text, local, now).also { result ->
                    val json = result.file ?: return@also
                    val target = file ?: DocumentsContract.createDocument(context.contentResolver,
                        DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree)), "application/json", SyncMerge.FILE)
                    checkNotNull(target?.let { context.contentResolver.openOutputStream(it, "wt") }).use { it.write(json.toByteArray()) }
                }
            }
            main.post {
                outcome.onSuccess { result ->
                    applying = true
                    for ((part, data) in result.apply) {
                        if (part == "bookmarks") session.library.replaceBookmarks(SyncMerge.bookmarks(data))
                        else session.replaceSites(part, SyncMerge.sites(data))
                    }
                    applying = false
                    prefs.edit().apply { for ((part, stamp) in result.stamps) putString("sync.stamp.$part", stamp.toString()) }.apply()
                    status = L("Abgeglichen ", "Synced ") + DateFormat.getTimeFormat(context).format(Date()) +
                        if (result.took.isEmpty()) "" else L(" · übernommen: ", " · taken: ") + result.took.joinToString(", ")
                    if (result.apply.isNotEmpty()) applied()
                }.onFailure {
                    status = L("Abgleich fehlgeschlagen: ", "Sync failed: ") + (it.message ?: it.javaClass.simpleName)
                }
                done()
            }
        }
    }

    private fun find(tree: Uri): Uri? {
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        val columns = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME)
        context.contentResolver.query(children, columns, null, null, null)?.use { rows ->
            while (rows.moveToNext()) if (rows.getString(1) == SyncMerge.FILE)
                return DocumentsContract.buildDocumentUriUsingTree(tree, rows.getString(0))
        }
        return null
    }
}
