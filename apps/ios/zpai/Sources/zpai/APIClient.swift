import Foundation

/// 后端 REST 客户端：封装所有 /api 调用，自动注入 JWT。
/// 错误用 APIError 枚举，方便 UI 区分展示。
actor APIClient {
    static let shared = APIClient()

    private let config: AppConfig
    private let session: URLSession

    init(config: AppConfig = AppConfig.current) {
        self.config = config
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 30
        cfg.timeoutIntervalForResource = 120
        cfg.waitsForConnectivity = true
        self.session = URLSession(configuration: cfg)
    }

    enum APIError: Error, LocalizedError {
        case unauthorized
        case forbidden
        case notFound
        case badRequest(String)
        case server(Int, String)
        case network(Error)
        case decoding(Error)

        var errorDescription: String? {
            switch self {
            case .unauthorized: return "登录已过期，请重新登录"
            case .forbidden: return "没有权限执行此操作"
            case .notFound: return "找不到对应内容"
            case .badRequest(let m): return m
            case .server(let code, let m): return "服务器错误(\(code))：\(m)"
            case .network(let e): return "网络异常：\(e.localizedDescription)"
            case .decoding(let e): return "数据解析失败：\(e.localizedDescription)"
            }
        }
    }

    // MARK: - Auth

    struct AuthResponse: Codable {
        let token: String
        let user: User
    }

    struct User: Codable, Identifiable {
        let id: String
        let role: String
        let username: String
        let displayName: String
        let createdAt: String
    }

    struct AuthBody: Encodable {
        let role: String?
        let username: String
        let password: String
        let displayName: String?
    }

    @discardableResult
    func register(role: String, username: String, password: String, displayName: String?) async throws -> AuthResponse {
        let body = AuthBody(role: role, username: username, password: password, displayName: displayName)
        let res: AuthResponse = try await post("/api/auth/register", body: body)
        UserPrefs.token = res.token
        return res
    }

    @discardableResult
    func login(username: String, password: String) async throws -> AuthResponse {
        let body = AuthBody(role: nil, username: username, password: password, displayName: nil)
        let res: AuthResponse = try await post("/api/auth/login", body: body)
        UserPrefs.token = res.token
        return res
    }

    func me() async throws -> User {
        try await get("/api/auth/me")
    }

    func logout() {
        UserPrefs.token = nil
        UserPrefs.currentProfileId = nil
    }

    // MARK: - Profile / Session / QA（轻量封装，具体模型见各自 View）

    func getProfiles() async throws -> [Profile] {
        try await get("/api/profiles")
    }

    func startSession(profileId: String) async throws -> Session {
        struct Body: Encodable { let profileId: String }
        return try await post("/api/sessions", body: Body(profileId: profileId))
    }

    func sessions(profileId: String) async throws -> [Session] {
        try await get("/api/profiles/\(profileId)/sessions")
    }

    func endSession(_ id: String, summary: String? = nil) async throws {
        struct Body: Encodable { let summary: String? }
        let _: EmptyResult = try await post("/api/sessions/\(id)/end", body: Body(summary: summary))
    }

    func uploadFrame(sessionId: String, body: FrameUploadBody) async throws -> FrameUploadResult {
        try await post("/api/sessions/\(sessionId)/frames", body: body)
    }

    func ask(sessionId: String, profileId: String, question: String, frameId: String?, reviewQueueId: String?) async throws -> QaResult {
        struct Body: Encodable {
            let sessionId: String
            let profileId: String
            let question: String
            let frameId: String?
            let reviewQueueId: String?
        }
        return try await post("/api/qa/ask", body: Body(sessionId: sessionId, profileId: profileId, question: question, frameId: frameId, reviewQueueId: reviewQueueId))
    }

    func interrupt(turnId: String, sessionId: String) async throws {
        struct Body: Encodable { let turnId: String; let sessionId: String }
        let _: EmptyResult = try await post("/api/qa/interrupt", body: Body(turnId: turnId, sessionId: sessionId))
    }

    func todayReview(profileId: String) async throws -> ReviewTodayResponse {
        try await get("/api/profiles/\(profileId)/review/today")
    }

    func recordReview(queueId: String, result: String) async throws {
        struct Body: Encodable { let result: String }
        let _: EmptyResult = try await post("/api/review/\(queueId)/result", body: Body(result: result))
    }

    func report(sessionId: String) async throws -> Report {
        try await get("/api/sessions/\(sessionId)/report")
    }

    func errors(profileId: String, status: String?) async throws -> [ErrorItem] {
        var path = "/api/profiles/\(profileId)/errors"
        if let status { path += "?status=\(status)" }
        return try await get(path)
    }

    func updateError(_ id: String, status: String, correction: String?) async throws -> ErrorItem {
        struct Body: Encodable { let status: String; let correction: String? }
        return try await patch("/api/errors/\(id)", body: Body(status: status, correction: correction))
    }

    func portrait(profileId: String) async throws -> ProfilePortrait {
        try await get("/api/profiles/\(profileId)/portrait")
    }

    // MARK: - HTTP 基础

    private func request<T: Decodable>(_ path: String, method: String, body: Encodable? = nil) async throws -> T {
        let url = config.apiBaseURL.appendingPathComponent(path)
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = UserPrefs.token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.httpBody = try JSONEncoder().encode(body)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError.network(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.server(0, "无效响应")
        }
        switch http.statusCode {
        case 200...299:
            if data.isEmpty || T.self == EmptyResult.self {
                return EmptyResult() as! T
            }
            do {
                return try JSONDecoder().decode(T.self, from: data)
            } catch {
                throw APIError.decoding(error)
            }
        case 401: throw APIError.unauthorized
        case 403: throw APIError.forbidden
        case 404: throw APIError.notFound
        case 400:
            let msg = decodeErrorMessage(data) ?? "请求参数有误"
            throw APIError.badRequest(msg)
        default:
            let msg = decodeErrorMessage(data) ?? "未知错误"
            throw APIError.server(http.statusCode, msg)
        }
    }

    private func get<T: Decodable>(_ path: String) async throws -> T { try await request(path, method: "GET") }
    private func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T { try await request(path, method: "POST", body: body) }
    private func patch<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T { try await request(path, method: "PATCH", body: body) }

    private func decodeErrorMessage(_ data: Data) -> String? {
        struct Err: Decodable { let error: String?; let message: String? }
        return (try? JSONDecoder().decode(Err.self, from: data))?.message
    }
}

