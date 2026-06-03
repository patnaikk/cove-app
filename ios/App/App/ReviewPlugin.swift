import Foundation
import Capacitor
import StoreKit
import UIKit

/// Thin Capacitor plugin that calls SKStoreReviewController.requestReview()
/// from the JS side. No npm package needed — lives directly in the Xcode
/// project and compiles into the App target.
///
/// Capacitor 8 requires Swift plugins to conform to CAPBridgedPlugin and
/// declare their identifier, jsName, and methods explicitly — otherwise the
/// bridge never registers the plugin and JS calls fail.
@objc(ReviewPlugin)
public class ReviewPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ReviewPlugin"
    public let jsName = "ReviewPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestReview", returnType: CAPPluginReturnPromise)
    ]

    @objc func requestReview(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if #available(iOS 14.0, *) {
                if let scene = UIApplication.shared.connectedScenes
                    .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
                    SKStoreReviewController.requestReview(in: scene)
                } else {
                    SKStoreReviewController.requestReview()
                }
            } else {
                SKStoreReviewController.requestReview()
            }
            call.resolve()
        }
    }
}
