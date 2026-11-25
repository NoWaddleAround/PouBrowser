package com.nowaddlearound.poubrowser

import android.app.Application
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse

class PouBrowserApp : Application() {
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
