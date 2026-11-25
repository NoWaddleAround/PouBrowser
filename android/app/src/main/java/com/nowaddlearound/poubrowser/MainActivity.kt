package com.nowaddlearound.poubrowser

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.app.PictureInPictureParams
import android.app.PictureInPictureUiState
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextUtils
import android.text.TextWatcher
import android.transition.ChangeBounds
import android.transition.Slide
import android.transition.TransitionManager
import android.transition.TransitionSet
import android.util.Rational
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.accessibility.AccessibilityManager
import android.view.inputmethod.EditorInfo
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.TextView
import android.window.OnBackInvokedDispatcher
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import okhttp3.HttpUrl
import java.io.ByteArrayOutputStream
import java.text.NumberFormat

class MainActivity : Activity(), BrowserSession.Events {
    private lateinit var session: BrowserSession
    private lateinit var blocker: TrackerBlocker
    private lateinit var root: FrameLayout
    private lateinit var browser: LinearLayout
    private lateinit var webHost: FrameLayout
    private lateinit var emptyPage: View
    private lateinit var overview: TabOverview
    private lateinit var videoHost: FrameLayout
    private lateinit var pipButton: View
    private lateinit var exitFullscreenButton: View
    private lateinit var address: EditText
    private lateinit var findBar: LinearLayout
    private lateinit var findInput: EditText
    private lateinit var findCount: TextView
    private var findingView: WebView? = null
    private lateinit var tabCount: TextView
    private lateinit var tabSwitcher: View
    private lateinit var cancelAddress: View
    private lateinit var back: View
    private lateinit var forward: View
    private lateinit var reload: ImageButton
    private lateinit var progress: ProgressBar
    private lateinit var noticeBar: LinearLayout
    private lateinit var bars: List<View>
    private var barsHidden = false
    /** Where the finger was, and how far it has moved in one direction. */
    private var touchY = 0f
    private var travel = 0f
    private lateinit var noticeText: TextView
    private lateinit var noticeOpen: View
    private val main = Handler(Looper.getMainLooper())
    private var noticeDestination: HttpUrl? = null
    private val hideNotice = Runnable {
        noticeBar.visibility = View.GONE
        noticeDestination = null
    }
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var showingTabs = false
    private var openingTabs = false
    private var overviewRequest = 0
    private var wiping = false
    private var enteringPip = false

