package com.nowaddlearound.poubrowser

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Typeface
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.AbsListView
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import android.widget.Toast

/** A console line: log, info, debug, warn, error from the page; input, result and element for the panel's own. */
internal class DevEntry(val level: String, val text: String)

/** A request the page made, as `shouldInterceptRequest` saw it. */
internal class DevRequest(val url: String, val type: String, val blocked: Boolean)

internal object DevTools {
    /** The source as a script-free page with numbered lines, as on iOS (`SourceView.html`). */
    fun sourceHtml(text: String): String {
        val lines = text.split("\n").joinToString("") {
            "<span>" + it.replace("&", "&amp;").replace("<", "&lt;") + "</span>"
        }
        return """<!doctype html><html><head><meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
            :root { color-scheme: light dark; }
            body { margin: 0; font: 12px/1.5 monospace; }
            pre { margin: 0; padding: 8px 12px 48px 0; counter-reset: line; white-space: pre-wrap; word-break: break-all; }
            span { display: block; padding-left: 5.5em; text-indent: -4.5em; }
            span::before { counter-increment: line; content: counter(line); display: inline-block; width: 4em;
                           margin-right: .5em; text-align: right; color: gray; user-select: none; }
            </style></head><body><pre>$lines</pre></body></html>"""
    }

    /** The guessed request type (`TrackerBlocker.typeOf`) in words. */
    fun typeName(type: Int) = when (type) {
        FilterEngine.SCRIPT -> "script"
        FilterEngine.IMAGE -> "image"
        FilterEngine.CSS -> "css"
        FilterEngine.XHR -> "xhr"
        FilterEngine.FRAME -> "frame"
        FilterEngine.MEDIA -> "media"
        FilterEngine.FONT -> "font"
        FilterEngine.DOCUMENT -> "document"
        else -> "–"
    }
}

/** Chrome-style developer tools under the page: console, network, source. */
internal class DevToolsPanel(context: Context, private val session: BrowserSession, private val close: () -> Unit) : LinearLayout(context) {
    private enum class Pane { CONSOLE, NETWORK, SOURCE }
    private class Row(val text: String, val color: Int, val background: Int = 0, val bold: Boolean = false)

    private var pane = Pane.CONSOLE
    private var shownTab: BrowserSession.Tab? = null
    private var shownVersion = -1
    /** After the user's own input the console jumps to its end, wherever it was scrolled. */
    private var toEnd = false
    private val rows = ArrayList<Row>()
    private val paneButtons = ArrayList<TextView>()
    private val filter: EditText
    private val action = context.icon(R.drawable.ic_clear_text, L("Leeren", "Clear")) { clearOrRefresh() }
    private val list = ListView(context)
    private var source = makeSource()
    private val input = LinearLayout(context)
    private val code: EditText

