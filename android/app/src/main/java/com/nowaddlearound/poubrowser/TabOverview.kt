package com.nowaddlearound.poubrowser

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.drawable.InsetDrawable
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.BaseAdapter
import android.widget.FrameLayout
import android.widget.GridView
import android.widget.ImageView
import android.widget.LinearLayout

internal class TabOverview(
    context: Context,
    private val session: BrowserSession,
    private val onSelect: (BrowserSession.Tab) -> Unit,
    private val onClose: (BrowserSession.Tab) -> Unit,
    onNew: () -> Unit,
    onReopen: () -> Unit,
    onDone: () -> Unit,
) : LinearLayout(context) {
    private val items = Cards()
    private val header = context.label("Tabs", 32f, bold = true)
    private val reopenButton = context.actionLabel(L("Wiederherstellen", "Reopen"), action = onReopen)
        .leadingIcon(R.drawable.ic_reopen)
    private val grid = GridView(context)
    /** The tabs whose title or address contain the search text, in tab order. */
    private var shown = session.tabs
    private val search = EditText(context).apply {
        background = context.rounded(context.getColor(R.color.field), 12)
        hint = L("Tabs suchen", "Search tabs")
        textSize = 15f
        setHintTextColor(context.getColor(R.color.muted))
        setTextColor(context.getColor(R.color.ink))
        inputType = InputType.TYPE_CLASS_TEXT
        imeOptions = EditorInfo.IME_ACTION_DONE or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
        setSingleLine(true)
        setPadding(context.dp(12), 0, context.dp(12), 0)
        addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(text: Editable?) = filter()
        })
    }

    init {
        orientation = VERTICAL
        setBackgroundColor(context.getColor(R.color.surface))
        val top = LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(context.dp(20), context.dp(8), context.dp(16), context.dp(12))
            addView(header, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
            addView(reopenButton, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply {
                marginEnd = context.dp(8)
            })
            addView(context.actionLabel(L("Fertig", "Done"), action = onDone))
        }
        addView(top, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        addView(search, LayoutParams(LayoutParams.MATCH_PARENT, context.dp(42)).apply {
            setMargins(context.dp(16), 0, context.dp(16), context.dp(10))
        })

        grid.apply {
            numColumns = if (resources.configuration.fontScale >= 1.5f) 1 else GridView.AUTO_FIT
            columnWidth = context.dp(146)
            stretchMode = GridView.STRETCH_COLUMN_WIDTH
            horizontalSpacing = context.dp(12)
            verticalSpacing = context.dp(14)
            clipToPadding = false
            setPadding(context.dp(16), context.dp(4), context.dp(16), context.dp(16))
            adapter = items
        }
        addView(grid, LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f))

        val footer = FrameLayout(context).apply { setBackgroundColor(context.getColor(R.color.panel)) }
        val newTab = context.actionLabel(L("Neuer Tab", "New tab"), primary = true, action = onNew)
            .leadingIcon(R.drawable.ic_add)
        footer.addView(newTab, FrameLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER).apply {
            setMargins(0, context.dp(10), 0, context.dp(10))
        })
        addView(footer, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
    }

    fun refresh(showCurrent: Boolean = false) {
        reopenButton.visibility = if (session.hasClosedTabs) VISIBLE else GONE
        if (showCurrent && search.text.isNotEmpty()) search.text.clear() else filter()
        if (showCurrent) grid.setSelection(shown.indexOf(session.current))
    }

    private fun filter() {
        val text = search.text.toString().trim().lowercase()
        shown = if (text.isEmpty()) session.tabs
            else session.tabs.filter { it.label.lowercase().contains(text) || it.address?.toString()?.lowercase()?.contains(text) == true }
        items.notifyDataSetChanged()
    }

    /** The keyboard goes when the overview does. */
    fun closeKeyboard() {
        search.clearFocus()
        context.getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(search.windowToken, 0)
    }

    private inner class Cards : BaseAdapter() {
        override fun getCount() = shown.size
        override fun getItem(position: Int) = shown[position]
        override fun getItemId(position: Int) = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val card = convertView as? TabCard ?: TabCard(context)
            val tab = getItem(position)
            card.bind(tab, tab === session.current)
            return card
        }
    }

    private inner class TabCard(context: Context) : LinearLayout(context) {
        private val picture = ImageView(context)
        private val fallback = ImageView(context).apply {
            imageTintList = ColorStateList.valueOf(context.getColor(R.color.muted))
            importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        private val close = context.icon(R.drawable.ic_close, "") {}.apply {
            background = InsetDrawable(context.pressable(context.getColor(R.color.panel), 14), context.dp(10))
            imageTintList = ColorStateList.valueOf(context.getColor(R.color.ink))
        }
        private val title = context.label("", 15f, bold = true).apply { includeFontPadding = false }
        private val host = context.label("", 12f, R.color.muted).apply { includeFontPadding = false }
        private val selected = ImageView(context).apply {
            setImageResource(R.drawable.ic_check)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            imageTintList = ColorStateList.valueOf(context.getColor(R.color.accent))
            importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        }

        init {
            orientation = VERTICAL
            clipToOutline = true
            isFocusable = true
            val preview = object : FrameLayout(context) {
                override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
                    val width = MeasureSpec.getSize(widthMeasureSpec)
                    super.onMeasure(widthMeasureSpec, MeasureSpec.makeMeasureSpec(width * 3 / 4, MeasureSpec.EXACTLY))
                }
            }.apply {
                setBackgroundColor(context.getColor(R.color.field))
                addView(picture, FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
                addView(fallback, FrameLayout.LayoutParams(context.dp(33), context.dp(33), Gravity.CENTER))
                addView(close, FrameLayout.LayoutParams(context.dp(48), context.dp(48), Gravity.TOP or Gravity.END).apply {
                    setMargins(context.dp(5), context.dp(5), context.dp(5), 0)
                })
            }
            picture.scaleType = ImageView.ScaleType.CENTER_CROP
            addView(preview, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))

            val footer = LinearLayout(context).apply {
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = maxOf(context.dp(58), title.lineHeight * 2 + host.lineHeight + context.dp(16))
                setPadding(context.dp(12), context.dp(8), context.dp(10), context.dp(8))
                addView(LinearLayout(context).apply {
                    orientation = VERTICAL
                    title.maxLines = 2
                    title.ellipsize = TextUtils.TruncateAt.END
                    host.maxLines = 1
                    host.ellipsize = TextUtils.TruncateAt.END
                    addView(title)
                    addView(host)
                }, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
                addView(selected, LayoutParams(context.dp(20), context.dp(24)))
            }
            addView(footer, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        }

        fun bind(tab: BrowserSession.Tab, active: Boolean) {
            val photo = tab.thumbnail()
            picture.setImageBitmap(photo)
            fallback.visibility = if (photo == null) VISIBLE else GONE
            fallback.setImageResource(when {
                tab.isPrivate -> R.drawable.ic_private
                tab.address == null -> R.drawable.ic_shield
                else -> R.drawable.ic_globe
            })
            title.text = tab.label
            host.text = if (tab.isPrivate) L("Privat", "Private") + (tab.host?.let { " · $it" } ?: "") else tab.host.orEmpty()
            host.setTextColor(context.getColor(if (tab.isPrivate) R.color.private_ink else R.color.muted))
            host.visibility = if (!tab.isPrivate && (tab.host == null || tab.host == tab.label)) GONE else VISIBLE
            selected.visibility = if (active) VISIBLE else GONE
            isSelected = active
            val edge = if (tab.isPrivate) R.color.private_ink else R.color.accent
            background = context.pressable(
                context.getColor(if (tab.isPrivate) R.color.private_field else R.color.panel), 16,
                context.getColor(if (active || tab.isPrivate) edge else R.color.line),
            )
            foreground = if (active) context.rounded(android.graphics.Color.TRANSPARENT, 16, context.getColor(edge), 2) else null
            contentDescription = if (tab.isPrivate) L("Privat: ", "Private: ") + tab.label else tab.label
            setOnClickListener { onSelect(tab) }
            close.contentDescription = L("„" + tab.label + "“ schließen", "Close “" + tab.label + "”")
            close.setOnClickListener { onClose(tab) }
        }
    }
}
