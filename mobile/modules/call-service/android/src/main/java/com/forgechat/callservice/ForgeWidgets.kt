package com.forgechat.callservice

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.widget.RemoteViews

/**
 * Widgets de l'écran d'accueil (src/services/widgets.ts) : « Derniers messages » et « En vocal ».
 * L'appli prépare le texte (déjà traduit, contenu des messages seulement si l'utilisateur l'a
 * permis et que l'appli est déverrouillée) ; il est gardé dans les préférences privées de l'appli
 * et affiché tel quel. Un toucher ouvre ForgeChat.
 */
object ForgeWidgets {
  private const val PREFS = "forgechat_widgets"

  fun save(ctx: Context, kind: String, title: String, body: String) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("$kind.title", title.take(80))
      .putString("$kind.body", body.take(1200))
      .apply()
  }

  fun refreshAll(ctx: Context) {
    val manager = AppWidgetManager.getInstance(ctx)
    for ((kind, cls) in listOf("messages" to MessagesWidget::class.java, "voice" to VoiceWidget::class.java)) {
      val ids = manager.getAppWidgetIds(ComponentName(ctx, cls))
      if (ids.isNotEmpty()) render(ctx, manager, ids, kind)
    }
  }

  fun render(ctx: Context, manager: AppWidgetManager, ids: IntArray, kind: String) {
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val views = RemoteViews(ctx.packageName, R.layout.forge_widget)
    views.setTextViewText(R.id.forge_widget_title, prefs.getString("$kind.title", null) ?: "ForgeChat")
    views.setTextViewText(R.id.forge_widget_body, prefs.getString("$kind.body", null) ?: ctx.getString(R.string.forge_widget_empty))
    ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let { launch ->
      val pending = PendingIntent.getActivity(ctx, kind.hashCode(), launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      views.setOnClickPendingIntent(R.id.forge_widget_root, pending)
    }
    manager.updateAppWidget(ids, views)
  }
}

class MessagesWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) =
    ForgeWidgets.render(context, manager, ids, "messages")
}

class VoiceWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) =
    ForgeWidgets.render(context, manager, ids, "voice")
}
