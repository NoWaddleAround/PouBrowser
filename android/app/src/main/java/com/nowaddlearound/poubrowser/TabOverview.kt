package com.nowaddlearound.poubrowser

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.BitmapFactory
import android.graphics.drawable.InsetDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
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
    onDone: () -> Unit,
) : LinearLayout(context) {
    private val items = Cards()
    private val header = context.label("Tabs", 32f, bold = true)
    private val grid = GridView(context)

    init {
        orientation = VERTICAL
        setBackgroundColor(context.getColor(R.color.surface))
        val top = LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(context.dp(20), context.dp(8), context.dp(16), context.dp(12))
            addView(header, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
            addView(context.actionLabel(L("Fertig", "Done"), action = onDone))
        }
        addView(top, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))

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
        val newTab = context.actionLabel(L("Neuer Tab", "New tab"), primary = true, action = onNew).apply {
            setCompoundDrawablesRelativeWithIntrinsicBounds(R.drawable.ic_add, 0, 0, 0)
            compoundDrawablePadding = context.dp(8)
            compoundDrawableTintList = ColorStateList.valueOf(context.getColor(R.color.on_accent))
        }
        footer.addView(newTab, FrameLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER).apply {
            setMargins(0, context.dp(10), 0, context.dp(10))
        })
        addView(footer, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
    }

    fun refresh(showCurrent: Boolean = false) {
        items.notifyDataSetChanged()
        if (showCurrent) grid.setSelection(session.tabs.indexOf(session.current))
    }

    private inner class Cards : BaseAdapter() {
        override fun getCount() = session.tabs.size
        override fun getItem(position: Int) = session.tabs[position]
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
            setImageResource(R.drawable.ic_globe)
            imageTintList = ColorStateList.valueOf(context.getColor(R.color.muted))
        }
        private val close = context.icon(R.drawable.ic_close, "") {}.apply {
            background = InsetDrawable(context.pressable(context.getColor(R.color.panel), 14), context.dp(10))
            imageTintList = ColorStateList.valueOf(context.getColor(R.color.ink))
        }
        private val title = context.label("", 15f, bold = true)
        private val host = context.label("", 12f, R.color.muted)
        private val selected = context.label("✓", 15f, R.color.accent, bold = true)
            .center().apply { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }

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
                minimumHeight = context.dp(58)
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
            val photo = tab.preview?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
            picture.setImageBitmap(photo)
            fallback.visibility = if (photo == null) VISIBLE else GONE
            title.text = tab.label
            host.text = tab.host.orEmpty()
            host.visibility = if (tab.host == null || tab.host == tab.label) GONE else VISIBLE
            selected.visibility = if (active) VISIBLE else GONE
            isSelected = active
            background = context.pressable(
                context.getColor(R.color.panel), 16, context.getColor(if (active) R.color.accent else R.color.line),
            )
            foreground = if (active) context.rounded(android.graphics.Color.TRANSPARENT, 16, context.getColor(R.color.accent), 2) else null
            contentDescription = tab.label
            setOnClickListener { onSelect(tab) }
            close.contentDescription = L("„" + tab.label + "“ schließen", "Close “" + tab.label + "”")
            close.setOnClickListener { onClose(tab) }
        }
    }
}
