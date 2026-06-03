import Foundation
import Capacitor
import StoreKit

/// Thin Capacitor plugin that calls SKStoreReviewController.requestReview()
/// from the JS side. No npm package needed — lives directly in the Xcode project.
@objc(ReviewPlugin)
public class ReviewPlugin: CAPPlugin {
    @objc func requestReview(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if #available(iOS 16.0, *) {
                if let scene = UIApplication.shared.connectedScenes
                    .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
                    SKStoreReviewController.requestReview(in: scene)
                }
            } else {
                SKStoreReviewController.requestReview()
            }
            call.resolve()
        }
    }
}
