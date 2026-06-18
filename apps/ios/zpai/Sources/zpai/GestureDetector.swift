import Vision
import UIKit
import Combine

/// 手势检测器：基于 Vision 的手部关键点识别。
///
/// 识别的手势（对齐产品要求）：
/// - 食指指向：只有食指伸出，其余弯曲 → 指题并启动问答
/// - OK / 点赞：拇指食指相接成环，或点赞手势 → 追问 / 打断朗读
/// - V 手势：食指中指伸出，其余弯曲 → 结束当前问答
///
/// 高风险动作（结束整轮学习）不在此处执行，需多帧确认。
@MainActor
final class GestureDetector: NSObject, ObservableObject {
    @Published var lastGesture: Gesture = .none
    @Published var isPointing: Bool = false

    enum Gesture: Equatable {
        case none
        case pointing       // 食指指题
        case ok             // OK / 点赞 → 追问/打断
        case peace          // V → 结束
    }

    private var lastGestureAt: Date = .distantPast
    /// 手势稳定性：连续 N 帧一致才确认，降低误触发
    private let confirmFrames = 3
    private var pendingGesture: Gesture = .none
    private var pendingCount = 0

    /// 输入一帧，返回识别到的手势（已做多帧去抖）。
    func detect(_ image: UIImage) -> Gesture {
        // Vision 手部关键点请求（iOS 17+ 的 HandPose 检测，向下兼容用 availablility 判断）
        let detected = recognizeHandPose(image)
        return stabilize(detected)
    }

    private func stabilize(_ g: Gesture) -> Gesture {
        if g == pendingGesture {
            pendingCount += 1
        } else {
            pendingGesture = g
            pendingCount = 1
        }
        if pendingCount >= confirmFrames && g != .none {
            if lastGesture != g || Date.now.timeIntervalSince(lastGestureAt) > 1.5 {
                lastGesture = g
                lastGestureAt = .now
                isPointing = (g == .pointing)
                return g
            }
        }
        return .none
    }

    // MARK: - Vision

    private func recognizeHandPose(_ image: UIImage) -> Gesture {
        guard #available(iOS 17.0, *),
              let cgImage = image.cgImage else {
            // 低版本无手部关键点 API，降级为不支持手势
            return .none
        }

        // 用 Vision 的手部姿态请求（异步会阻塞，这里简化为同步请求）
        let request = VNDetectHumanHandPoseRequest()
        request.maximumHandCount = 1
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return .none
        }

        guard let observation = request.results?.first else { return .none }
        return classify(observation)
    }

    @available(iOS 17.0, *)
    private func classify(_ observation: VNHumanHandPoseObservation) -> Gesture {
        let points: [VNHumanHandPoseObservation.JointName: CGPoint] = {
            var dict: [VNHumanHandPoseObservation.JointName: CGPoint] = [:]
            if let all = try? observation.recognizedPoints(.all) {
                for (name, point) in all where point.confidence > 0.3 {
                    dict[name] = point.location
                }
            }
            return dict
        }()

        guard let wrist = points[.wrist] else { return .none }
        let indexTip = points[.indexTip]
        let indexMcp = points[.indexMCP]
        let middleTip = points[.middleTip]
        let middleMcp = points[.middleMCP]
        let ringTip = points[.ringTip]
        let thumbTip = points[.thumbTip]

        // 食指是否伸直（tip 离 wrist 比 mcp 更远），其余弯曲
        func isExtended(_ tip: CGPoint?, _ mcp: CGPoint?) -> Bool {
            guard let tip, let mcp else { return false }
            return dist(tip, wrist) > dist(mcp, wrist) * 1.2
        }
        func isCurled(_ tip: CGPoint?) -> Bool {
            guard let tip else { return true }
            // 弯曲：tip 离 wrist 不远
            return dist(tip, wrist) < 0.3
        }

        let indexExt = isExtended(indexTip, indexMcp)
        let middleExt = isExtended(middleTip, middleMcp)
        let ringCurled = isCurled(ringTip)

        // V 手势：食指和中指都伸直，无名指弯曲
        if indexExt && middleExt && ringCurled { return .peace }

        // 食指指向：只有食指伸直
        if indexExt && !middleExt && ringCurled { return .pointing }

        // OK：拇指尖与食指尖距离很近
        if let thumbTip, let indexTip, dist(thumbTip, indexTip) < 0.08 {
            return .ok
        }

        return .none
    }

    private func dist(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
        hypot(a.x - b.x, a.y - b.y)
    }
}
