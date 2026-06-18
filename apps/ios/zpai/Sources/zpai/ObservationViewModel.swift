import SwiftUI
import Combine
import AVFoundation

/// 观察模式 ViewModel：串起相机、帧差分、手势、上传、QA。
///
/// 核心循环（产品对齐）：
/// 1. 相机每帧 → 帧差分判定 → 有价值变化 → 上传后端
/// 2. 手势：食指指题 → 自动开麦 + 抓拍当前帧进入问答
/// 3. 语音问答：提问 → 后端（带当前帧+上下文）→ TTS 朗读
/// 4. 停止连拍 → 触发后端生成报告
@MainActor
final class ObservationViewModel: ObservableObject {
    @Published var cameraService = CameraService()
    @Published var detector = FrameChangeDetector()
    @Published var gestureDetector = GestureDetector()

    @Published var isObserving: Bool = UserPrefs.observationEnabled
    @Published var previewExpanded: Bool = true
    @Published var currentSession: Session?
    @Published var currentProfile: Profile?
    @Published var cameraLog: String = "观察中：等待画面"

    // QA 状态
    @Published var qaState: QaState = .idle
    @Published var currentTurn: QaTurn?
    @Published var recentQuestion: String = ""
    @Published var lastAnswer: String = ""

    enum QaState: Equatable {
        case idle
        case listening      // 正在听（麦克风开）
        case thinking       // 等待回答
        case speaking       // TTS 朗读中
        case failed(String)
    }

    private let api = APIClient.shared
    private let speech = SpeechService()
    private let ws = WebSocketClient()
    private var tickTimer: Timer?
    private var gestureTimer: Timer?
    private var cancellables = Set<AnyCancellable>()
    private var waitingTurnId: String?

    /// 启动观察模式（登录后调用）。
    func start(profile: Profile) async {
        currentProfile = profile
        UserPrefs.currentProfileId = profile.id
        await cameraService.configure()
        await speech.configure()

        // 开启会话
        do {
            currentSession = try await api.startSession(profileId: profile.id)
        } catch {
            cameraLog = "无法开始学习会话：\(error.localizedDescription)"
        }

        // 订阅 WS 实时事件
        bindWebSocket()
        ws.connect(sessionId: currentSession?.id, profileId: profile.id)

        guard isObserving else { return }
        startTick()
        startGestureDetection()
    }

