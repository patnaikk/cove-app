import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    // Opaque cover shown in the app-switcher snapshot so health data is never visible.
    private var privacyOverlay: UIView?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Cover the screen before iOS takes the app-switcher snapshot.
        guard privacyOverlay == nil, let window = window else { return }
        let overlay = UIView(frame: window.bounds)
        // Match the app's warm light-mode background — neutral and unbranded.
        overlay.backgroundColor = UIColor(red: 0.957, green: 0.945, blue: 0.925, alpha: 1.0)
        window.addSubview(overlay)
        privacyOverlay = overlay
    }

    func applicationDidEnterBackground(_ application: UIApplication) {}

    func applicationWillEnterForeground(_ application: UIApplication) {}

    func applicationDidBecomeActive(_ application: UIApplication) {
        privacyOverlay?.removeFromSuperview()
        privacyOverlay = nil
    }

    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
