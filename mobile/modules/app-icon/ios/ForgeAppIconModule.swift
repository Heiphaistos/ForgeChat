import ExpoModulesCore
import UIKit

/// Pendant iOS de AppIconModule.kt : icônes alternatives déclarées dans Info.plist
/// (CFBundleAlternateIcons, plugins/withAppIcons.js). iOS affiche lui-même une alerte au changement.
public class ForgeAppIconModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ForgeAppIcon")

    // UIApplication n'est utilisable que sur le fil principal.
    AsyncFunction("isSupported") { (promise: Promise) in
      Task { @MainActor in promise.resolve(UIApplication.shared.supportsAlternateIcons) }
    }

    AsyncFunction("getIcon") { (promise: Promise) in
      Task { @MainActor in promise.resolve(UIApplication.shared.alternateIconName) }
    }

    AsyncFunction("setIcon") { (name: String?, promise: Promise) in
      Task { @MainActor in
        let app = UIApplication.shared
        guard app.supportsAlternateIcons else {
          promise.reject("ERR_APP_ICON", "icônes alternatives non prises en charge")
          return
        }
        if app.alternateIconName == name {
          promise.resolve(nil)
          return
        }
        app.setAlternateIconName(name) { error in
          if let error {
            promise.reject("ERR_APP_ICON", error.localizedDescription)
          } else {
            promise.resolve(nil)
          }
        }
      }
    }
  }
}
