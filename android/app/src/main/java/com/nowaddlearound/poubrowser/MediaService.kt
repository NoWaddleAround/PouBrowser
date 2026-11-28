package com.nowaddlearound.poubrowser

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder

/**
 * Chrome's media notification: keeps a page's sound going while the app is in the background, with play and
 * pause in the notification, on the lock screen and on headphones. Runs only while a tab plays or just did.
 */
class MediaService : Service() {
    /** What the notification shows and controls; set by the activity. */
    interface Player {
        val title: String
        val site: String
        val playing: Boolean
        fun toggle()
        fun pause()
    }

    private lateinit var session: MediaSession

    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, L("Wiedergabe", "Playback"), NotificationManager.IMPORTANCE_LOW))
        session = MediaSession(this, "PouBrowser").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() { if (player?.playing == false) player?.toggle() }
                override fun onPause() { player?.pause() }
                override fun onStop() { player?.pause() }
            })
            isActive = true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            TOGGLE -> player?.toggle()
            STOP -> {
                player?.pause()
                stopSelf()
                return START_NOT_STICKY
            }
        }
        show()
        return START_NOT_STICKY
    }

    private fun show() {
        val player = player
        val playing = player?.playing == true
        session.setMetadata(MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, player?.title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, player?.site).build())
        session.setPlaybackState(PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_STOP)
            .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
            .build())
        fun command(action: String) = PendingIntent.getService(this, action.hashCode(),
            Intent(this, MediaService::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_globe)
            .setContentTitle(player?.title ?: "PouBrowser")
            .setContentText(player?.site)
            .setContentIntent(open)
            .setDeleteIntent(command(STOP))
            .setOngoing(playing)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(Notification.Action.Builder(
                Icon.createWithResource(this, if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play),
                if (playing) L("Pause", "Pause") else L("Abspielen", "Play"), command(TOGGLE)).build())
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0))
            .build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else startForeground(ID, notification)
        // Started with startForegroundService: startForeground comes first, even when the sound has gone meanwhile.
        if (player == null) stopSelf()
        // Paused: the notification stays for play, but can be swiped away, and Android may end the service.
        else if (!playing) stopForeground(STOP_FOREGROUND_DETACH)
    }

    override fun onDestroy() {
        running = false
        session.release()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        var player: Player? = null
        private var running = false
        private const val CHANNEL = "playback"
        private const val ID = 7
        private const val TOGGLE = "toggle"
        private const val STOP = "stop"

        /** Starts or refreshes the notification while something plays; ends it when nothing has sound any more. */
        fun update(context: Context) {
            val player = player
            val intent = Intent(context, MediaService::class.java)
            if (player == null) {
                if (running) context.stopService(intent)
                running = false
                return
            }
            if (!player.playing && !running) return
            // From the background Android may refuse a start (Android 12+); the next change in front tries again.
            running = runCatching { context.startForegroundService(intent) }.isSuccess || running
        }
    }
}
