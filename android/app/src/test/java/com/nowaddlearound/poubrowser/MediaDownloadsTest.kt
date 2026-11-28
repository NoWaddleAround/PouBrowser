package com.nowaddlearound.poubrowser

import org.junit.Assert.assertEquals
import org.junit.Test

class MediaDownloadsTest {
    @Test fun soundTrackTakesTheVideoName() {
        assertEquals("clip.m4a", MediaDownloads.audioName("clip.mp4"))
        assertEquals("my.holiday.m4a", MediaDownloads.audioName("my.holiday.webm"))
        assertEquals("clip.m4a", MediaDownloads.audioName("clip"))
        assertEquals("audio.m4a", MediaDownloads.audioName(".mp4"))
    }
}
