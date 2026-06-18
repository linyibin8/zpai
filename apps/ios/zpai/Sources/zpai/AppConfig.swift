import Foundation

/// 全局配置：后端地址、版本、用户偏好。
/// 后端地址指向线上 HTTPS 域名；模型密钥只留在 server 端，iOS 不持有。
struct AppConfig {
    /// API 基地址（HTTPS）。
    let apiBaseURL: URL
    /// WebSocket 基地址（WSS）。
    let webSocketURL: URL

    /// 默认指向线上 zpai 域名。
    static let `default` = AppConfig(
        apiBaseURL: URL(string: "https://zpai.evowit.com")!,
        webSocketURL: URL(string: "wss://zpai.evowit.com/ws")!
    )

    /// 用户可覆盖后端地址（调试用），存 UserDefaults。
    static var current: AppConfig {
        if let override = UserDefaults.standard.string(forKey: "zpai.apiBase"),
           let url = URL(string: override) {
            // 同步推导 ws 地址
            var wsComponents = URLComponents(url: url, resolvingAgainstBaseURL: false)
            wsComponents?.scheme = url.scheme == "https" ? "wss" : "ws"
            wsComponents?.path = (wsComponents?.path ?? "") + "/ws"
            let wsURL = wsComponents?.url ?? AppConfig.default.webSocketURL
            return AppConfig(apiBaseURL: url, webSocketURL: wsURL)
        }
        return .default
    }

    static func setApiBaseOverride(_ value: String?) {
        if let value, !value.isEmpty {
            UserDefaults.standard.set(value, forKey: "zpai.apiBase")
        } else {
            UserDefaults.standard.removeObject(forKey: "zpai.apiBase")
        }
    }
}

/// 用户偏好：观察模式开关、token、当前 profile。
/// 用 @AppStorage / UserDefaults 持久化。
enum UserPrefs {
    private static let defaults = UserDefaults.standard

    /// 观察模式默认开启，只有在设置中才能手动关闭（产品要求）。
    static var observationEnabled: Bool {
        get {
            // 默认 true：键不存在时返回 true
            if defaults.object(forKey: "zpai.observation") == nil { return true }
            return defaults.bool(forKey: "zpai.observation")
        }
        set { defaults.set(newValue, forKey: "zpai.observation") }
    }

    /// 登录 token（JWT）。
    static var token: String? {
        get { defaults.string(forKey: "zpai.token") }
        set { defaults.set(newValue, forKey: "zpai.token") }
    }

    /// 当前选中的学生档案 id。
    static var currentProfileId: String? {
        get { defaults.string(forKey: "zpai.profileId") }
        set { defaults.set(newValue, forKey: "zpai.profileId") }
    }
}
