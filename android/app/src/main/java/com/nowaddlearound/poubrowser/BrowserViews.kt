package com.nowaddlearound.poubrowser

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.ImageButton
import android.widget.TextView
import kotlin.math.roundToInt

/** A text in the app's language: German on a German phone, English everywhere else. Both versions sit side by side where they are used. */
internal fun L(german: String, english: String) = if (java.util.Locale.getDefault().language == "de") german else english

internal fun Context.dp(value: Int) = (value * resources.displayMetrics.density).roundToInt()

internal fun Context.rounded(fill: Int, radius: Int, stroke: Int? = null, width: Int = 1) =
    GradientDrawable().apply {
        setColor(fill)
        cornerRadius = dp(radius).toFloat()
        if (stroke != null) setStroke(dp(width), stroke)
    }

internal fun Context.pressable(fill: Int, radius: Int, stroke: Int? = null): RippleDrawable =
    RippleDrawable(
        ColorStateList.valueOf(0x29478D7D),
        rounded(fill, radius, stroke),
        rounded(android.graphics.Color.WHITE, radius),
    )

internal fun Context.label(value: String, size: Float, color: Int = R.color.ink, bold: Boolean = false) =
    TextView(this).apply {
        text = value
        textSize = size
        setTextColor(getColor(color))
        if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    }

internal fun Context.icon(symbol: Int, title: String, action: (View) -> Unit) = ImageButton(this).apply {
    setImageResource(symbol)
    imageTintList = ColorStateList.valueOf(getColor(R.color.accent))
    contentDescription = title
    background = pressable(android.graphics.Color.TRANSPARENT, 16)
    isFocusable = true
    minimumWidth = dp(48)
    minimumHeight = dp(48)
    setOnClickListener(action)
}

internal fun Context.actionLabel(value: String, primary: Boolean = false, action: () -> Unit) = Button(this).apply {
    text = value
    isAllCaps = false
    textSize = 15f
    minHeight = dp(48)
    minimumHeight = dp(48)
    setPadding(dp(16), 0, dp(16), 0)
    setTextColor(getColor(if (primary) R.color.on_accent else R.color.accent))
    background = pressable(getColor(if (primary) R.color.accent else R.color.field), 24)
    stateListAnimator = null
    setOnClickListener { action() }
}

internal fun TextView.center() = apply { gravity = Gravity.CENTER }
