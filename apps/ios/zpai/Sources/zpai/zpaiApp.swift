import SwiftUI
import UIKit

/// zpai 应用入口。
/// 横屏锁定：除 Info.plist 外，在 AppDelegate 里用代码加固，保证启动和全过程只允许横屏。
@main
struct zpaiApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.light)
        }
    }
}

/// AppDelegate：用 supportedInterfaceOrientationsFor 代码加固横屏锁定。
/// Info.plist 已经只声明横屏，这里再兜底，避免 iOS 在某些启动瞬间误入竖屏。
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        supportedInterfaceOrientationsFor window: UIWindow?
    ) -> UIInterfaceOrientationMask {
        .landscape
    }
}
