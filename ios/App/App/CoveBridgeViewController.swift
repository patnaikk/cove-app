import Capacitor

/// CAPBridgeViewController subclass required for registering in-app Capacitor
/// plugins (like ReviewPlugin) that aren't distributed as npm packages.
/// The storyboard's root view controller must point to this class.
class CoveBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ReviewPlugin())
    }
}
