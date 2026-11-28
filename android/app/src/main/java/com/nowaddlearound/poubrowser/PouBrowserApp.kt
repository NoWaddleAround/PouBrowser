package com.nowaddlearound.poubrowser

import android.app.Application
import android.content.pm.ApplicationInfo
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView

class PouBrowserApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // chrome://inspect on a desktop can attach to the pages (full element tree), in debug builds only:
        // in a release anyone with adb access could read the open pages and their logins.
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
    }

    internal val blocker by lazy {
        TrackerBlocker(this).also { filter ->
            ServiceWorkerController.getInstance().apply {
                serviceWorkerWebSettings.allowFileAccess = false
                serviceWorkerWebSettings.allowContentAccess = false
                setServiceWorkerClient(object : ServiceWorkerClient() {
                    override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
                        filter.intercept(request)
                })
            }
            filter.refresh()
        }
    }
}