// MARK: - 共享领域模型（与 @zpai/shared 对齐）

struct Profile: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let grade: String?
    let subjectFocus: String?
    let ownerId: String
    let createdAt: String
}

struct Session: Codable, Identifiable, Hashable {
    let id: String
    let profileId: String
    let startedAt: String
    let endedAt: String?
    let summary: String?
    let frameCount: Int
    let qaCount: Int
}

struct FrameUploadBody: Encodable {
    let changeReason: String
    let isKeyFrame: Bool
    let imageDataUrl: String
    let capturedAt: String?
}

struct FrameUploadResult: Decodable {
    let frame: FrameInfo
}

struct FrameInfo: Codable, Identifiable, Hashable {
    let id: String
    let sessionId: String
    let capturedAt: String
    let imageUrl: String
    let changeReason: String
    let isKeyFrame: Bool
    let analysis: String?
}

struct QaResult: Codable {
    let turn: QaTurn
}

struct QaTurn: Codable, Identifiable, Hashable {
    let id: String
    let sessionId: String
    let profileId: String
    let questionText: String
    let frameId: String?
    let answerText: String?
    let status: String
    let createdAt: String
}

struct ReviewTodayResponse: Codable {
    let due: [ReviewQueueItem]
    let fallback: FallbackPlan?
}

struct FallbackPlan: Codable {
    let kind: String
    let plan: String
}

struct ReviewQueueItem: Codable, Identifiable, Hashable {
    let id: String
    let errorItemId: String
    let profileId: String
    let dueAt: String
    let intervalDays: Int
    let easeFactor: Double
    let reps: Int
    let lastResult: String?
    let errorItem: ErrorItem?
}

struct ErrorItem: Codable, Identifiable, Hashable {
    let id: String
    let profileId: String
    let sessionId: String
    let subject: String?
    let page: Int?
    let questionNo: String?
    let errorType: String
    let status: String
    let correction: String?
    let nextAction: String?
    let evidenceFrameId: String?
    let evidenceImageUrl: String?
    let knowledgePoints: [String]?
    let createdAt: String
    let updatedAt: String
}

struct Report: Codable, Identifiable {
    let id: String?
    let sessionId: String
    let status: String
    let sections: [ReportSection]?
    let advice: String?
    let createdAt: String?
    let updatedAt: String?
}

struct ReportSection: Codable, Identifiable, Hashable {
    var id: String { title }
    let title: String
    let content: String
}

struct ProfilePortrait: Codable {
    let profileId: String?
    let weakPoints: [String]?
    let errorTypes: [String: Int]?
    let subjectDist: [String: Int]?
    let recentSummary: String?
    let reviewSummary: String?
    let frequentQuestions: [String]?
    let updatedAt: String?
}

struct EmptyResult: Codable {}