    private val supportsPip get() = packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
    private val inFullscreen get() = fullscreenCallback != null
    private val fillFrame get() = FrameLayout.LayoutParams(-1, -1)
    private val barItem get() = LinearLayout.LayoutParams(dp(48), dp(48))

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        blocker = (application as PouBrowserApp).blocker
        session = BrowserSession(this, blocker, this)
        buildScreen()
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, ::handleBack)
        }
        if (state == null) handleIncomingIntent(intent)
        pageChanged()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (!wiping) {
            showingTabs = false
            syncLayers()
            handleIncomingIntent(intent)
        }
    }

    private fun handleIncomingIntent(intent: Intent?) {
        if (intent?.action == Intent.ACTION_VIEW) {
            session.openExternal(intent.dataString)
        }
    }

    private fun buildScreen() {
        root = FrameLayout(this).apply {
            isFocusableInTouchMode = true
            setBackgroundColor(getColor(R.color.panel))
        }
        browser = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        bars = listOf(topBar(), addressBar())
        browser.addView(bars[0])
        browser.addView(makeFindBar())
        val page = FrameLayout(this)
        webHost = FrameLayout(this)
        emptyPage = startPage()
        page.addView(webHost, fillFrame)
        page.addView(emptyPage, fillFrame)
        page.addView(makeNotice(), FrameLayout.LayoutParams(-1, -2, Gravity.TOP).apply {
            setMargins(dp(10), dp(8), dp(10), 0)
        })
        browser.addView(page, LinearLayout.LayoutParams(-1, 0, 1f))
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        browser.addView(progress, LinearLayout.LayoutParams(-1, dp(2)))
        browser.addView(bars[1])

        overview = TabOverview(
            this, session,
            onSelect = { tab ->
                showingTabs = false
                clearNotice()
                closeFindBar()
                session.select(tab)
                syncLayers()
            },
            onClose = { tab ->
                clearNotice()
                session.close(tab)
                overview.refresh()
            },
            onNew = {
                showingTabs = false
                clearNotice()
                closeFindBar()
                session.newTab()
                syncLayers()
                address.post { focusAddress() }
            },
            onReopen = {
                showingTabs = false
                clearNotice()
                closeFindBar()
                session.reopenClosedTab()
                syncLayers()
            },
            onDone = ::closeOverview,
        )
        videoHost = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        val videoActions = LinearLayout(this)
        exitFullscreenButton = fullscreenIcon(R.drawable.ic_close, L("Vollbild beenden", "Exit full screen"), ::hideFullscreen)
        pipButton = fullscreenIcon(R.drawable.ic_pip, L("Bild-in-Bild", "Picture in Picture"), ::enterPip)
        videoActions.addView(exitFullscreenButton, barItem.apply { marginEnd = dp(6) })
        videoActions.addView(pipButton, barItem)
        videoHost.addView(videoActions, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.START).apply {
            marginStart = dp(12)
            topMargin = dp(12)
        })
        videoHost.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> updatePipParams() }
        root.addView(browser, fillFrame)
        root.addView(overview, fillFrame)
        root.addView(videoHost, fillFrame)
        setContentView(root)
        val lightBars = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) != Configuration.UI_MODE_NIGHT_YES
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = lightBars
            isAppearanceLightNavigationBars = lightBars
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            if (inFullscreen || isInPictureInPictureMode) {
                view.setPadding(0, 0, 0, 0)
            } else {
                val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
                val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
                view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard))
            }
            insets
        }
        syncLayers()
    }

    private fun topBar() = LinearLayout(this).apply {
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(8), 0, dp(8), 0)
        setBackgroundColor(getColor(R.color.panel))
        back = icon(R.drawable.ic_back, L("Zurück", "Back")) { session.goHistory(-1) }
        forward = icon(R.drawable.ic_forward, L("Vorwärts", "Forward")) { session.goHistory(1) }
        addView(back, barItem.apply { marginEnd = dp(4) })
        addView(forward, barItem)
        addView(View(this@MainActivity), LinearLayout.LayoutParams(0, dp(1), 1f))
        addView(icon(R.drawable.ic_settings, L("Einstellungen", "Settings"), ::showSettings), barItem.apply { marginEnd = dp(4) })
        addView(icon(R.drawable.ic_clear, L("Alles löschen", "Clear everything")) { confirmWipe() }, barItem)
    }

    private fun makeFindBar() = LinearLayout(this).apply {
        findBar = this
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(8), dp(2), dp(8), dp(6))
        setBackgroundColor(getColor(R.color.panel))
        visibility = View.GONE

        val field = LinearLayout(this@MainActivity).apply {
            gravity = Gravity.CENTER_VERTICAL
            background = rounded(getColor(R.color.field), 12)
        }
        findInput = EditText(this@MainActivity).apply {
            background = null
            hint = L("Auf der Seite suchen", "Find on page")
            textSize = 15f
            setHintTextColor(getColor(R.color.muted))
            setTextColor(getColor(R.color.ink))
            inputType = InputType.TYPE_CLASS_TEXT
            imeOptions = EditorInfo.IME_ACTION_SEARCH or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
            setSingleLine(true)
            setPadding(dp(12), 0, dp(8), 0)
            setOnEditorActionListener { _, action, _ ->
                if (action == EditorInfo.IME_ACTION_SEARCH) {
                    session.activeView.findNext(true)
                    true
                } else false
            }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) = Unit
                override fun afterTextChanged(text: Editable?) {
                    val query = text?.toString().orEmpty()
                    if (query.isEmpty()) {
                        session.activeView.clearMatches()
                        findCount.text = ""
                    } else {
                        session.activeView.findAllAsync(query)
                    }
                }
            })
        }
        findCount = label("", 13f, R.color.muted).apply {
            fontFeatureSettings = "'tnum'"
            setPadding(0, 0, dp(10), 0)
        }
        field.addView(findInput, LinearLayout.LayoutParams(0, dp(42), 1f))
        field.addView(findCount, LinearLayout.LayoutParams(-2, -2))
        addView(field, LinearLayout.LayoutParams(0, -2, 1f))
        addView(icon(R.drawable.ic_up, L("Vorheriger Treffer", "Previous match")) { session.activeView.findNext(false) }, barItem)
        addView(icon(R.drawable.ic_down, L("Nächster Treffer", "Next match")) { session.activeView.findNext(true) }, barItem)
        addView(icon(R.drawable.ic_close, L("Suche schließen", "Close search")) { closeFindBar() }, barItem)
    }

    private fun openFindBar() {
        if (session.current.address == null) return
        hideBars(false)
        findBar.visibility = View.VISIBLE
        val query = findInput.text.toString()
        if (query.isNotEmpty()) session.activeView.findAllAsync(query)
        findInput.requestFocus()
        findInput.selectAll()
        WindowCompat.getInsetsController(window, findInput).show(WindowInsetsCompat.Type.ime())
    }

    private fun closeFindBar() {
        if (findBar.visibility != View.VISIBLE) return
        findBar.visibility = View.GONE
        findingView?.clearMatches()
        WindowCompat.getInsetsController(window, findInput).hide(WindowInsetsCompat.Type.ime())
        root.requestFocus()
    }

    private fun fullscreenIcon(symbol: Int, title: String, action: () -> Unit) = icon(symbol, title) { action() }.apply {
        background = pressable(0xD923302D.toInt(), 24)
        setColorFilter(Color.WHITE)
    }

    private fun addressBar() = LinearLayout(this).apply {
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(8), dp(6), dp(8), dp(6))
        setBackgroundColor(getColor(R.color.panel))
        val field = LinearLayout(this@MainActivity).apply {
            gravity = Gravity.CENTER_VERTICAL
            background = rounded(getColor(R.color.field), 12)
        }
        address = EditText(this@MainActivity).apply {
            id = R.id.browser_address
            background = null
            hint = L("Adresse oder Suche", "Address or search")
            textSize = 16f
            setHintTextColor(getColor(R.color.muted))
            setTextColor(getColor(R.color.ink))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_GO or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
            setSingleLine(true)
            setSelectAllOnFocus(true)
            setPadding(dp(12), 0, dp(4), 0)
            setOnFocusChangeListener { _, focused ->
                if (focused) {
                    val fullAddress = session.current.address?.toString().orEmpty()
                    setText(fullAddress)
                    // The same tap can move the caret after the focus callback.
                    post { if (hasFocus() && text.toString() == fullAddress) selectAll() }
                } else setText(session.current.host.orEmpty())
                updateAddressControls()
            }
            setOnEditorActionListener { _, action, key ->
                if (action != EditorInfo.IME_ACTION_GO &&
                    !(key?.keyCode == KeyEvent.KEYCODE_ENTER && key.action == KeyEvent.ACTION_DOWN)
                ) return@setOnEditorActionListener false
                val entered = text.toString()
                endEditing()
                clearNotice()
                closeFindBar()
                session.openInput(entered)
                true
            }
        }
        field.addView(address, LinearLayout.LayoutParams(0, dp(48), 1f))
        reload = icon(R.drawable.ic_refresh, L("Neu laden", "Reload")) {
            if (address.hasFocus()) address.text.clear()
            else if (session.current.progress < 100) {
                session.activeView.stopLoading()
                session.current.progress = 100
                pageChanged()
            } else session.reload()
        }
        field.addView(reload, barItem)
        addView(field, LinearLayout.LayoutParams(0, -2, 1f))
        tabCount = label("1", 12f, R.color.accent, bold = true).center().apply {
            minWidth = dp(24)
            minHeight = dp(24)
            setPadding(dp(4), 0, dp(4), 0)
            fontFeatureSettings = "'tnum'"
            background = rounded(Color.TRANSPARENT, 6, getColor(R.color.accent))
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        tabSwitcher = FrameLayout(this@MainActivity).apply {
            addView(tabCount, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER))
            background = pressable(Color.TRANSPARENT, 12)
            setOnClickListener { openOverview() }
            isFocusable = true
        }
        addView(tabSwitcher, barItem.apply { marginStart = dp(4) })
        cancelAddress = actionLabel(L("Abbrechen", "Cancel"), action = ::endEditing).apply {
            minWidth = 0
            minimumWidth = dp(48)
            background = pressable(Color.TRANSPARENT, 12)
            setPadding(dp(8), 0, dp(8), 0)
            visibility = View.GONE
        }
        addView(cancelAddress, LinearLayout.LayoutParams(-2, dp(48)).apply { marginStart = dp(4) })
        address.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(text: Editable?) = updateAddressControls()
        })
    }

    private fun startPage(): View = FrameLayout(this).apply {
        setBackgroundColor(getColor(R.color.surface))
        val content = LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(16), dp(24), dp(22))
            addView(ImageView(this@MainActivity).apply {
                setImageResource(R.mipmap.ic_launcher)
                scaleType = ImageView.ScaleType.CENTER_CROP
                background = rounded(getColor(R.color.panel), 22)
                clipToOutline = true
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }, LinearLayout.LayoutParams(dp(88), dp(88)))
            addView(label(getString(R.string.app_name), 31f, bold = true).center(), LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = dp(13)
            })
            addView(label(L("Adresse oder Suchbegriff eingeben", "Enter an address or a search"), 16f, R.color.muted).center())
        }
        addView(content, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER))
    }

    private fun makeNotice() = LinearLayout(this).apply {
        noticeBar = this
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(13), dp(6), dp(6), dp(6))
        background = rounded(getColor(R.color.panel), 14, getColor(R.color.line))
        elevation = dp(3).toFloat()
        visibility = View.GONE
        noticeText = label("", 14f).apply {
            maxLines = 2
            ellipsize = TextUtils.TruncateAt.END
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        addView(noticeText, LinearLayout.LayoutParams(0, -2, 1f))
        noticeOpen = actionLabel(L("Öffnen", "Open")) {
            val destination = noticeDestination
            clearNotice()
            if (destination != null) session.open(destination)
        }
        addView(noticeOpen)
    }

    /**
     * The bars slide away while the reader scrolls down and come back on the first bit of scrolling up.
     * This follows the finger, not the page position: hiding the bars resizes the page, which shifts
     * the position too and would bring the bars straight back at the end of a page.
     */
    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) {
            touchY = event.rawY
            travel = 0f
        } else if (event.actionMasked == MotionEvent.ACTION_MOVE && !showingTabs && !inFullscreen && findBar.visibility != View.VISIBLE) {
            val step = event.rawY - touchY
            touchY = event.rawY
            travel = if ((step > 0) == (travel > 0)) travel + step else step
            val scrolled = session.activeView.scrollY
            // Further down than the bars are tall: the page grows by their height when they go, and a
            // short page must not land back at the top, where they return.
            if (travel > dp(8) || scrolled == 0) hideBars(false)
            else if (travel < -dp(40) && scrolled > bars.sumOf { it.height } && !address.hasFocus()) hideBars(true)
        }
        return super.dispatchTouchEvent(event)
    }

    private fun hideBars(hide: Boolean) {
        // TalkBack needs the buttons in reach.
        if (hide == barsHidden || hide && getSystemService(AccessibilityManager::class.java).isTouchExplorationEnabled) return
        barsHidden = hide
        TransitionManager.beginDelayedTransition(
            browser,
            TransitionSet().setDuration(220)
                .addTransition(Slide(Gravity.TOP).addTarget(bars[0]))
                .addTransition(Slide(Gravity.BOTTOM).addTarget(bars[1]))
                .addTransition(ChangeBounds()),
        )
        for (bar in bars) bar.visibility = if (hide) View.GONE else View.VISIBLE
    }

    override fun pageChanged() {
        if (wiping || isDestroyed) return
        if (session.current.progress < 100) hideBars(false)   // a new page starts with the bars
        val active = session.activeView
        if (findingView !== active) {
            findingView?.setFindListener(null)
            findingView = active
            active.setFindListener { activeOrdinal, count, done ->
                if (!done) return@setFindListener
                findCount.text = if (findInput.text.isEmpty()) ""
                else if (count == 0) "0/0"
                else "${activeOrdinal + 1}/$count"
            }
        }
        if (active.parent !== webHost) {
            webHost.removeAllViews()
            (active.parent as? ViewGroup)?.removeView(active)
            webHost.addView(active, fillFrame)
        }
        emptyPage.visibility = if (session.current.address == null) View.VISIBLE else View.GONE
        if (session.current.address == null) closeFindBar()
        if (!address.hasFocus() && address.text.toString() != session.current.host.orEmpty())
            address.setText(session.current.host.orEmpty())
        back.isEnabled = active.canGoBack()
        forward.isEnabled = active.canGoForward()
        back.alpha = if (back.isEnabled) 1f else 0.38f
        forward.alpha = if (forward.isEnabled) 1f else 0.38f
        progress.progress = session.current.progress
        progress.visibility = if (session.current.progress < 100) View.VISIBLE else View.INVISIBLE
        val count = NumberFormat.getIntegerInstance().format(session.tabs.size)
        tabCount.text = count
        tabSwitcher.contentDescription = L("Tabübersicht · $count offen", "Tab overview · $count open")
        updateAddressControls()
    }

    override fun notice(text: String, destination: HttpUrl?) {
        if (wiping || isDestroyed) return
        noticeText.text = text
        noticeDestination = destination
        noticeOpen.visibility = if (destination != null) View.VISIBLE else View.GONE
        noticeBar.visibility = View.VISIBLE
        main.removeCallbacks(hideNotice)
        main.postDelayed(hideNotice, 6500)
    }

    override fun showLinkActions(url: HttpUrl) {
        if (wiping || isDestroyed) return
        val cleaned = BrowserPolicy.cleanUrl(url)
        val options = arrayOf(
            L("In neuem Tab öffnen", "Open in new tab"),
            L("Im Hintergrund öffnen", "Open in background"),
            L("Link kopieren", "Copy link"),
            L("Link teilen", "Share link"),
        )
        AlertDialog.Builder(this)
            .setTitle(cleaned.host)
            .setItems(options) { _, which ->
                when (which) {
                    0 -> session.openInNewTab(cleaned, inBackground = false)
                    1 -> session.openInNewTab(cleaned, inBackground = true)
                    2 -> {
                        getSystemService(ClipboardManager::class.java)
                            ?.setPrimaryClip(ClipData.newPlainText("URL", cleaned.toString()))
                        notice(L("Link kopiert", "Link copied"))
                    }
                    3 -> shareUrl(cleaned.toString(), cleaned.host)
                }
            }
            .show()
    }

    private fun shareUrl(url: String, title: String?) {
        val share = Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, url)
        if (!title.isNullOrBlank()) share.putExtra(Intent.EXTRA_SUBJECT, title)
        startActivity(Intent.createChooser(share, L("Teilen", "Share")))
    }

    private fun clearNotice() {
        main.removeCallbacks(hideNotice)
        hideNotice.run()
    }

    private fun focusAddress() {
        address.requestFocus()
        WindowCompat.getInsetsController(window, address).show(WindowInsetsCompat.Type.ime())
    }

    private fun endEditing() {
        WindowCompat.getInsetsController(window, address).hide(WindowInsetsCompat.Type.ime())
        root.requestFocus()
    }

    private fun updateAddressControls() {
        val editing = address.hasFocus()
        val loading = session.current.progress < 100
        tabSwitcher.visibility = if (editing) View.GONE else View.VISIBLE
        cancelAddress.visibility = if (editing) View.VISIBLE else View.GONE
        val showAction = if (editing) address.text.isNotEmpty() else session.current.address != null
        reload.visibility = if (showAction) View.VISIBLE else View.GONE
        reload.setImageResource(when {
            editing -> R.drawable.ic_clear_text
            loading -> R.drawable.ic_close
            else -> R.drawable.ic_refresh
        })
        reload.contentDescription = when {
            editing -> L("Eingabe leeren", "Clear text")
            loading -> L("Laden abbrechen", "Stop loading")
            else -> L("Neu laden", "Reload")
        }
    }

    private fun openOverview() {
        if (openingTabs || showingTabs || wiping) return
        endEditing()
        closeFindBar()
        openingTabs = true
        val request = ++overviewRequest
        val tab = session.current
        val view = session.activeView
        val url = tab.address
        val width = minOf(view.width, view.height * 4 / 3)
        if (url == null || tab.committed != url || width < 16 || !view.isShown) {
            presentOverview(request)
            return
        }
        val location = IntArray(2)
        view.getLocationInWindow(location)
        val left = location[0] + (view.width - width) / 2
        val top = location[1]
        val source = Rect(left, top, left + width, top + width * 3 / 4)
        val thumbnail = Bitmap.createBitmap(240, 180, Bitmap.Config.ARGB_8888)
        val deadline = Runnable { presentOverview(request) }
        main.postDelayed(deadline, 400)
        try {
            PixelCopy.request(window, source, thumbnail, { result ->
                main.removeCallbacks(deadline)
                if (openingTabs && request == overviewRequest && !isDestroyed &&
                    result == PixelCopy.SUCCESS && session.current === tab && tab.address == url
                ) {
                    tab.preview = ByteArrayOutputStream().use { buffer ->
                        thumbnail.compress(Bitmap.CompressFormat.JPEG, 72, buffer)
                        buffer.toByteArray()
                    }
                }
                thumbnail.recycle()
                presentOverview(request)
            }, main)
        } catch (_: IllegalArgumentException) {
            thumbnail.recycle()
            main.removeCallbacks(deadline)
            presentOverview(request)
        }
    }

    private fun presentOverview(request: Int) {
        if (!openingTabs || request != overviewRequest || isDestroyed) return
        openingTabs = false
        showingTabs = true
        overview.refresh(showCurrent = true)
        syncLayers()
    }

    private fun closeOverview() {
        showingTabs = false
        syncLayers()
    }

    private fun showSettings(anchor: View) {
        if (wiping) return
        PopupMenu(this, anchor).apply {
            val url = session.current.address
            if (url != null) {
                menu.add(0, 7, 0, L("Seite teilen", "Share page"))
                menu.add(0, 8, 0, L("Auf der Seite suchen", "Find on page"))
                menu.add(0, 1, 0, L("JavaScript auf dieser Seite", "JavaScript on this site")).apply {
                    isCheckable = true
                    isChecked = session.scriptsAllowed(url)
                }
                menu.add(0, 5, 0, L("Werbeblocker auf dieser Seite", "Ad blocker on this site")).apply {
                    isCheckable = true
                    isChecked = session.filteringAllowed(url)
                }
                menu.add(0, 9, 0, L("Desktop-Webseite", "Desktop site")).apply {
                    isCheckable = true
                    isChecked = session.desktopAllowed(url)
                }
            }
            menu.add(0, 6, 0, L("Seiten abdunkeln", "Darken pages")).apply {
                isCheckable = true
                isChecked = session.darkPages
            }
            if (supportsPip) menu.add(0, 2, 0, L("Bild-in-Bild", "Picture in Picture")).apply {
                isCheckable = true
                isChecked = session.pipEnabled
            }
            menu.add(0, 3, 0, L("Filterlisten aktualisieren", "Update filter lists"))
            menu.add(blocker.status).isEnabled = false
            menu.add(0, 4, 0, L("Protokoll teilen", "Share log")).isEnabled = session.log.isNotEmpty()
            setOnMenuItemClickListener {
                when (it.itemId) {
                    1 -> session.toggleScripts()
                    2 -> {
                        session.pipEnabled = !session.pipEnabled
                        updatePipParams()
                    }
                    3 -> {
                        blocker.refresh(force = true)
                        notice(L("Filterlisten werden aktualisiert …", "Updating filter lists …"))
                    }
                    5 -> session.toggleFiltering()
                    6 -> session.darkPages = !session.darkPages
                    7 -> session.current.address?.let { page -> shareUrl(page.toString(), session.current.title) }
                    8 -> openFindBar()
                    9 -> session.toggleDesktop()
                    4 -> {
                        val share = Intent(Intent.ACTION_SEND).setType("text/plain")
                            .putExtra(Intent.EXTRA_TEXT, session.log)
                        startActivity(Intent.createChooser(share, L("PouBrowser-Protokoll", "PouBrowser log")))
                    }
                    else -> return@setOnMenuItemClickListener false
                }
                true
            }
            show()
        }
    }

    private fun confirmWipe() {
        if (wiping) return
        AlertDialog.Builder(this)
            .setTitle(L("Browserdaten löschen?", "Clear browsing data?"))
            .setMessage(if (session.supportsFullWipe)
                L("Cookies, Cache, Websitedaten, Verlauf und alle Tabs werden gelöscht.", "Cookies, cache, site data, history and all tabs will be deleted.")
                else L("Cookies, Cache und Tabs werden gelöscht. WebView aktualisieren für vollständige Bereinigung.", "Cookies, cache and tabs will be deleted. Update WebView for a complete clean-up."))
            .setNegativeButton(L("Abbrechen", "Cancel"), null)
            .setPositiveButton(L("Alles löschen", "Clear everything")) { _, _ ->
                clearNotice()
                closeFindBar()
                wiping = true
                browser.isEnabled = false
                browser.visibility = View.GONE
                session.wipe { result ->
                    if (isDestroyed) return@wipe
                    wiping = false
                    browser.isEnabled = true
                    syncLayers()
                    pageChanged()
                    when (result) {
                        BrowserSession.WipeResult.COMPLETE -> notice(L("Browserdaten gelöscht", "Browsing data cleared"))
                        BrowserSession.WipeResult.PARTIAL -> notice(L("Cookies, Cache und Tabs gelöscht.", "Cookies, cache and tabs cleared."))
                        BrowserSession.WipeResult.SAVE_FAILED -> notice(L("Tabs konnten nicht dauerhaft gelöscht werden. Bitte erneut versuchen.", "The tabs could not be removed for good. Please try again."))
                    }
                }
            }
            .show()
            .getButton(AlertDialog.BUTTON_POSITIVE)
            .setTextColor(getColor(R.color.danger))
    }

    override fun showFullscreen(view: View, callback: WebChromeClient.CustomViewCallback) {
        if (inFullscreen || wiping) {
            callback.onCustomViewHidden()
            return
        }
        endEditing()
        closeFindBar()
        openingTabs = false
        showingTabs = false
        fullscreenCallback = callback
        (view.parent as? ViewGroup)?.removeView(view)
        videoHost.addView(view, 0, fillFrame)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        syncLayers()
        updatePipParams()
    }

    override fun hideFullscreen() {
        val callback = fullscreenCallback ?: return
        fullscreenCallback = null
        videoHost.removeViewAt(0)
        callback.onCustomViewHidden()
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enteringPip = false
        syncLayers()
        updatePipParams()
    }

    private fun syncLayers() {
        val floating = isInPictureInPictureMode || enteringPip
        videoHost.visibility = if (inFullscreen) View.VISIBLE else View.GONE
        browser.visibility = if (!showingTabs && !inFullscreen && !floating && !wiping) View.VISIBLE else View.GONE
        overview.visibility = if (showingTabs && !floating) View.VISIBLE else View.GONE
        pipButton.visibility = if (supportsPip && session.pipEnabled && !floating) View.VISIBLE else View.GONE
        exitFullscreenButton.visibility = if (!floating) View.VISIBLE else View.GONE
        val controller = WindowCompat.getInsetsController(window, root)
        val bars = WindowInsetsCompat.Type.systemBars()
        if (inFullscreen) {
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(bars)
        } else controller.show(bars)
        ViewCompat.requestApplyInsets(root)
    }

    private fun pipParams(): PictureInPictureParams {
        val builder = PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9))
        val source = Rect()
        if (inFullscreen && videoHost.getGlobalVisibleRect(source)) {
            val height = minOf(source.height(), source.width() * 9 / 16)
            val width = height * 16 / 9
            if (width > 0 && height > 0) {
                val left = source.centerX() - width / 2
                val top = source.centerY() - height / 2
                builder.setSourceRectHint(Rect(left, top, left + width, top + height))
            }
        }
        if (Build.VERSION.SDK_INT >= 31) builder.setAutoEnterEnabled(inFullscreen && session.pipEnabled)
        return builder.build()
    }

    private fun updatePipParams() {
        if (supportsPip && !isInPictureInPictureMode && !enteringPip) setPictureInPictureParams(pipParams())
    }

    private fun enterPip() {
        if (!supportsPip || !session.pipEnabled || !inFullscreen || isInPictureInPictureMode) return
        val params = pipParams()
        enteringPip = true
        syncLayers()
        val entered = runCatching { enterPictureInPictureMode(params) }.getOrDefault(false)
        if (!entered) {
            enteringPip = false
            syncLayers()
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (Build.VERSION.SDK_INT < 31) enterPip()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        enteringPip = false
        syncLayers()
    }

    override fun onPictureInPictureUiStateChanged(pipState: PictureInPictureUiState) {
        super.onPictureInPictureUiStateChanged(pipState)
        if (Build.VERSION.SDK_INT >= 35 && pipState.isTransitioningToPip) {
            enteringPip = true
            syncLayers()
        }
    }

    // Android 13 and later dispatch through the OnBackInvokedCallback registered in onCreate.
    @SuppressLint("GestureBackNavigation")
    @Deprecated("Android 12 and earlier")
    override fun onBackPressed() = handleBack()

    private fun handleBack() {
        if (wiping) return
        when {
            inFullscreen -> hideFullscreen()
            showingTabs -> closeOverview()
            findBar.visibility == View.VISIBLE -> closeFindBar()
            address.hasFocus() -> endEditing()
            session.goBack() -> clearNotice()
            else -> finish()
        }
    }

    override fun onStop() {
        if (!wiping) session.save()
        super.onStop()
    }

    @Suppress("DEPRECATION")
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW &&
            level != android.content.ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN && !wiping
        ) {
            session.trim()
            if (showingTabs) overview.refresh()
        }
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        findingView?.setFindListener(null)
        findingView = null
        hideFullscreen()
        session.destroy()
        super.onDestroy()
    }
}
