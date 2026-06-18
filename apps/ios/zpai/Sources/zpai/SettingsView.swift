import SwiftUI

/// 设置视图：观察模式开关、后端地址覆盖、登出。
struct SettingsView: View {
    @EnvironmentObject var auth: AuthViewModel
    @AppStorage("zpai.observation") private var observationStored: Bool = true
    @State private var apiBase: String = AppConfig.current.apiBaseURL.absoluteString
    @State private var showSaved = false

    var body: some View {
        NavigationStack {
            Form {
                Section("观察模式") {
                    Toggle("自动观察（默认开启）", isOn: $observationStored)
                    Text("关闭后不会自动记录变化帧。学习场景建议保持开启。")
                        .font(.caption).foregroundStyle(.secondary)
                }

                Section("后端地址（调试用）") {
                    TextField("https://zpai.evowit.com", text: $apiBase)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("保存") {
                        AppConfig.setApiBaseOverride(apiBase.isEmpty ? nil : apiBase)
                        showSaved = true
                    }
                    if showSaved { Text("已保存，重启 app 生效").font(.caption).foregroundStyle(.green) }
                }

                Section("账号") {
                    if let user = auth.user {
                        LabeledContent("用户名", value: user.username)
                        LabeledContent("昵称", value: user.displayName)
                        LabeledContent("角色", value: roleLabel(user.role))
                    }
                    Button("退出登录", role: .destructive) {
                        auth.logout()
                    }
                }

                Section("关于") {
                    LabeledContent("版本", value: "0.1.0")
                    LabeledContent("后端", value: AppConfig.current.apiBaseURL.host() ?? "—")
                }
            }
            .navigationTitle("设置")
        }
    }

    private func roleLabel(_ role: String) -> String {
        switch role {
        case "parent": return "家长"
        case "teacher": return "老师"
        case "student": return "学生"
        default: return role
        }
    }
}
