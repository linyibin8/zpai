import SwiftUI

/// 主界面（横屏）：底部 Tab 切换主要功能区。
struct MainTabView: View {
    @EnvironmentObject var auth: AuthViewModel
    @State private var selection = 0

    var body: some View {
        TabView(selection: $selection) {
            ObservationView()
                .tabItem { Label("学习", systemImage: "camera.viewfinder") }
                .tag(0)

            ReviewTodayView()
                .tabItem { Label("今日复习", systemImage: "arrow.triangle.2.circlepath") }
                .tag(1)

            ReportsView()
                .tabItem { Label("报告", systemImage: "doc.text.magnifyingglass") }
                .tag(2)

            PortraitView()
                .tabItem { Label("画像", systemImage: "chart.bar.xaxis") }
                .tag(3)

            SettingsView()
                .tabItem { Label("设置", systemImage: "gearshape") }
                .tag(4)
        }
    }
}
