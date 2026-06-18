import SwiftUI

/// 根视图：根据登录状态切换 登录 / 主界面。
struct RootView: View {
    @StateObject private var auth = AuthViewModel()
    @Environment(\.horizontalSizeClass) private var hSize

    var body: some View {
        Group {
            if auth.isLoggedIn {
                MainTabView()
                    .environmentObject(auth)
            } else {
                AuthView()
                    .environmentObject(auth)
            }
        }
        .task {
            await auth.bootstrap()
        }
    }
}

/// 认证状态管理。
@MainActor
final class AuthViewModel: ObservableObject {
    @Published var isLoggedIn: Bool = false
    @Published var user: APIClient.User?
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?

    private let api = APIClient.shared

    func bootstrap() async {
        guard UserPrefs.token != nil else { return }
        do {
            user = try await api.me()
            isLoggedIn = true
        } catch {
            UserPrefs.token = nil
            isLoggedIn = false
        }
    }

    func login(username: String, password: String) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let res = try await api.login(username: username, password: password)
            user = res.user
            isLoggedIn = true
        } catch let e as APIClient.APIError {
            errorMessage = e.errorDescription
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func register(role: String, username: String, password: String, displayName: String) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let res = try await api.register(role: role, username: username, password: password, displayName: displayName)
            user = res.user
            isLoggedIn = true
        } catch let e as APIClient.APIError {
            errorMessage = e.errorDescription
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func logout() {
        api.logout()
        user = nil
        isLoggedIn = false
    }
}
