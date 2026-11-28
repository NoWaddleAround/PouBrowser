package com.nowaddlearound.poubrowser

import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import android.webkit.URLUtil
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer

/** Saves an image, video or a video's sound track the user picked with a long press. Page-started downloads stay blocked. */
internal class MediaDownloads(private val context: Context, private val notice: (String) -> Unit) {
    /** What a request for `url` from the tab must carry so the site serves it as it did to the page. */
    class Source(val url: String, val userAgent: String, val referer: String?, val cookies: String?)

    private val main = Handler(Looper.getMainLooper())
    private val client by lazy { OkHttpClient() }

    fun download(source: Source, fileName: String? = null) {
        val name = fileName ?: fileName(source.url)
        val request = DownloadManager.Request(Uri.parse(source.url))
            .setTitle(name)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .addRequestHeader("User-Agent", source.userAgent)
        source.referer?.let { request.addRequestHeader("Referer", it) }
        source.cookies?.let { request.addRequestHeader("Cookie", it) }
        // shortcut: before Android 10 the file goes to the app's own Downloads folder (no storage permission needed);
        // it shows in the Downloads app and notification but goes with an uninstall. Ask for WRITE_EXTERNAL_STORAGE if that matters.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
        else request.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, name)
        val started = runCatching { context.getSystemService(DownloadManager::class.java).enqueue(request) }.isSuccess
        notice(if (started) L("Download gestartet: $name", "Download started: $name") else L("Download fehlgeschlagen", "Download failed"))
    }

    /** Loads the video into the cache and keeps only its AAC track, without re-encoding. */
    fun downloadAudio(source: Source) {
        val name = audioName(fileName(source.url))
        notice(L("Ton wird geladen: $name", "Loading sound: $name"))
        Thread {
            val video = File.createTempFile("video", ".tmp", context.cacheDir)
            val audio = File.createTempFile("audio", ".m4a", context.cacheDir)
            val result = runCatching {
                fetch(source, video)
                if (!extractAac(video, audio)) L("Der Ton dieses Videos lässt sich nicht als m4a speichern",
                    "This video's sound can't be saved as m4a")
                else {
                    save(audio, name)
                    L("Ton gespeichert: $name", "Sound saved: $name")
                }
            }.getOrElse { L("Ton konnte nicht geladen werden", "The sound could not be loaded") }
            video.delete()
            audio.delete()
            main.post { notice(result) }
        }.start()
    }

    // shortcut: the whole video sits in the cache while the sound is cut out; fine for clips, a problem for files bigger than free space.
    private fun fetch(source: Source, target: File) {
        val request = Request.Builder().url(source.url).header("User-Agent", source.userAgent).apply {
            source.referer?.let { header("Referer", it) }
            source.cookies?.let { header("Cookie", it) }
        }.build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("HTTP ${response.code}")
            target.outputStream().use { response.body!!.byteStream().copyTo(it) }
        }
    }

    /** False when the file has no AAC track: only AAC fits into m4a as it is. */
    private fun extractAac(video: File, audio: File): Boolean {
        val extractor = MediaExtractor()
        try {
            extractor.setDataSource(video.path)
            val track = (0 until extractor.trackCount).firstOrNull {
                extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME) == MediaFormat.MIMETYPE_AUDIO_AAC
            } ?: return false
            extractor.selectTrack(track)
            val format = extractor.getTrackFormat(track)
            val muxer = MediaMuxer(audio.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            try {
                val output = muxer.addTrack(format)
                muxer.start()
                val size = if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE) else 1 shl 20
                val buffer = ByteBuffer.allocate(size.coerceAtLeast(64 * 1024))
                val info = MediaCodec.BufferInfo()
                while (true) {
                    info.size = extractor.readSampleData(buffer, 0)
                    if (info.size < 0) break
                    info.offset = 0
                    info.presentationTimeUs = extractor.sampleTime
                    info.flags = if (extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
                    muxer.writeSampleData(output, buffer, info)
                    extractor.advance()
                }
                muxer.stop()
            } finally {
                muxer.release()
            }
            return true
        } finally {
            extractor.release()
        }
    }

    private fun save(file: File, name: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, "audio/mp4")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw IOException("no Downloads entry")
            try {
                resolver.openOutputStream(uri)!!.use { file.inputStream().copyTo(it) }
                resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            } catch (error: Exception) {
                resolver.delete(uri, null, null)
                throw error
            }
        } else {
            // Same place as download() before Android 10; the Downloads app lists it and shows a notification.
            val target = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), name)
            file.copyTo(target, overwrite = true)
            @Suppress("DEPRECATION")
            context.getSystemService(DownloadManager::class.java)
                .addCompletedDownload(name, name, true, "audio/mp4", target.path, target.length(), true)
        }
    }

    companion object {
        fun fileName(url: String): String =
            URLUtil.guessFileName(url, null, MimeTypeMap.getSingleton().getMimeTypeFromExtension(MimeTypeMap.getFileExtensionFromUrl(url)))

        /** "clip.mp4" → "clip.m4a"; a name without an ending just gets one. */
        fun audioName(videoName: String) = videoName.substringBeforeLast('.').ifBlank { "audio" } + ".m4a"
    }
}