    private func bindWebSocket() {
        ws.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                guard let self else { return }
                switch event.type {
                case "qa.done":
                    if let turn = event.turn, turn.id == self.waitingTurnId {
                        self.waitingTurnId = nil
                        self.currentTurn = turn
                        let answer = turn.answerText ?? ""
                        guard !answer.isEmpty else { self.qaState = .idle; return }
                        self.lastAnswer = answer
                        self.qaState = .speaking
                        self.speakAnswer(answer)
                    }
                case "qa.interrupted":
                    if event.turnId == self.waitingTurnId {
                        self.waitingTurnId = nil
                        self.qaState = .idle
                    }
                default:
                    break
                }
            }
            .store(in: &cancellables)
    }

    /// 停止观察模式 → 结束会话 → 触发报告生成。
    func stop() async {
        tickTimer?.invalidate()
        gestureTimer?.invalidate()
        speech.stopAll()
        cameraService.stop()
        detector.reset()
        qaState = .idle
        ws.disconnect()

        if let session = currentSession {
            do {
                try await api.endSession(session.id)
                cameraLog = "学习已结束，正在生成报告…"
            } catch {
                cameraLog = "结束会话失败：\(error.localizedDescription)"
            }
        }
    }

    /// 切换观察模式开关（设置里手动关闭）。
    func setObservation(_ on: Bool) {
        isObserving = on
        UserPrefs.observationEnabled = on
        if on {
            startTick()
            startGestureDetection()
        } else {
            tickTimer?.invalidate()
            gestureTimer?.invalidate()
            cameraLog = "观察模式已关闭"
        }
    }

    // MARK: - 帧循环

    private func startTick() {
        tickTimer?.invalidate()
        tickTimer = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.onTick() }
        }
    }

    private func onTick() {
        guard isObserving, let session = currentSession else { return }
        guard let image = cameraService.currentUIImage() else { return }

        let detection = detector.detect(image)
        self.cameraLog = detector.cameraLog

        if case .capture(let reason, let isKeyFrame) = detection {
            Task {
                await uploadCurrentFrame(session: session, reason: reason, isKeyFrame: isKeyFrame)
            }
        }
    }

    private func uploadCurrentFrame(session: Session, reason: String, isKeyFrame: Bool) async {
        guard let dataUrl = cameraService.currentFrameDataUrl() else {
            cameraLog = "抓拍失败"
            return
        }
        let body = FrameUploadBody(
            changeReason: reason,
            isKeyFrame: isKeyFrame,
            imageDataUrl: dataUrl,
            capturedAt: ISO8601DateFormatter().string(from: .now)
        )
        do {
            _ = try await api.uploadFrame(sessionId: session.id, body: body)
            detector.markCommitted()
            cameraLog = detector.cameraLog
        } catch {
            cameraLog = "上传失败：\(error.localizedDescription)"
        }
    }

    // MARK: - 手势

    private func startGestureDetection() {
        gestureTimer?.invalidate()
        gestureTimer = Timer.scheduledTimer(withTimeInterval: 0.6, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.onGestureTick() }
        }
    }

    private func onGestureTick() {
        guard isObserving, let image = cameraService.currentUIImage() else { return }
        let g = gestureDetector.detect(image)
        switch g {
        case .pointing:
            // 食指指题 → 抓拍当前帧 + 自动开麦
            handlePointingGesture()
        case .ok:
            // OK → 追问 / 打断朗读
            if qaState == .speaking { speech.stopSpeaking(); qaState = .idle }
            startListening(triggeredBy: .gestureOk)
        case .peace:
            // V → 结束当前问答
            endCurrentQa()
        case .none:
            break
        }
    }

    enum QaTrigger { case button, gesturePoint, gestureOk }

    private func handlePointingGesture() {
        guard let session = currentSession else { return }
        // 抓拍当前帧（约 4 秒等待逻辑简化为立即抓拍，失败降级）
        guard let dataUrl = cameraService.currentFrameDataUrl() else {
            cameraLog = "指题抓拍失败，请点语音按钮提问"
            return
        }
        // 临时存当前帧用于提问
        pendingFrameDataUrl = dataUrl
        startListening(triggeredBy: .gesturePoint)
        cameraLog = "识别到指题，已打开麦克风"
    }

    private var pendingFrameDataUrl: String?

    // MARK: - 语音问答

    /// 手动点语音按钮 → 开麦。
    func startListeningFromButton() {
        // 按钮触发不强制抓拍，沿用上一题上下文
        pendingFrameDataUrl = cameraService.currentFrameDataUrl()
        startListening(triggeredBy: .button)
    }

    private func startListening(triggeredBy trigger: QaTrigger) {
        guard qaState != .thinking, qaState != .listening else { return }
        qaState = .listening
        recentQuestion = ""
        speech.startRecognition { [weak self] result in
            Task { @MainActor in self?.handleRecognitionResult(result) }
        }
    }

    private func handleRecognitionResult(_ result: SpeechService.RecognitionResult) {
        switch result {
        case .partial(let text):
            recentQuestion = text
        case .final(let text):
            recentQuestion = text
            qaState = .idle
            // 冻结问题文本，避免提交空问题；没听清不触发 AI
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else {
                cameraLog = "没听清，请再说一次"
                return
            }
            Task { await submitQuestion(trimmed) }
        case .silence:
            // 沉默自动结束，不触发 AI
            qaState = .idle
            cameraLog = "未听到提问，已结束收音"
        case .error(let msg):
            qaState = .failed(msg)
            cameraLog = msg
        }
    }

    private func submitQuestion(_ question: String) async {
        guard let session = currentSession, let profile = currentProfile else { return }
        qaState = .thinking
        do {
            let res = try await api.ask(
                sessionId: session.id,
                profileId: profile.id,
                question: question,
                frameId: nil,
                reviewQueueId: nil
            )
            currentTurn = res.turn
            waitingTurnId = res.turn.id
            // 由 WS 推送 qa.done；设超时兜底（WS 异常时降级为失败提示）
            Task {
                try? await Task.sleep(nanoseconds: 25_000_000_000)
                if self.waitingTurnId == res.turn.id {
                    self.waitingTurnId = nil
                    if case .thinking = self.qaState {
                        self.qaState = .failed("回答超时，请重试")
                    }
                }
            }
        } catch {
            qaState = .failed(error.localizedDescription)
            cameraLog = "提问失败：\(error.localizedDescription)"
        }
    }

    private func speakAnswer(_ text: String) {
        speech.speak(text) { [weak self] done in
            Task { @MainActor in
                if done { self?.qaState = .idle }
            }
        }
    }

    /// 结束当前问答（V 手势 / 按钮 / 打断）。
    func endCurrentQa() {
        speech.stopAll()
        if let turn = currentTurn, let session = currentSession {
            Task { try? await api.interrupt(turnId: turn.id, sessionId: session.id) }
        }
        qaState = .idle
        cameraLog = "已结束本轮问答"
    }

    /// 手动抓拍。
    func manualCapture() {
        guard let session = currentSession else { return }
        Task { await uploadCurrentFrame(session: session, reason: "manual", isKeyFrame: true) }
    }
}
