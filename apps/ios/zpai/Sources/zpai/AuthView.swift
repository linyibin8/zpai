import SwiftUI

/// 登录/注册视图（横屏布局）。
struct AuthView: View {
    @EnvironmentObject var auth: AuthViewModel
    @State private var mode: Mode = .login
    @State private var role = "parent"
    @State private var username = ""
    @State private var password = ""
    @State private var displayName = ""

    enum Mode: String, CaseIterable { case login = "登录", register = "注册" }

    var body: some View {
        HStack(spacing: 0) {
            // 左侧品牌区
            VStack(spacing: 16) {
                Image(systemName: "camera.viewfinder")
                    .font(.system(size: 56))
                    .foregroundStyle(.tint)
                Text("zpai")
                    .font(.system(size: 40, weight: .bold))
                Text("学习陪伴 · 看清一段学习过程")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemGray6))

            // 右侧表单区
            VStack(spacing: 18) {
                Picker("模式", selection: $mode) {
                    ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)

                if mode == .register {
                    Picker("角色", selection: $role) {
                        Text("家长").tag("parent")
                        Text("老师").tag("teacher")
                        Text("学生").tag("student")
                    }
                    .pickerStyle(.segmented)

                    TextField("昵称", text: $displayName)
                        .textFieldStyle(.roundedBorder)
                }

                TextField("用户名", text: $username)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                SecureField("密码", text: $password)
                    .textFieldStyle(.roundedBorder)

                if let err = auth.errorMessage {
                    Text(err).font(.caption).foregroundStyle(.red)
                }

                Button {
                    Task {
                        if mode == .login {
                            await auth.login(username: username, password: password)
                        } else {
                            await auth.register(role: role, username: username, password: password, displayName: displayName)
                        }
                    }
                } label: {
                    Group {
                        if auth.isLoading { ProgressView().tint(.white) }
                        else { Text(mode.rawValue).fontWeight(.semibold) }
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .disabled(username.isEmpty || password.isEmpty || auth.isLoading)

                Spacer()
            }
            .padding(36)
            .frame(maxWidth: 460, maxHeight: .infinity)
            .background(Color(.systemBackground))
        }
        .ignoresSafeArea(edges: .bottom)
    }
}
