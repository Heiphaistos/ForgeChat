package com.forgechat.appicon

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Icône de l'application (Réglages → Apparence → Icône de l'app, src/features/appearance/appIcon.ts).
 *
 * Chaque variante est une <activity-alias> « .AppIcon<Nom> » qui cible MainActivity, désactivée par
 * défaut (plugins/withAppIcons.js). Icône d'origine = MainActivity active, tous les alias désactivés.
 * Changer d'icône = activer la nouvelle entrée du lanceur PUIS désactiver les autres (jamais zéro
 * entrée active). Le lanceur remplace alors l'icône ; certains ferment l'app au passage.
 */
class AppIconModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ForgeAppIcon")

    // Fonctions asynchrones comme sur iOS (UIApplication y impose le fil principal).
    AsyncFunction("isSupported") {
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      entries(ctx) != null
    }

    AsyncFunction("getIcon") {
      val ctx = appContext.reactContext ?: return@AsyncFunction null
      val e = entries(ctx) ?: return@AsyncFunction null
      e.aliases.entries.firstOrNull { isEnabled(ctx, it.value, false) }?.key
    }

    AsyncFunction("setIcon") { name: String? ->
      val ctx = appContext.reactContext ?: throw IllegalStateException("contexte Android indisponible")
      val e = entries(ctx) ?: throw IllegalStateException("icônes alternatives absentes de ce build")
      val target = if (name == null) e.main else e.aliases[name] ?: throw IllegalArgumentException("icône inconnue : $name")
      val pm = ctx.packageManager
      // D'abord la nouvelle entrée : l'app garde toujours une icône dans le lanceur.
      pm.setComponentEnabledSetting(target, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
      if (target != e.main && isEnabled(ctx, e.main, true)) {
        pm.setComponentEnabledSetting(e.main, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
      }
      for (alias in e.aliases.values) {
        if (alias != target && isEnabled(ctx, alias, false)) {
          pm.setComponentEnabledSetting(alias, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
        }
      }
      null
    }
  }

  private class Entries(val main: ComponentName, val aliases: Map<String, ComponentName>)

  /** MainActivity et les alias des variantes (null : build sans icônes alternatives). */
  private fun entries(ctx: Context): Entries? {
    val pm = ctx.packageManager
    val flags = PackageManager.GET_ACTIVITIES or PackageManager.MATCH_DISABLED_COMPONENTS
    val info: PackageInfo =
      if (Build.VERSION.SDK_INT >= 33) {
        pm.getPackageInfo(ctx.packageName, PackageManager.PackageInfoFlags.of(flags.toLong()))
      } else {
        @Suppress("DEPRECATION")
        pm.getPackageInfo(ctx.packageName, flags)
      }
    var main: String? = null
    val aliases = linkedMapOf<String, ComponentName>()
    for (activity in info.activities.orEmpty()) {
      val simple = activity.name.substringAfterLast('.')
      val target = activity.targetActivity ?: continue
      if (!simple.startsWith(PREFIX)) continue
      aliases[simple.removePrefix(PREFIX)] = ComponentName(ctx.packageName, activity.name)
      main = target
    }
    return main?.let { Entries(ComponentName(ctx.packageName, it), aliases) }
  }

  /** État effectif : celui choisi par l'app, sinon celui du manifeste (`default`). */
  private fun isEnabled(ctx: Context, component: ComponentName, default: Boolean): Boolean =
    when (ctx.packageManager.getComponentEnabledSetting(component)) {
      PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
      PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> default
      else -> false
    }

  private companion object {
    const val PREFIX = "AppIcon"
  }
}
