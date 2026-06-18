import Speech
import AVFoundation
import UIKit

/// 端侧语音服务：Speech 框架做中文识别（STT），AVSpeechSynthesizer 做中文朗读（TTS）。
///
/// 行为约定（对齐产品要求）：
/// - 识别结束冻结问题文本，避免提交空问题。
/// - 没听清不触发 AI；沉默自动结束。
/// - 朗读中文，短而清楚；追问/结束/打断时立即停止。
/// - 语音播放失败时文字答案仍可看（由 UI 兜底）。
@MainActor
final class SpeechService: NSObject, ObservableObject {
    private let speechRecognizer: SFSpeechRecognizer?
    private let audioEngine = AVAudioEngine()
    private var recognitionTask: SFSpeechRecognitionTask?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private let synthesizer = AVSpeechSynthesizer()

    enum RecognitionResult {
        case partial(String)
        case final(String)
        case silence
        case error(String)
    }

    private var resultHandler: ((RecognitionResult) -> Void)?
    private var silenceTimer: Timer?
    private let silenceTimeout: TimeInterval = 3.0
    private var lastPartialAt: Date = .now
    private var recognizedText: String = ""

    override init() {
        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))
        super.init()
        synthesizer.delegate = self
    }

    /// 请求麦克风 + 语音识别权限并配置。
    func configure() async {
        SFSpeechRecognizer.requestAuthorization { _ in }
        await AVAudioApplication.requestRecordPermission { _ in }
    }

    // MARK: - STT

    /// 开始识别，结果通过 handler 回调（partial 实时、final 完成、silence 沉默超时）。
    func startRecognition(handler: @escaping (RecognitionResult) -> Void) {
        stopRecognition()
        self.resultHandler = handler
        self.recognizedText = ""
        self.lastPartialAt = .now

        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            handler(.error("语音识别不可用，请检查权限或网络"))
            return
        }

        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            handler(.error("音频会话配置失败"))
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        recognitionRequest = request

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            handler(.error("麦克风启动失败"))
            return
        }

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }
            Task { @MainActor in
                if let result {
                    let text = result.bestTranscription.formattedString
                    self.recognizedText = text
                    if result.isFinal {
                        self.finish(with: text)
                    } else {
                        self.lastPartialAt = .now
                        self.resultHandler?(.partial(text))
                    }
                }
                if error != nil {
                    // 没听清或出错：若已有部分文本则作为 final，否则报错
                    if !self.recognizedText.isEmpty {
                        self.finish(with: self.recognizedText)
                    } else {
                        self.finish(with: .error("识别出错"))
                    }
                }
            }
        }

        // 沉默超时检测
        silenceTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if Date.now.timeIntervalSince(self.lastPartialAt) >= self.silenceTimeout {
                    if self.recognizedText.isEmpty {
                        self.finish(with: .silence)
                    } else {
                        self.finish(with: self.recognizedText)
                    }
                }
            }
        }
    }

    private func finish(with result: RecognitionResult) {
        silenceTimer?.invalidate()
        silenceTimer = nil
        stopRecognition()
        resultHandler?(result)
        resultHandler = nil
    }

    func stopRecognition() {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: - TTS

    /// 朗读中文文本；完成或失败时回调。
    func speak(_ text: String, completion: @escaping (Bool) -> Void) {
        stopSpeaking()
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "zh-CN")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.95
        utterance.pitchMultiplier = 1.0
        utterance.volume = 1.0
        self.ttsCompletion = completion
        synthesizer.speak(utterance)
    }

    private var ttsCompletion: ((Bool) -> Void)?

    func stopSpeaking() {
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        }
        ttsCompletion?(false)
        ttsCompletion = nil
    }

    /// 停止所有语音（识别 + 朗读）。
    func stopAll() {
        stopRecognition()
        stopSpeaking()
    }
}

extension SpeechService: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.ttsCompletion?(true)
            self.ttsCompletion = nil
        }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.ttsCompletion?(false)
            self.ttsCompletion = nil
        }
    }
}