    /**
     * The source pane's own web view. It shares the pages' process: when that ends (a crash, or "Page unresponsive"
     * → End), a web view without this answer would take the whole app down. It is replaced instead.
     */
    private fun makeSource(): WebView = WebView(context).apply {
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        webViewClient = object : WebViewClient() {
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                val parent = view.parent as? ViewGroup
                val index = parent?.indexOfChild(view) ?: -1
                parent?.removeView(view)
                view.destroy()
                source = makeSource().also { fresh ->
                    fresh.visibility = view.visibility
                    if (index >= 0) parent?.addView(fresh, index, FrameLayout.LayoutParams(-1, -1))
                }
                return true
            }
        }
    }

    init {
        orientation = VERTICAL
        setBackgroundColor(context.getColor(R.color.panel))
        addView(View(context).apply { setBackgroundColor(context.getColor(R.color.line)) }, LayoutParams(-1, context.dp(1)))
        addView(LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(context.dp(8), 0, context.dp(4), 0)
            for ((value, title) in listOf(Pane.CONSOLE to L("Konsole", "Console"), Pane.NETWORK to L("Netzwerk", "Network"),
                Pane.SOURCE to L("Quelltext", "Source"))) {
                val button = context.label(title, 14f, bold = true).center().apply {
                    setPadding(context.dp(12), 0, context.dp(12), 0)
                    minHeight = context.dp(34)
                    setOnClickListener { show(value) }
                }
                paneButtons += button
                addView(button, LayoutParams(-2, -2).apply { marginEnd = context.dp(4) })
            }
            addView(View(context), LayoutParams(0, 1, 1f))
            addView(context.icon(R.drawable.ic_close, L("Entwicklertools schließen", "Close developer tools")) { close() },
                LayoutParams(context.dp(44), context.dp(44)))
        })
        filter = EditText(context).apply {
            background = context.rounded(context.getColor(R.color.field), 10)
            hint = L("Filter", "Filter")
            textSize = 14f
            setHintTextColor(context.getColor(R.color.muted))
            setTextColor(context.getColor(R.color.ink))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            imeOptions = EditorInfo.IME_ACTION_SEARCH or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
            setSingleLine(true)
            setPadding(context.dp(10), 0, context.dp(10), 0)
            setOnEditorActionListener { _, _, _ ->
                if (pane == Pane.SOURCE) source.findNext(true)
                true
            }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) = Unit
                override fun afterTextChanged(text: Editable?) {
                    if (pane == Pane.SOURCE) source.findAllAsync(text.toString()) else render()
                }
            })
        }
        addView(LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(context.dp(8), 0, context.dp(4), context.dp(2))
            addView(filter, LayoutParams(0, context.dp(36), 1f))
            addView(context.icon(R.drawable.ic_inspect, L("Element untersuchen", "Inspect element")) {
                show(Pane.CONSOLE)
                toEnd = true
                if (!session.inspectElement()) Toast.makeText(context, L("Element untersuchen braucht JavaScript auf dieser Seite",
                    "Inspect element needs JavaScript on this site"), Toast.LENGTH_SHORT).show()
            }, LayoutParams(context.dp(44), context.dp(44)))
            addView(action, LayoutParams(context.dp(44), context.dp(44)))
        })
        list.apply {
            divider = android.graphics.drawable.ColorDrawable(context.getColor(R.color.line))
            dividerHeight = 1
            adapter = object : ArrayAdapter<Row>(context, 0, rows) {
                override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                    val row = rows[position]
                    return ((convertView as? TextView) ?: TextView(context).apply {
                        textSize = 12f
                        setPadding(context.dp(8), context.dp(3), context.dp(8), context.dp(3))
                    }).apply {
                        text = row.text
                        typeface = if (row.bold) Typeface.DEFAULT_BOLD else Typeface.MONOSPACE
                        setTextColor(row.color)
                        setBackgroundColor(row.background)
                    }
                }
            }
            // Long press copies a line (its text can be as long as an element's HTML).
            setOnItemLongClickListener { _, _, position, _ ->
                context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("PouBrowser", rows[position].text))
                Toast.makeText(context, L("Kopiert", "Copied"), Toast.LENGTH_SHORT).show()
                true
            }
        }
        addView(FrameLayout(context).apply {
            addView(list, FrameLayout.LayoutParams(-1, -1))
            addView(source, FrameLayout.LayoutParams(-1, -1))
        }, LayoutParams(-1, 0, 1f))
        code = EditText(context).apply {
            background = null
            hint = L("JavaScript eingeben", "Type JavaScript")
            textSize = 13f
            typeface = Typeface.MONOSPACE
            setHintTextColor(context.getColor(R.color.muted))
            setTextColor(context.getColor(R.color.ink))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            imeOptions = EditorInfo.IME_ACTION_GO or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
            setSingleLine(true)
            setOnEditorActionListener { _, _, _ ->
                val typed = text.toString()
                if (typed.isNotBlank()) {
                    toEnd = true
                    session.evaluate(typed)
                    setText("")
                }
                true
            }
        }
        input.apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(context.dp(10), 0, context.dp(8), 0)
            addView(context.label("›", 16f, R.color.accent, bold = true))
            addView(code, LayoutParams(0, context.dp(42), 1f).apply { marginStart = context.dp(6) })
        }
        addView(input, LayoutParams(-1, -2))
        show(Pane.CONSOLE)
    }

    /** Shows the front tab's lines if they changed; cheap enough to call on every page change. */
    fun update() {
        if (visibility != VISIBLE) return
        val tab = session.current
        if (tab !== shownTab) {
            shownTab = tab
            shownVersion = -1
            if (pane == Pane.SOURCE) loadSource()
        }
        if (pane != Pane.SOURCE && tab.devVersion.get() != shownVersion) render()
    }

    private fun show(value: Pane) {
        pane = value
        paneButtons.forEachIndexed { index, button ->
            val selected = index == value.ordinal
            button.setTextColor(context.getColor(if (selected) R.color.on_accent else R.color.accent))
            button.background = if (selected) context.rounded(context.getColor(R.color.accent), 17) else null
        }
        list.visibility = if (value == Pane.SOURCE) GONE else VISIBLE
        source.visibility = if (value == Pane.SOURCE) VISIBLE else GONE
        input.visibility = if (value == Pane.CONSOLE) VISIBLE else GONE
        filter.hint = if (value == Pane.SOURCE) L("Im Quelltext suchen", "Find in source") else L("Filter", "Filter")
        action.setImageResource(if (value == Pane.CONSOLE) R.drawable.ic_clear_text else R.drawable.ic_refresh)
        action.contentDescription = if (value == Pane.CONSOLE) L("Leeren", "Clear") else L("Neu laden", "Refresh")
        // The console follows new lines while it is scrolled to the end.
        list.transcriptMode = if (value == Pane.CONSOLE) AbsListView.TRANSCRIPT_MODE_NORMAL else AbsListView.TRANSCRIPT_MODE_DISABLED
        if (value == Pane.SOURCE) loadSource() else render()
    }

    private fun clearOrRefresh() {
        if (pane == Pane.CONSOLE) session.clearConsole() else if (pane == Pane.SOURCE) loadSource()
        render()
    }

    private fun loadSource() {
        source.loadData("", "text/html", "utf-8")
        val tab = session.current
        session.pageSource { text ->
            if (session.current !== tab || pane != Pane.SOURCE) return@pageSource
            source.loadDataWithBaseURL(null, DevTools.sourceHtml(text), "text/html", "utf-8", null)
            source.findAllAsync(filter.text.toString())
        }
    }

    private fun render() {
        if (pane == Pane.SOURCE) return
        val tab = session.current
        shownVersion = tab.devVersion.get()
        val query = filter.text.toString()
        fun matches(text: String) = query.isEmpty() || text.contains(query, ignoreCase = true)
        val ink = context.getColor(R.color.ink)
        val red = context.getColor(R.color.danger)
        val muted = context.getColor(R.color.muted)
        rows.clear()
        if (pane == Pane.CONSOLE) {
            for (entry in tab.console) if (matches(entry.text)) rows += when (entry.level) {
                "input" -> Row("› " + entry.text, context.getColor(R.color.accent))
                "result" -> Row("‹ " + entry.text, ink)
                "error" -> Row("✕ " + entry.text, red, 0x14E5484D)
                "warn" -> Row("⚠ " + entry.text, context.getColor(R.color.warn), 0x1AFFC107)
                "element" -> Row("◎ " + entry.text, ink)
                "debug" -> Row("  " + entry.text, muted)
                else -> Row("  " + entry.text, ink)
            }
        } else {
            val requests = synchronized(tab.requests) { tab.requests.toList() }
            val (blocked, loaded) = requests.filter { matches(it.url) }.partition { it.blocked }
            rows += Row(L("Geladen (${loaded.size})", "Loaded (${loaded.size})"), muted, bold = true)
            loaded.mapTo(rows) { Row(it.type.padEnd(9) + it.url, ink) }
            rows += Row(L("Blockiert (${blocked.size})", "Blocked (${blocked.size})"), muted, bold = true)
            blocked.mapTo(rows) { Row(it.type.padEnd(9) + it.url, red) }
        }
        (list.adapter as ArrayAdapter<*>).notifyDataSetChanged()
        if (toEnd && pane == Pane.CONSOLE) list.setSelection(rows.lastIndex)
        toEnd = false
    }
}
