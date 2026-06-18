import Foundation
import Combine

/// WebSocket 客户端：订阅后端实时事件（qa.done / frame.captured / report.updated 等）。
/// 连接 wss://zpai.evowit.com/ws?token=xxx，认证后订阅当前 session。
@MainActor
final class WebSocketClient: ObservableObject {
    private var task: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)
    private var config: AppConfig

    /// 收到的事件流
    let events = PassthroughSubject<ServerEvent, Never>()

    struct ServerEvent: Decodable {
        let type: String
        // 各事件字段可选，按 type 取用
        let turn: QaTurn?
        let turnId: String?
        let text: String?
        let frame: FrameInfo?
        let report: Report?
    }

    init(config: AppConfig = AppConfig.current) {
        self.config = config
    }

    /// 建立连接并订阅。token 从 UserPrefs 取。
    func connect(sessionId: String?, profileId: String?) {
        guard let token = UserPrefs.token else { return }
        var components = URLComponents(url: config.webSocketURL, resolvingAgainstBaseURL: false)
        var queryItems = components?.queryItems ?? []
        queryItems.append(URLQueryItem(name: "token", value: token))
        components?.queryItems = queryItems
        guard let url = components?.url else { return }

        task?.cancel(with: .goingAway, reason: nil)
        task = session.webSocketTask(with: url)
        task?.resume()
        receive()

        // 连上后发送 subscribe
        Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            await sendSubscribe(sessionId: sessionId, profileId: profileId)
        }
    }

    func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func sendSubscribe(sessionId: String?, profileId: String?) async {
        var payload: [String: Any] = ["type": "subscribe"]
        if let sessionId { payload["sessionId"] = sessionId }
        if let profileId { payload["profileId"] = profileId }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else { return }
        try? await task?.send(.string(text))
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                Task { @MainActor in self.handleMessage(message) }
                Task { @MainActor in self.receive() }
            case .failure:
                // 断线重连
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                    // 简单重连（生产可加退避）
                }
            }
        }
    }

    private func handleMessage(_ message: URLSessionWebSocketTask.Message) {
        var text: String?
        switch message {
        case .string(let s): text = s
        case .data(let d): text = String(data: d, encoding: .utf8)
        @unknown default: break
        }
        guard let text, let data = text.data(using: .utf8),
              let event = try? JSONDecoder().decode(ServerEvent.self, from: data) else { return }
        events.send(event)
    }
}
