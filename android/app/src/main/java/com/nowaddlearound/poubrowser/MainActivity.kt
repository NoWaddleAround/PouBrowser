package com.nowaddlearound.poubrowser

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.app.Dialog
import android.app.PictureInPictureParams
import android.app.PictureInPictureUiState
import android.content.ClipData
import android.app.DownloadManager
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.webkit.ValueCallback
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.print.PrintManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.view.ActionMode
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
import android.view.MenuItem
import android.view.SubMenu
import android.view.MotionEvent
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.accessibility.AccessibilityManager
import android.view.inputmethod.EditorInfo
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListPopupWindow
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.window.OnBackInvokedDispatcher
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewCompat
import okhttp3.HttpUrl
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayOutputStream
import java.text.NumberFormat

class MainActivity : Activity(), BrowserSession.Events {
    private lateinit var session: BrowserSession
    private lateinit var sync: Sync
    private lateinit var blocker: TrackerBlocker
    private lateinit var root: FrameLayout
    private lateinit var browser: LinearLayout
    private lateinit var webHost: FrameLayout
    private lateinit var emptyPage: View
    private lateinit var startHint: TextView
    private lateinit var favourites: LinearLayout
    private lateinit var blockedTotal: TextView
    private lateinit var settingsButton: ImageButton
    private lateinit var blockedBadge: TextView
    private lateinit var suggestions: ListPopupWindow
    private lateinit var overview: TabOverview
    private lateinit var videoHost: FrameLayout
    private lateinit var pipButton: View
    private lateinit var exitFullscreenButton: View
    private lateinit var address: EditText
    private lateinit var addressField: LinearLayout
    private lateinit var findBar: LinearLayout
    private lateinit var devTools: DevToolsPanel
    private lateinit var findInput: EditText
    private lateinit var findCount: TextView
    private var findingView: WebView? = null
    private lateinit var tabSwitcher: TextView
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
    private var noticeRun: (() -> Unit)? = null
    private val hideNotice = Runnable {
        noticeBar.visibility = View.GONE
        noticeDestination = null
        noticeRun = null
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
        sync = Sync(this, session) { pageChanged() }
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
        // Under the page, as Chrome docks them, so "Inspect element" can still reach the page.
        devTools = DevToolsPanel(this, session, ::closeDevTools).apply { visibility = View.GONE }
        browser.addView(devTools, LinearLayout.LayoutParams(-1, 0, 0.8f))
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
        // The settings button carries the number of requests stopped on the page in front, as on iOS.
        addView(FrameLayout(this@MainActivity).apply {
            settingsButton = icon(R.drawable.ic_settings, L("Einstellungen", "Settings"), ::showSettings)
            addView(settingsButton, FrameLayout.LayoutParams(-1, -1))
            blockedBadge = TextView(this@MainActivity).apply {
                textSize = 9f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                setTextColor(Color.WHITE)
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(Color.rgb(0xE5, 0x48, 0x4D))
                    cornerRadius = dp(8).toFloat()
                }
                setPadding(dp(4), 0, dp(4), 0)
                visibility = View.GONE
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }
            addView(blockedBadge, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.END).apply {
                topMargin = dp(4)
                marginEnd = dp(2)
            })
        }, barItem.apply { marginEnd = dp(4) })
        addView(icon(R.drawable.ic_clear, L("Alles löschen", "Clear everything")) { confirmWipe() }.apply {
            imageTintList = ColorStateList.valueOf(getColor(R.color.danger))
        }, barItem)
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
        addressField = field
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
                } else setText(shownAddress())
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
        tabSwitcher = actionLabel("1", action = ::openOverview).apply {
            textSize = 12f
            minWidth = dp(48)
            minimumWidth = dp(48)
            setPadding(dp(6), 0, dp(6), 0)
            fontFeatureSettings = "'tnum'"
            background = pressable(Color.TRANSPARENT, 12)
            leadingIcon(R.drawable.ic_tabs)
        }
        addView(tabSwitcher, LinearLayout.LayoutParams(-2, dp(48)).apply { marginStart = dp(4) })
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
            override fun afterTextChanged(text: Editable?) {
                updateAddressControls()
                updateSuggestions()
            }
        })
        suggestions = ListPopupWindow(this@MainActivity).apply {
            anchorView = field
            inputMethodMode = ListPopupWindow.INPUT_METHOD_NEEDED
            setOnItemClickListener { parent, _, position, _ ->
                val page = parent.getItemAtPosition(position) as Page
                endEditing()
                clearNotice()
                closeFindBar()
                BrowserPolicy.webUrl(page.url)?.let(session::open)
            }
        }
    }

    /** Matches from bookmarks and history only: typed text never leaves the device. */
    private fun updateSuggestions() {
        val text = address.text.toString()
        // Focusing fills in the current address; suggestions start once the user types.
        val matches = if (!address.hasFocus() || text == session.current.address?.toString()) emptyList()
        else suggest(text, session.library.bookmarks, session.library.history)
        if (matches.isEmpty()) {
            suggestions.dismiss()
            return
        }
        suggestions.setAdapter(pageAdapter(matches))
        suggestions.show()
    }

    private fun pageAdapter(pages: List<Page>) = object : ArrayAdapter<Page>(this, 0, pages) {
        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val page = getItem(position)!!
            val host = BrowserPolicy.webUrl(page.url)?.host?.removePrefix("www.") ?: page.url
            val text = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                addView(label(page.title.ifBlank { host }, 16f).apply {
                    maxLines = 1
                    ellipsize = TextUtils.TruncateAt.END
                })
                addView(label(host, 13f, R.color.muted).apply {
                    maxLines = 1
                    ellipsize = TextUtils.TruncateAt.END
                })
            }
            return LinearLayout(context).apply {
                setPadding(dp(16), dp(8), dp(16), dp(8))
                minimumHeight = dp(60)
                gravity = Gravity.CENTER_VERTICAL
                addView(siteBadge(host, 36), LinearLayout.LayoutParams(dp(36), dp(36)).apply { marginEnd = dp(14) })
                addView(text, LinearLayout.LayoutParams(0, -2, 1f))
            }
        }
    }

    private fun startPage(): View = ScrollView(this).apply {
        setBackgroundColor(getColor(R.color.surface))
        isFillViewport = true
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
            }, LinearLayout.LayoutParams(dp(64), dp(64)))   // the 192 px icon stays sharp at this size
            addView(label(getString(R.string.app_name), 26f, bold = true).center(), LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = dp(10)
            })
            startHint = label(L("Adresse oder Suchbegriff eingeben", "Enter an address or a search"), 16f, R.color.muted).center()
            addView(startHint)
            favourites = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL }
            addView(favourites, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(20) })
            blockedTotal = label("", 13f, R.color.muted).center()
                .leadingIcon(R.drawable.ic_shield).apply { fontFeatureSettings = "'tnum'" }
            addView(blockedTotal, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(20) })
        }
        addView(content, FrameLayout.LayoutParams(-1, -2))
    }

    /** Bookmarks as tiles; without bookmarks the most visited pages; with neither the hint. */
    private fun fillStartPage() {
        val library = session.library
        val pages = library.bookmarks.take(8).ifEmpty { byVisits(library.history).take(8) }
        val total = NumberFormat.getIntegerInstance().format(session.blockedTotal)
        blockedTotal.text = blocker.status + "\n" + L("$total Werbung und Tracker blockiert", "$total ads and trackers blocked")
        favourites.removeAllViews()
        startHint.visibility = if (pages.isEmpty()) View.VISIBLE else View.GONE
        if (pages.isEmpty()) return
        val hasBookmarks = library.bookmarks.isNotEmpty()
        favourites.addView(
            label(if (hasBookmarks) L("Favoriten", "Favourites") else L("Häufig besucht", "Frequently visited"), 17f, bold = true)
                .leadingIcon(if (hasBookmarks) R.drawable.ic_star else R.drawable.ic_history, getColor(R.color.muted)),
            LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12); marginStart = dp(4) },
        )
        for (row in pages.chunked(4)) {
            val line = LinearLayout(this)
            for (page in row) line.addView(tile(page), LinearLayout.LayoutParams(0, -2, 1f))
            repeat(4 - row.size) { line.addView(View(this), LinearLayout.LayoutParams(0, 0, 1f)) }
            favourites.addView(line, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) })
        }
    }

    /** The same site gets the same colour as on iOS (hue from the sum of its letters). */
    private fun tileColour(host: String) =
        Color.HSVToColor(floatArrayOf((host.sumOf { it.code } % 360).toFloat(), 0.55f, 0.7f))

    /** The site's own icon when one was seen, else its first letter on its colour: tiles, lists and suggestions. */
    private fun siteBadge(host: String, size: Int): View {
        val icon = session.iconFile(host).takeIf { it.exists() }?.let { android.graphics.BitmapFactory.decodeFile(it.path) }
        val radius = size / 4
        return (if (icon != null) ImageView(this).apply {
            setImageBitmap(icon)
            scaleType = ImageView.ScaleType.FIT_CENTER
            val inset = dp(size) / 5
            setPadding(inset, inset, inset, inset)
            background = rounded(getColor(R.color.field), radius)
        } else label(host.take(1).uppercase(), size * 0.4f, bold = true).center().apply {
            setTextColor(Color.WHITE)
            background = rounded(tileColour(host), radius)
        }).apply { importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO }
    }

    private fun tile(page: Page): View {
        val url = BrowserPolicy.webUrl(page.url)
        val host = url?.host?.removePrefix("www.") ?: page.url
        val title = page.title.ifBlank { host }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(4), dp(8), dp(4), dp(8))
            background = pressable(Color.TRANSPARENT, 12)
            contentDescription = title
            isFocusable = true
            addView(siteBadge(host, 56), LinearLayout.LayoutParams(dp(56), dp(56)))
            addView(label(title, 12f).center().apply {
                maxLines = 2
                ellipsize = TextUtils.TruncateAt.END
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
            setOnClickListener {
                clearNotice()
                url?.let(session::open)
            }
        }
    }

    private fun makeNotice() = LinearLayout(this).apply {
        noticeBar = this
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(13), dp(6), dp(6), dp(6))
        background = rounded(getColor(R.color.panel), 14, getColor(R.color.line))
        elevation = dp(3).toFloat()
        visibility = View.GONE
        setOnClickListener { clearNotice() }   // lasting notices have no timer
        noticeText = label("", 14f).apply {
            maxLines = 2
            ellipsize = TextUtils.TruncateAt.END
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        addView(noticeText, LinearLayout.LayoutParams(0, -2, 1f))
        noticeOpen = actionLabel(L("Öffnen", "Open")) {
            val destination = noticeDestination
            val run = noticeRun
            clearNotice()
            if (run != null) run() else if (destination != null) session.open(destination)
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
        } else if (event.actionMasked == MotionEvent.ACTION_MOVE && !showingTabs && !inFullscreen && findBar.visibility != View.VISIBLE &&
            devTools.visibility != View.VISIBLE
        ) {
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

    override fun blockedChanged() {
        if (isDestroyed) return
        val count = if (session.current.address == null) 0 else session.current.blocked.get()
        blockedBadge.visibility = if (count > 0) View.VISIBLE else View.GONE
        blockedBadge.text = if (count > 99) "99+" else count.toString()
        settingsButton.contentDescription = if (count > 0) L("Einstellungen, $count blockiert", "Settings, $count blocked")
            else L("Einstellungen", "Settings")
    }

    override fun devChanged() {
        if (!isDestroyed) devTools.update()
    }

    private fun openDevTools() {
        hideBars(false)
        devTools.visibility = View.VISIBLE
        devTools.update()
    }

    private fun closeDevTools() {
        devTools.visibility = View.GONE
        WindowCompat.getInsetsController(window, devTools).hide(WindowInsetsCompat.Type.ime())
        root.requestFocus()
    }

    override fun pageChanged() {
        if (wiping || isDestroyed) return
        blockedChanged()
        devTools.update()
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
        // A popup starts without an address (about:blank, a form posted into it) and must stay visible.
        emptyPage.visibility = if (session.current.address == null && session.current.opener == null) View.VISIBLE else View.GONE
        if (session.current.address == null) fillStartPage()
        if (session.current.address == null) closeFindBar()
        if (!address.hasFocus() && address.text.toString() != shownAddress()) address.setText(shownAddress())
        back.isEnabled = active.canGoBack()
        forward.isEnabled = active.canGoForward()
        back.alpha = if (back.isEnabled) 1f else 0.38f
        forward.alpha = if (forward.isEnabled) 1f else 0.38f
        progress.progress = session.current.progress
        progress.visibility = if (session.current.progress < 100) View.VISIBLE else View.INVISIBLE
        val count = NumberFormat.getIntegerInstance().format(session.tabs.size)
        tabSwitcher.text = count
        tabSwitcher.contentDescription = L("Tabübersicht · $count offen", "Tab overview · $count open")
        val private = session.current.isPrivate
        if (addressField.tag != private) {
            addressField.tag = private
            // As in Chrome Incognito: no screenshots, recordings or app-switcher picture of a private tab.
            if (private) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            addressField.background = rounded(getColor(if (private) R.color.private_field else R.color.field), 12)
            address.hint = if (private) L("Privat: Adresse oder Suche", "Private: address or search") else L("Adresse oder Suche", "Address or search")
        }
        updateAddressControls()
    }

    override fun notice(text: String, destination: HttpUrl?, lasting: Boolean) {
        if (wiping || isDestroyed) return
        noticeText.text = text
        noticeDestination = destination
        noticeRun = null
        (noticeOpen as TextView).apply {
            this.text = L("Öffnen", "Open")
            leadingIcon(R.drawable.ic_open)
        }
        noticeOpen.visibility = if (destination != null) View.VISIBLE else View.GONE
        noticeBar.visibility = View.VISIBLE
        main.removeCallbacks(hideNotice)
        if (!lasting) main.postDelayed(hideNotice, 6500)
    }

    override fun noticeAction(text: String, action: String, lasting: Boolean, run: () -> Unit) {
        notice(text, null, lasting)
        if (wiping || isDestroyed) return
        noticeRun = run
        (noticeOpen as TextView).apply {
            this.text = action
            setCompoundDrawablesRelative(null, null, null, null)
        }
        noticeOpen.visibility = View.VISIBLE
    }

    override fun askLogin(host: String, realm: String, done: (Pair<String, String>?) -> Unit) {
        if (wiping || isDestroyed) return done(null)
        val user = EditText(this).apply {
            hint = L("Benutzername", "Username")
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            isSingleLine = true
        }
        val password = EditText(this).apply {
            hint = L("Passwort", "Password")
            isSingleLine = true   // before the input type: it would drop the password mask again
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val fields = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(4), dp(20), 0)
            addView(user)
            addView(password)
        }
        var answered = false
        AlertDialog.Builder(this)
            .setTitle(L("Anmelden", "Sign in"))
            .setMessage(host + if (realm.isNotBlank()) " · $realm" else "")
            .setView(fields)
            .setPositiveButton(L("Anmelden", "Sign in")) { _, _ ->
                answered = true
                done(user.text.toString() to password.text.toString())
            }
            .setNegativeButton(L("Abbrechen", "Cancel"), null)
            .setOnDismissListener { if (!answered) done(null) }
            .show()
    }

    override fun askCertificate(host: String, reason: String, done: (Boolean) -> Unit) {
        if (wiping || isDestroyed) return done(false)
        var answered = false
        AlertDialog.Builder(this)
            .setTitle(L("Verbindung nicht privat", "Connection not private"))
            .setMessage(L("$host\n\n$reason\n\nAngreifer könnten mitlesen, was du hier eingibst.",
                "$host\n\n$reason\n\nAttackers might read what you enter here."))
            .setPositiveButton(L("Zurück", "Back")) { _, _ -> }
            .setNegativeButton(L("Trotzdem fortfahren", "Proceed anyway")) { _, _ ->
                answered = true
                done(true)
            }
            .setOnDismissListener { if (!answered) done(false) }
            .show()
            .getButton(AlertDialog.BUTTON_NEGATIVE)
            .setTextColor(getColor(R.color.danger))
    }

    override fun askUnresponsive(done: (Boolean) -> Unit) {
        if (wiping || isDestroyed) return done(false)
        var answered = false
        AlertDialog.Builder(this)
            .setTitle(L("Seite reagiert nicht", "Page unresponsive"))
            .setMessage(session.current.host.orEmpty())
            .setPositiveButton(L("Warten", "Wait")) { _, _ -> }
            .setNegativeButton(L("Beenden", "End")) { _, _ ->
                answered = true
                done(true)
            }
            .setOnDismissListener { if (!answered) done(false) }
            .show()
    }

    override fun showLinkActions(link: HttpUrl?, image: HttpUrl?) {
        if (wiping || isDestroyed) return
        val cleaned = link?.let(BrowserPolicy::cleanUrl)
        val options = buildList<Triple<String, Int, () -> Unit>> {
            if (cleaned != null) {
                add(Triple(L("In neuem Tab öffnen", "Open in new tab"), R.drawable.ic_add) { session.openInNewTab(cleaned, inBackground = false) })
                add(Triple(L("Im Hintergrund öffnen", "Open in background"), R.drawable.ic_tabs) { session.openInNewTab(cleaned, inBackground = true) })
                add(Triple(L("Link kopieren", "Copy link"), R.drawable.ic_copy) {
                    getSystemService(ClipboardManager::class.java)
                        ?.setPrimaryClip(ClipData.newPlainText("URL", cleaned.toString()))
                    notice(L("Link kopiert", "Link copied"))
                })
                add(Triple(L("Link teilen", "Share link"), R.drawable.ic_share) { shareUrl(cleaned.toString(), cleaned.host) })
            }
            if (image != null) add(Triple(L("Bild laden", "Save image"), R.drawable.ic_download) { session.downloadMedia(image, audioOnly = false) })
        }
        showActions((cleaned ?: image)?.host, options)
    }

    override fun offerDownload(url: HttpUrl, name: String) {
        if (wiping || isDestroyed) return
        AlertDialog.Builder(this)
            .setTitle(L("Datei laden?", "Download file?"))
            .setMessage(name + "\n" + url.host)
            .setPositiveButton(L("Laden", "Download")) { _, _ -> session.downloadMedia(url, audioOnly = false, name = name) }
            .setNegativeButton(L("Abbrechen", "Cancel"), null)
            .show()
    }

    private var filePick: ValueCallback<Array<Uri>?>? = null

    override fun pickFiles(params: WebChromeClient.FileChooserParams, done: ValueCallback<Array<Uri>?>): Boolean {
        filePick?.onReceiveValue(null)
        val pick = params.createIntent()
        if (params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        filePick = done
        return runCatching { startActivityForResult(pick, PICK_FILES) }.onFailure { filePick = null }.isSuccess
    }

    override fun showMediaActions(kind: String, url: HttpUrl) {
        if (wiping || isDestroyed) return
        val options = buildList<Triple<String, Int, () -> Unit>> {
            add(Triple(if (kind == "video") L("Video laden", "Save video") else L("Audio laden", "Save audio"), R.drawable.ic_download) {
                session.downloadMedia(url, audioOnly = false)
            })
            if (kind == "video") add(Triple(L("Nur Ton laden (m4a)", "Sound only (m4a)"), R.drawable.ic_download) { session.downloadMedia(url, audioOnly = true) })
        }
        showActions(url.host, options, cancel = true)
    }

    /** A list of actions with leading icons, as the long-press menus show them. */
    private fun showActions(title: String?, options: List<Triple<String, Int, () -> Unit>>, cancel: Boolean = false) {
        val rows = object : ArrayAdapter<String>(this, android.R.layout.simple_list_item_1, options.map { it.first }) {
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View =
                (super.getView(position, convertView, parent) as TextView)
                    .leadingIcon(options[position].second, getColor(R.color.muted))
        }
        AlertDialog.Builder(this)
            .setTitle(title)
            .setAdapter(rows) { _, which -> options[which].third() }
            .apply { if (cancel) setNegativeButton(L("Abbrechen", "Cancel"), null) }
            .show()
    }

    override fun share(text: String, title: String?) = shareUrl(text, title)

    private fun shareUrl(url: String, title: String?) {
        val share = Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, url)
        if (!title.isNullOrBlank()) share.putExtra(Intent.EXTRA_SUBJECT, title)
        startActivity(Intent.createChooser(share, L("Teilen", "Share")))
    }

    override fun clearNotice() {
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

    /** The host, as in Chrome with "Nicht sicher" in front for unencrypted pages off the home network. */
    private fun shownAddress(): String {
        val url = session.current.address ?: return ""
        val warning = if (url.scheme == "http" && !BrowserPolicy.isLocal(url.host)) L("Nicht sicher · ", "Not secure · ") else ""
        return warning + session.current.host.orEmpty()
    }

    private fun updateAddressControls() {
        val editing = address.hasFocus()
        val loading = session.current.progress < 100
        val addressIcon = when {
            session.current.isPrivate -> R.drawable.ic_private
            editing || session.current.address == null -> R.drawable.ic_search
            else -> R.drawable.ic_globe
        }
        if (address.tag != addressIcon) {
            address.tag = addressIcon
            address.leadingIcon(addressIcon, getColor(if (session.current.isPrivate) R.color.private_ink else R.color.muted))
        }
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

    /** The licences of the app and everything it bundles or downloads; the file is shared with iOS. */
    private fun showLicenses() {
        val text = assets.open("licenses.txt").bufferedReader().use { it.readText() }
        AlertDialog.Builder(this)
            .setTitle(L("Lizenzen", "Licenses"))
            .setMessage(text)
            .setPositiveButton(L("Fertig", "Done"), null)
            .show()
    }

    /** Bookmarks or history; tap opens in this tab, long press removes. */
    private fun showLibrary(history: Boolean = false) {
        val library = session.library
        val pages = (if (history) library.history else library.bookmarks).toMutableList()
        val rows = pageAdapter(pages)
        val builder = AlertDialog.Builder(this)
            .setTitle(if (history) L("Verlauf", "History") else L("Lesezeichen", "Bookmarks"))
            .setIcon(getDrawable(if (history) R.drawable.ic_history else R.drawable.ic_star)?.mutate()?.apply {
                setTint(getColor(R.color.muted))
            })
            .setPositiveButton(L("Fertig", "Done"), null)
            .setNeutralButton(if (history) L("Lesezeichen", "Bookmarks") else L("Verlauf", "History")) { _, _ -> showLibrary(!history) }
            .setOnDismissListener { pageChanged() }
        if (pages.isEmpty()) builder.setMessage(if (history) L("Noch kein Verlauf.", "No history yet.")
            else L("Noch keine Lesezeichen. Im Menü einer Seite hinzufügen.", "No bookmarks yet. Add one from a page's menu."))
        else builder.setAdapter(rows) { _, which ->
            clearNotice()
            closeFindBar()
            BrowserPolicy.webUrl(pages[which].url)?.let(session::open)
        }
        if (history && pages.isNotEmpty()) builder.setNegativeButton(L("Verlauf löschen", "Clear history")) { _, _ ->
            library.clearHistory()
            notice(L("Verlauf gelöscht", "History cleared"))
        }
        val dialog = builder.show()
        dialog.listView?.onItemLongClickListener = AdapterView.OnItemLongClickListener { _, _, position, _ ->
            val page = pages[position]
            if (history) library.removeVisit(page.url) else library.removeBookmark(page.url)
            rows.remove(page)
            notice(L("Entfernt", "Removed"))
            true
        }
    }

    private fun showSettings(anchor: View) {
        if (wiping) return
        PopupMenu(this, anchor).apply {
            // Icons as in the iOS menu and in Chrome, Firefox and Brave; Android shows them from API 29 on.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) setForceShowIcon(true)
            val ink = getColor(R.color.muted)
            fun MenuItem.symbol(id: Int, color: Int = ink): MenuItem = setIcon(getDrawable(id)?.mutate()?.apply { setTint(color) })
            fun SubMenu.symbol(id: Int): SubMenu = setIcon(getDrawable(id)?.mutate()?.apply { setTint(ink) })
            val url = session.current.address
            // Used often on top; zoom, the protection switches and the app settings one level down (as on iOS).
            if (url != null) {
                val zoom = session.zoom(url)
                menu.addSubMenu(0, 30, 0, L("Zoom: $zoom %", "Zoom: $zoom %")).symbol(R.drawable.ic_zoom).apply {
                    add(0, 13, 0, L("Größer", "Larger")).symbol(R.drawable.ic_zoom).isEnabled = zoom < 300
                    add(0, 14, 0, L("Kleiner", "Smaller")).symbol(R.drawable.ic_zoom_out).isEnabled = zoom > 50
                    if (zoom != 100) add(0, 15, 0, L("Zurücksetzen auf 100 %", "Reset to 100 %"))
                }
                val marked = session.library.isBookmarked(url)
                menu.add(0, 11, 0, if (marked) L("Lesezeichen entfernen", "Remove bookmark")
                    else L("Lesezeichen hinzufügen", "Add bookmark")).symbol(if (marked) R.drawable.ic_star_filled else R.drawable.ic_star)
                menu.add(0, 7, 0, L("Seite teilen", "Share page")).symbol(R.drawable.ic_share)
                menu.add(0, 28, 0, L("Drucken …", "Print …")).symbol(R.drawable.ic_reader)
                if (!session.current.isPrivate) menu.add(0, 29, 0, L("Zum Startbildschirm hinzufügen", "Add to Home screen")).symbol(R.drawable.ic_add)
                menu.add(0, 8, 0, L("Auf der Seite suchen", "Find on page")).symbol(R.drawable.ic_search)
                menu.add(0, 20, 0, L("Lesemodus", "Reader mode")).symbol(R.drawable.ic_reader)
                if (session.current.hasMedia) {
                    menu.addSubMenu(0, 36, 0, L("Video", "Video")).symbol(R.drawable.ic_pip).apply {
                        for ((index, speed) in videoSpeeds.withIndex())
                            add(0, 40 + index, 0, L("Tempo ", "Speed ") + NumberFormat.getNumberInstance().format(speed) + "×")
                        add(0, 37, 0, "−10 s")
                        add(0, 38, 0, "+10 s")
                        add(0, 39, 0, L("+85 s (Intro überspringen)", "+85 s (skip intro)"))
                        for ((index, boost) in videoBoosts.withIndex()) add(0, 50 + index, 0, L("Lautstärke ", "Volume ") + boost + " %")
                    }
                    menu.add(0, 46, 0, if (session.current.muted) L("Ton an", "Unmute tab") else L("Tab stummschalten", "Mute tab"))
                        .symbol(R.drawable.ic_close)
                }
                menu.add(0, 25, 0, L("Entwicklertools", "Developer tools")).symbol(R.drawable.ic_code)
                val blocked = NumberFormat.getIntegerInstance().format(session.current.blocked.get())
                menu.addSubMenu(0, 31, 0, L("Schutz · $blocked blockiert", "Protection · $blocked blocked")).symbol(R.drawable.ic_shield).apply {
                    add(0, 1, 0, L("JavaScript auf dieser Seite", "JavaScript on this site")).symbol(R.drawable.ic_code).apply {
                        isCheckable = true
                        isChecked = session.scriptsAllowed(url)
                    }
                    add(0, 27, 0, L("Popups auf dieser Seite", "Popups on this site")).symbol(R.drawable.ic_tabs).apply {
                        isCheckable = true
                        isChecked = session.popupsAllowed(url)
                    }
                    add(0, 5, 0, L("Werbeblocker auf dieser Seite", "Ad blocker on this site")).symbol(R.drawable.ic_shield).apply {
                        isCheckable = true
                        isChecked = session.filteringAllowed(url)
                    }
                    add(0, 9, 0, L("Desktop-Webseite", "Desktop site")).symbol(R.drawable.ic_desktop).apply {
                        isCheckable = true
                        isChecked = session.desktopAllowed(url)
                    }
                    if (session.supportsHiding && session.scriptsAllowed(url))
                        add(0, 21, 0, L("Element ausblenden", "Hide element")).symbol(R.drawable.ic_private)
                    val hidden = session.hidden(url).size
                    if (hidden > 0)
                        add(0, 22, 0, L("Ausgeblendete Elemente zurücksetzen ($hidden)", "Restore hidden elements ($hidden)"))
                            .symbol(R.drawable.ic_eye)
                    add(0, 18, 0, L("Beim Schließen vergessen", "Forget when closed")).symbol(R.drawable.ic_clear).apply {
                        isCheckable = true
                        isChecked = session.forgetsWhenClosed(url)
                    }
                    add(0, 17, 0, L("Seite vergessen …", "Forget this site …")).symbol(R.drawable.ic_clear, getColor(R.color.danger))
                    add(0, 23, 0, L("Seite sperren …", "Block this site …")).symbol(R.drawable.ic_close, getColor(R.color.danger))
                }
            }
            menu.add(0, 12, 0, L("Lesezeichen und Verlauf", "Bookmarks and history")).symbol(R.drawable.ic_book)
            menu.add(0, 33, 0, L("Downloads", "Downloads")).symbol(R.drawable.ic_download)
            if (session.supportsPrivate) menu.add(0, 19, 0, L("Neuer privater Tab", "New private tab")).symbol(R.drawable.ic_private)
            menu.addSubMenu(0, 32, 0, L("Einstellungen", "Settings")).symbol(R.drawable.ic_settings).apply {
                add(0, 16, 0, L("Suchmaschine: ", "Search engine: ") + session.searchEngine.name).symbol(R.drawable.ic_search)
                add(0, 6, 0, L("Seiten abdunkeln", "Darken pages")).symbol(R.drawable.ic_moon).apply {
                    isCheckable = true
                    isChecked = session.darkPages
                }
                add(0, 47, 0, L("Cookie-Banner ablehnen", "Reject cookie banners")).symbol(R.drawable.ic_shield).apply {
                    isCheckable = true
                    isChecked = session.rejectCookies
                }
                add(0, 48, 0, L("Nur HTTPS", "HTTPS only")).symbol(R.drawable.ic_private).apply {
                    isCheckable = true
                    isChecked = session.httpsOnly
                }
                if (supportsPip) add(0, 2, 0, L("Bild-in-Bild", "Picture in Picture")).symbol(R.drawable.ic_pip).apply {
                    isCheckable = true
                    isChecked = session.pipEnabled
                }
                add(blocker.status).isEnabled = false
                add(0, 3, 0, L("Filterlisten aktualisieren", "Update filter lists")).symbol(R.drawable.ic_download)
                add(0, 24, 0, L("Ausnahmen und Sperrliste", "Exceptions and block list")).symbol(R.drawable.ic_shield)
                add(0, 26, 0, L("Synchronisierung", "Sync")).symbol(R.drawable.ic_refresh)
                add(0, 34, 0, L("Lesezeichen importieren …", "Import bookmarks …")).symbol(R.drawable.ic_star)
                add(0, 35, 0, L("Lesezeichen exportieren …", "Export bookmarks …")).symbol(R.drawable.ic_share)
                    .isEnabled = session.library.bookmarks.isNotEmpty()
                add(0, 4, 0, L("Protokoll teilen", "Share log")).symbol(R.drawable.ic_share).isEnabled = session.log.isNotEmpty()
                add(0, 10, 0, L("Lizenzen", "Licenses")).symbol(R.drawable.ic_reader)
            }
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
                    27 -> session.togglePopups()
                    6 -> session.darkPages = !session.darkPages
                    7 -> session.current.address?.let { page -> shareUrl(page.toString(), session.current.title) }
                    8 -> openFindBar()
                    9 -> session.toggleDesktop()
                    10 -> showLicenses()
                    11 -> session.current.address?.let { page ->
                        val added = session.library.toggleBookmark(page, session.current.title)
                        notice(if (added) L("Lesezeichen hinzugefügt", "Bookmark added") else L("Lesezeichen entfernt", "Bookmark removed"))
                    }
                    12 -> showLibrary()
                    13 -> session.changeZoom(10)
                    14 -> session.changeZoom(-10)
                    15 -> session.changeZoom(0)
                    16 -> chooseSearchEngine()
                    17 -> session.current.address?.let(::confirmForget)
                    18 -> session.toggleForgetWhenClosed()
                    19 -> {
                        clearNotice()
                        closeFindBar()
                        session.newPrivateTab()
                        address.post { focusAddress() }
                    }
                    20 -> showReader()
                    21 -> {
                        closeFindBar()
                        session.pickElement()
                        notice(L("Tippe auf das Element, das verschwinden soll", "Tap the element to hide"), lasting = true)
                    }
                    22 -> session.restoreHidden()
                    23 -> session.current.address?.let(::confirmBlock)
                    24 -> showSiteLists()
                    25 -> openDevTools()
                    26 -> showSync()
                    28 -> printPage()
                    29 -> session.current.address?.let(::addToHomeScreen)
                    in 40 until 40 + videoSpeeds.size -> session.videoAction("speed", videoSpeeds[it.itemId - 40])
                    37 -> session.videoAction("seek", -10.0)
                    38 -> session.videoAction("seek", 10.0)
                    39 -> session.videoAction("seek", 85.0)
                    in 50 until 50 + videoBoosts.size -> session.videoAction("boost", videoBoosts[it.itemId - 50] / 100.0)
                    46 -> session.toggleMute()
                    47 -> session.rejectCookies = !session.rejectCookies
                    48 -> session.httpsOnly = !session.httpsOnly
                    33 -> runCatching { startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS)) }
                        .onFailure { notice(L("Keine Downloads-App auf diesem Gerät", "No downloads app on this device")) }
                    34 -> pickDocument(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("text/html"), PICK_BOOKMARKS_IMPORT)
                    35 -> pickDocument(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("text/html").putExtra(Intent.EXTRA_TITLE, "bookmarks.html"), PICK_BOOKMARKS_EXPORT)
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

    private var permissionAnswer: ((Boolean) -> Unit)? = null
    private var permissionsAsked = emptyArray<String>()

    /** Location counts when either the precise or the approximate one is granted. */
    private fun granted(permissions: Array<String>): Boolean {
        val (location, other) = permissions.partition { it.endsWith("_LOCATION") }
        fun has(permission: String) = checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
        return other.all(::has) && (location.isEmpty() || location.any(::has))
    }

    override fun askSitePermission(host: String, what: String, permissions: Array<String>, done: (Boolean) -> Unit) {
        AlertDialog.Builder(this)
            .setMessage(L("$host möchte $what verwenden", "$host wants to use $what"))
            .setPositiveButton(L("Zulassen", "Allow")) { _, _ ->
                if (granted(permissions)) return@setPositiveButton done(true)
                permissionAnswer?.invoke(false)
                permissionAnswer = done
                permissionsAsked = permissions
                requestPermissions(permissions, SITE_PERMISSION)
            }
            .setNegativeButton(L("Blockieren", "Block")) { _, _ -> done(false) }
            .setOnCancelListener { done(false) }
            .show()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        if (requestCode != SITE_PERMISSION) return
        permissionAnswer?.invoke(granted(permissionsAsked))
        permissionAnswer = null
    }

    /** Print or "Save as PDF" through Android's print dialog, as in Chrome. */
    private fun printPage() {
        val name = session.current.title.ifBlank { session.current.host ?: "PouBrowser" }
        runCatching { getSystemService(PrintManager::class.java).print(name, session.activeView.createPrintDocumentAdapter(name), null) }
            .onFailure { notice(L("Drucken ist auf diesem Gerät nicht möglich", "Printing is not available on this device")) }
    }

    /** A launcher shortcut that opens the page in PouBrowser, with the site's icon or its letter. */
    private fun addToHomeScreen(url: HttpUrl) {
        if (!ShortcutManagerCompat.isRequestPinShortcutSupported(this)) {
            notice(L("Der Startbildschirm nimmt keine Verknüpfungen an", "The Home screen does not accept shortcuts"))
            return
        }
        val host = url.host.removePrefix("www.")
        val size = dp(48)
        val picture = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(picture)
        val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
        val icon = session.iconFile(host).takeIf { it.exists() }?.let { android.graphics.BitmapFactory.decodeFile(it.path) }
        paint.color = if (icon != null) Color.WHITE else tileColour(host)
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint)
        if (icon != null) {
            val inset = size / 5
            canvas.drawBitmap(icon, null, Rect(inset, inset, size - inset, size - inset), paint)
        } else {
            paint.color = Color.WHITE
            paint.textSize = size * 0.45f
            paint.textAlign = android.graphics.Paint.Align.CENTER
            paint.typeface = android.graphics.Typeface.DEFAULT_BOLD
            canvas.drawText(host.take(1).uppercase(), size / 2f, size / 2f - (paint.descent() + paint.ascent()) / 2, paint)
        }
        val title = session.current.title.ifBlank { host }
        val shortcut = ShortcutInfoCompat.Builder(this, url.toString())
            .setShortLabel(title.take(24))
            .setLongLabel(title.take(64))
            .setIcon(IconCompat.createWithBitmap(picture))
            .setIntent(Intent(Intent.ACTION_VIEW, Uri.parse(url.toString()), this, MainActivity::class.java))
            .build()
        ShortcutManagerCompat.requestPinShortcut(this, shortcut, null)
    }

    private fun pickDocument(intent: Intent, request: Int) {
        runCatching { startActivityForResult(intent, request) }
            .onFailure { notice(L("Keine Dateiauswahl auf diesem Gerät", "No file picker on this device")) }
    }

    private fun importBookmarks(file: Uri) {
        val pages = runCatching { contentResolver.openInputStream(file)!!.bufferedReader().use { it.readText() } }
            .map(BookmarkFile::parse).getOrNull()
        if (pages == null) {
            notice(L("Die Datei ließ sich nicht lesen", "The file could not be read"))
            return
        }
        val added = session.library.addBookmarks(pages)
        notice(L("$added Lesezeichen importiert", "$added bookmarks imported"))
        pageChanged()
    }

    private fun exportBookmarks(file: Uri) {
        val saved = runCatching {
            contentResolver.openOutputStream(file, "wt")!!.use { it.write(BookmarkFile.write(session.library.bookmarks).toByteArray()) }
        }.isSuccess
        notice(if (saved) L("${session.library.bookmarks.size} Lesezeichen exportiert", "${session.library.bookmarks.size} bookmarks exported")
            else L("Die Datei ließ sich nicht schreiben", "The file could not be written"))
    }

    /** Settings › Sync: the folder, "Sync now", another folder, stop. As SyncView on iOS, without the password part. */
    private fun showSync() {
        val folder = sync.folder
        val message = buildString {
            if (folder != null) append(L("Ordner: ", "Folder: ") + (sync.folderName() ?: "?") + "\n")
            if (sync.status.isNotEmpty()) append(sync.status + "\n")
            if (isNotEmpty()) append("\n")
            append(L("Wähle auf jedem Gerät denselben Cloud-Ordner, z. B. in Google Drive oder Dropbox. Abgeglichen werden Lesezeichen, " +
                "gesperrte Seiten und Ausnahmen. Passwörter bleiben beim Passwortmanager von Android.",
                "Pick the same cloud folder on every device, e.g. in Google Drive or Dropbox. Bookmarks, blocked sites and " +
                "exceptions are synced. Passwords stay with Android's own password manager."))
        }
        val builder = AlertDialog.Builder(this).setTitle(L("Synchronisierung", "Sync")).setMessage(message)
        if (folder == null) builder
            .setPositiveButton(L("Sync-Ordner wählen …", "Choose sync folder …")) { _, _ -> pickSyncFolder() }
            .setNegativeButton(L("Abbrechen", "Cancel"), null)
        else builder
            .setPositiveButton(L("Jetzt abgleichen", "Sync now")) { _, _ -> sync.run { if (!isDestroyed) showSync() } }
            .setNeutralButton(L("Anderen Ordner wählen", "Choose another folder")) { _, _ -> pickSyncFolder() }
            .setNegativeButton(L("Synchronisierung beenden", "Stop syncing")) { _, _ -> sync.stop() }
        builder.show()
    }

    private fun pickSyncFolder() {
        val pick = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        runCatching { startActivityForResult(pick, PICK_SYNC_FOLDER) }
            .onFailure { notice(L("Keine Ordnerauswahl auf diesem Gerät", "No folder picker on this device")) }
    }

    @Deprecated("Activity results without AndroidX")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == PICK_FILES) {
            val clips = data?.clipData
            val files = if (resultCode != RESULT_OK) null else if (clips != null) Array(clips.itemCount) { clips.getItemAt(it).uri }
                else WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            filePick?.onReceiveValue(files)
            filePick = null
            return
        }
        val tree = data?.data
        if (requestCode == PICK_BOOKMARKS_IMPORT && resultCode == RESULT_OK && tree != null) importBookmarks(tree)
        if (requestCode == PICK_BOOKMARKS_EXPORT && resultCode == RESULT_OK && tree != null) exportBookmarks(tree)
        if (requestCode == PICK_SYNC_FOLDER && resultCode == RESULT_OK && tree != null) sync.choose(tree) { if (!isDestroyed) showSync() }
    }

    private fun chooseSearchEngine() {
        val engines = BrowserPolicy.searchEngines
        AlertDialog.Builder(this)
            .setTitle(L("Suchmaschine", "Search engine"))
            .setSingleChoiceItems(engines.map { it.name }.toTypedArray(), engines.indexOf(session.searchEngine)) { dialog, which ->
                session.searchEngine = engines[which]
                dialog.dismiss()
            }
            .setNegativeButton(L("Abbrechen", "Cancel"), null)
            .show()
    }

    private fun confirmForget(url: HttpUrl) {
        val site = BrowserPolicy.site(url)
        AlertDialog.Builder(this)
            .setMessage(L("Alle Daten von $site löschen und ihre Tabs schließen?", "Delete all data of $site and close its tabs?"))
            .setNegativeButton(L("Abbrechen", "Cancel"), null)
            .setPositiveButton(L("Vergessen", "Forget")) { _, _ ->
                clearNotice()
                closeFindBar()
                session.forget(site)
            }
            .show()
            .getButton(AlertDialog.BUTTON_POSITIVE)
            .setTextColor(getColor(R.color.danger))
    }

    private fun confirmBlock(url: HttpUrl) {
        val site = BrowserPolicy.site(url)
        AlertDialog.Builder(this)
            .setMessage(L("$site sperren? Seiten, Popups, Weiterleitungen und eingebettete Inhalte von dort laden dann nicht mehr.",
                "Block $site? Its pages, popups, redirects and embedded content will no longer load."))
            .setNegativeButton(L("Abbrechen", "Cancel"), null)
            .setPositiveButton(L("Sperren", "Block")) { _, _ -> blockSite(site) }
            .show()
            .getButton(AlertDialog.BUTTON_POSITIVE)
            .setTextColor(getColor(R.color.danger))
    }

    private fun blockSite(site: String) {
        clearNotice()
        closeFindBar()
        session.blockSite(site)
    }

    /** Site exceptions and blocked sites; the trailing icon or a long press removes an entry. */
    private fun showSiteLists() {
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(4), 0, dp(8))
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle(L("Ausnahmen und Sperrliste", "Exceptions and block list"))
            .setView(ScrollView(this).apply { addView(content) })
            .setPositiveButton(L("Fertig", "Done"), null)
            .setNeutralButton(L("Seite sperren …", "Block a site …")) { _, _ ->
                addSite(L("Seite sperren", "Block a site"), L("Sperren", "Block"), ::blockSite)
            }
            .create()
        fun fill() {
            content.removeAllViews()
            fun section(title: String, sites: List<String>, showBadges: Boolean = true, remove: (String) -> Unit) {
                content.addView(label(title, 15f, R.color.muted, bold = true).apply {
                    setPadding(dp(24), dp(12), dp(24), dp(4))
                })
                if (sites.isEmpty()) content.addView(label(L("Keine", "None"), 15f, R.color.muted).apply {
                    setPadding(dp(24), dp(6), dp(24), dp(6))
                })
                for (site in sites) {
                    val drop = {
                        remove(site)
                        notice(L("Entfernt", "Removed"))
                        fill()
                    }
                    content.addView(LinearLayout(this).apply {
                        gravity = Gravity.CENTER_VERTICAL
                        setPadding(dp(24), dp(4), dp(12), dp(4))
                        minimumHeight = dp(56)
                        if (showBadges) {
                            addView(siteBadge(site, 36), LinearLayout.LayoutParams(dp(36), dp(36)).apply { marginEnd = dp(14) })
                        }
                        addView(label(site, 16f).apply {
                            maxLines = 1
                            ellipsize = TextUtils.TruncateAt.END
                        }, LinearLayout.LayoutParams(0, -2, 1f))
                        addView(icon(R.drawable.ic_close, L("$site entfernen", "Remove $site")) { drop() }, barItem)
                        setOnLongClickListener {
                            drop()
                            true
                        }
                    })
                }
            }
            section(L("Seiten ohne JavaScript", "Sites without JavaScript"), session.scriptlessList, showBadges = false) { site ->
                session.setScripts(site, allowed = true)
            }
            content.addView(actionLabel(L("Seite ohne JavaScript hinzufügen", "Add a site without JavaScript")) {
                dialog.dismiss()
                addSite(L("JavaScript für Domain ausschalten", "Turn off JavaScript for a domain"), L("Hinzufügen", "Add")) { site ->
                    session.setScripts(site, allowed = false)
                }
            }, LinearLayout.LayoutParams(-1, -2).apply { setMargins(dp(20), dp(4), dp(20), dp(8)) })
            section(L("Popups erlaubt auf", "Popups allowed on"), session.popupList) { site -> session.setPopups(site, allowed = false) }
            section(L("Werbeblocker aus auf", "Ad blocker off on"), session.unfilteredList, remove = session::allowFiltering)
            section(L("Gesperrte Seiten", "Blocked sites"), session.blockedList, remove = session::unblockSite)
        }
        fill()
        dialog.show()
    }

    private fun addSite(title: String, actionTitle: String, add: (String) -> Unit) {
        val field = EditText(this).apply {
            hint = "example.com"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
            setSingleLine(true)
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle(title)
            .setView(FrameLayout(this).apply {
                setPadding(dp(20), dp(8), dp(20), 0)
                addView(field)
            })
            .setNegativeButton(L("Abbrechen", "Cancel"), null)
            .setPositiveButton(actionTitle, null)
            .create()
        dialog.setOnDismissListener { if (!isFinishing && !isDestroyed) showSiteLists() }
        dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
        dialog.show()
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            val site = BrowserPolicy.siteOf(field.text.toString())
            if (site == null) {
                field.error = L("Ungültige Webadresse", "Not a web address")
            } else {
                add(site)
                dialog.dismiss()
            }
        }
        field.requestFocus()
    }

    /** Mozilla Readability (Apache-2.0, the iOS app's copy) runs on a copy of the page, so the page itself stays as it is. */
    private val readerScript by lazy {
        "(() => {\nconst module = {};\n" + assets.open("readability.js").bufferedReader().use { it.readText() } +
            "\nconst article = new Readability(document.cloneNode(true)).parse();" +
            "\nreturn article && JSON.stringify({ title: article.title, byline: article.byline, content: article.content," +
            " lang: article.lang || document.documentElement.lang || '' });\n})()"
    }

    private fun showReader() {
        val tab = session.current
        val page = tab.address ?: return
        session.activeView.evaluateJavascript(readerScript) { result ->
            if (isDestroyed || session.current !== tab || tab.address != page) return@evaluateJavascript
            // The script's value comes back as JSON: a string holding the article's JSON, or null.
            val article = runCatching { JSONObject(JSONTokener(result).nextValue() as String) }.getOrNull()
            if (article == null) notice(L("Kein Artikeltext gefunden", "No article text found"))
            else openReader(page, article, tab.profile)
        }
    }

    private fun openReader(page: HttpUrl, article: JSONObject, profile: String?) {
        fun text(key: String) = if (article.isNull(key)) "" else TextUtils.htmlEncode(article.optString(key).trim())
        fun hex(color: Int) = String.format("#%06X", getColor(color) and 0xFFFFFF)
        val dialog = Dialog(this, R.style.Theme_PouBrowser)
        val reader = WebView(this)
        profile?.let { WebViewCompat.setProfile(reader, it) }   // a private tab's reader keeps its cookies apart too
        reader.settings.apply {
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        // The reader runs no scripts: a new look reloads the page and keeps the reading position.
        var keepScroll = 0
        reader.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                if (keepScroll > 0) view.postVisualStateCallback(0, object : WebView.VisualStateCallback() {
                    override fun onComplete(requestId: Long) {
                        view.scrollTo(0, keepScroll)
                        keepScroll = 0
                    }
                })
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = BrowserPolicy.webUrl(request.url.toString()) ?: return true
                if (BrowserPolicy.sameTarget(page, url, form = false)) return false   // footnotes and anchors
                dialog.dismiss()
                clearNotice()
                session.open(url)
                return true
            }

            // Shares the pages' process; without this answer its end would take the app down.
            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                dialog.dismiss()
                return true
            }
        }
        val byline = text("byline").takeIf { it.isNotEmpty() }?.let { "<p class=\"byline\">$it</p>" }.orEmpty()
        val looks = getSharedPreferences("reader", MODE_PRIVATE)
        // Text size, colours and font, as in Safari's and Chrome's reader; kept for the next article.
        fun look(): String {
            val (background, ink, muted, link) = when (looks.getString("theme", "default")) {
                "sepia" -> listOf("#F4ECD8", "#5B4636", "#8A7560", "#8B4513")
                "dark" -> listOf("#1E1E1E", "#DDDDDD", "#9A9A9A", "#8AB4F8")
                "black" -> listOf("#000000", "#C8C8C8", "#8A8A8A", "#8AB4F8")
                else -> listOf(hex(R.color.surface), hex(R.color.ink), hex(R.color.muted), hex(R.color.accent))
            }
            val font = if (looks.getBoolean("serif", false)) "Georgia, 'Noto Serif', serif" else "system-ui, sans-serif"
            return "body { background: $background; color: $ink; font-family: $font; font-size: ${18 * looks.getInt("size", 100) / 100}px; }" +
                " .byline { color: $muted; } a { color: $link; }"
        }
        fun html() = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
            body { margin: 0 auto; padding: 20px 20px 48px; max-width: 40em; line-height: 1.6; overflow-wrap: break-word; }
            h1 { font-size: 1.6em; line-height: 1.25; margin: 0 0 .4em; }
            .byline { font-size: .85em; margin-top: 0; }
            img, video, svg, iframe, figure { max-width: 100%; height: auto; }
            table { display: block; max-width: 100%; overflow-x: auto; }
            pre { white-space: pre-wrap; }
            </style><style id="pou-look">${look()}</style></head><body><h1>${text("title")}</h1>$byline${article.optString("content")}</body></html>"""
        reader.loadDataWithBaseURL(page.toString(), html(), "text/html", "utf-8", null)
        fun restyle() {
            keepScroll = reader.scrollY
            reader.loadDataWithBaseURL(page.toString(), html(), "text/html", "utf-8", null)
        }

        // Read aloud with the phone's own voice, in the article's language when the phone has it.
        var speech: TextToSpeech? = null
        lateinit var speak: ImageButton
        fun showSpeaking(on: Boolean) {
            speak.setImageResource(if (on) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play)
            speak.contentDescription = if (on) L("Vorlesen beenden", "Stop reading") else L("Vorlesen", "Read aloud")
        }
        fun stopSpeaking() {
            speech?.stop()
            speech?.shutdown()
            speech = null
            showSpeaking(false)
        }
        fun startSpeaking() {
            run {
                val body = article.optString("title") + ".\n" +
                    android.text.Html.fromHtml(article.optString("content"), android.text.Html.FROM_HTML_MODE_COMPACT).toString().replace('\uFFFC', ' ')
                if (body.isBlank()) return@run
                showSpeaking(true)
                lateinit var voice: TextToSpeech
                voice = TextToSpeech(this) { status ->
                    if (speech !== voice) return@TextToSpeech
                    if (status != TextToSpeech.SUCCESS) return@TextToSpeech stopSpeaking()
                    val wanted = article.optString("lang").takeIf { it.isNotBlank() }?.let(java.util.Locale::forLanguageTag)
                    voice.language = wanted?.takeIf { voice.isLanguageAvailable(it) >= TextToSpeech.LANG_AVAILABLE } ?: java.util.Locale.getDefault()
                    voice.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(id: String) = Unit
                        override fun onDone(id: String) { if (id == "last") main.post { if (speech === voice) stopSpeaking() } }
                        @Deprecated("Deprecated in Java") override fun onError(id: String) { main.post { if (speech === voice) stopSpeaking() } }
                    })
                    val pieces = BrowserPolicy.speechPieces(body, TextToSpeech.getMaxSpeechInputLength() - 1)
                    pieces.forEachIndexed { index, piece ->
                        voice.speak(piece, TextToSpeech.QUEUE_ADD, null, if (index == pieces.lastIndex) "last" else "p$index")
                    }
                }
                speech = voice
            }
        }
        speak = icon(android.R.drawable.ic_media_play, L("Vorlesen", "Read aloud")) { if (speech == null) startSpeaking() else stopSpeaking() }
        fun showLooks() {
            fun choice(title: String, action: () -> Unit) = actionLabel(title) {
                action()
                restyle()
            }
            val rows = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(20), dp(8), dp(20), 0)
                fun row(vararg buttons: View) = addView(LinearLayout(this@MainActivity).apply {
                    for (button in buttons) addView(button, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(6) })
                }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) })
                fun size(step: Int) = looks.edit().putInt("size", (looks.getInt("size", 100) + step).coerceIn(70, 200)).apply()
                row(choice(L("Schrift −", "Text −")) { size(-10) }, choice(L("Schrift +", "Text +")) { size(10) })
                fun theme(name: String) = looks.edit().putString("theme", name).apply()
                row(choice(L("Standard", "Default")) { theme("default") }, choice("Sepia") { theme("sepia") })
                row(choice(L("Dunkel", "Dark")) { theme("dark") }, choice(L("Schwarz", "Black")) { theme("black") })
                row(choice(L("Serifen an/aus", "Serif on/off")) { looks.edit().putBoolean("serif", !looks.getBoolean("serif", false)).apply() })
            }
            AlertDialog.Builder(this).setTitle(L("Darstellung", "Appearance")).setView(rows)
                .setPositiveButton(L("Fertig", "Done"), null).show()
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(getColor(R.color.panel))
            addView(LinearLayout(this@MainActivity).apply {
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(16), 0, dp(8), 0)
                addView(label(L("Lesemodus", "Reader mode"), 17f, bold = true), LinearLayout.LayoutParams(0, -2, 1f))
                addView(speak, barItem)
                addView(label("Aa", 17f, R.color.accent, bold = true).center().apply {
                    contentDescription = L("Darstellung", "Appearance")
                    background = pressable(Color.TRANSPARENT, 16)
                    setOnClickListener { showLooks() }
                }, barItem)
                addView(icon(R.drawable.ic_close, L("Lesemodus schließen", "Close reader mode")) { dialog.dismiss() }, barItem)
            }, LinearLayout.LayoutParams(-1, dp(56)))
            addView(reader, LinearLayout.LayoutParams(-1, 0, 1f))
        }
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        dialog.setContentView(content)
        dialog.window?.setLayout(-1, -1)
        dialog.setOnDismissListener {
            stopSpeaking()
            (reader.parent as? ViewGroup)?.removeView(reader)
            reader.destroy()
        }
        dialog.show()
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
        if (!showingTabs) overview.closeKeyboard()
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
            devTools.visibility == View.VISIBLE -> closeDevTools()
            address.hasFocus() -> endEditing()
            session.goBack() -> clearNotice()
            // Like Chrome: to the background, not closed. finish() would end private tabs and every back stack.
            else -> moveTaskToBack(true)
        }
    }

    override fun onStart() {
        super.onStart()
        sync.run()   // other devices may have written while the app was away
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

    /** The page's text selection menu gets Chrome's "Copy link to highlight". */
    override fun onActionModeStarted(mode: ActionMode) {
        super.onActionModeStarted(mode)
        val tab = session.current
        val view = tab.webView ?: return
        if (!view.hasFocus() || tab.address == null || mode.menu.findItem(HIGHLIGHT) != null) return
        mode.menu.add(0, HIGHLIGHT, 200, L("Link zur Textstelle kopieren", "Copy link to highlight")).setOnMenuItemClickListener {
            view.evaluateJavascript("String(getSelection())") { result ->
                mode.finish()
                val page = tab.address ?: return@evaluateJavascript
                val selected = runCatching { JSONTokener(result).nextValue() as String }.getOrDefault("")
                val link = BrowserPolicy.textFragment(page, selected)
                if (link == null) return@evaluateJavascript notice(L("Diese Markierung lässt sich nicht verlinken", "This selection can't be linked"))
                getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("URL", link))
                notice(L("Link zur Textstelle kopiert", "Link to highlight copied"))
            }
            true
        }
    }

    override fun mediaChanged() {
        if (isDestroyed) return
        val tab = session.mediaTab
        MediaService.player = tab?.let {
            object : MediaService.Player {
                override val title get() = if (it.isPrivate) L("Privater Tab", "Private tab") else it.label
                override val site get() = if (it.isPrivate) "" else it.host.orEmpty()
                override val playing get() = it.playing
                override fun toggle() = session.togglePlayback()
                override fun pause() = session.pausePlayback()
            }
        }
        MediaService.update(this)
    }

    override fun onDestroy() {
        MediaService.player = null
        MediaService.update(this)
        main.removeCallbacksAndMessages(null)
        findingView?.setFindListener(null)
        findingView = null
        hideFullscreen()
        session.destroy()
        super.onDestroy()
    }

    private companion object {
        val videoSpeeds = listOf(0.5, 1.0, 1.25, 1.5, 2.0, 3.0)
        val videoBoosts = listOf(100, 200, 300)
        const val HIGHLIGHT = 0x7071
        const val PICK_SYNC_FOLDER = 41
        const val PICK_FILES = 42
        const val PICK_BOOKMARKS_IMPORT = 43
        const val PICK_BOOKMARKS_EXPORT = 44
        const val SITE_PERMISSION = 45
    }
}
