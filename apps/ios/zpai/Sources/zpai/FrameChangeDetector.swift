import UIKit
import CoreImage
import Combine

/// 帧差分检测器：端侧判定"有价值的变化"。
///
/// 策略（对齐产品要求）：
/// - 持续观察画面，对比上一帧，计算显著变化的像素比例。
/// - 变化超过阈值 → 判定为"有意义的变化"，产出 changeReason。
/// - 空桌面/模糊/遮挡严重/无学习材料 → 自动忽略，不上传，不啰嗦提示。
/// - 长时间无变化但持续停留某题 → 触发 long_stay。
///
/// reason 推断规则（简化版，端侧只做信号判定，具体内容由后端模型判定）：
/// - 大幅结构变化（超过 35%）→ question_entered 或 page_turned
/// - 中等变化（10%-35%）→ writing_started 或 answer_changed
/// - 持续 25s 无显著变化但画面有内容 → long_stay
/// - 画面过于空白或模糊 → 忽略
@MainActor
final class FrameChangeDetector: ObservableObject {
    /// 变化阈值
    private let mediumThreshold: Double = 0.10
    private let largeThreshold: Double = 0.35
    /// 长时间停留秒数
    private let longStaySeconds: TimeInterval = 25
    /// 画面最小内容量（避免空桌面触发）
    private let minContentRatio: Double = 0.05

    /// 最近一帧的灰度缩略图（用于差分）
    private var previousThumb: [UInt8]?
    private var thumbSize = (w: 32, h: 18)
    private var lastChangeAt: Date = .now
    private var lastUploadAt: Date = .distantPast
    /// 两次上传最小间隔，避免抖动狂传
    private let minUploadInterval: TimeInterval = 2.5

    /// 当前相机日志（显示在浮窗关闭后的一行小字）
    @Published var cameraLog: String = "观察中：等待画面"

    /// 检测结果
    enum Detection {
        case ignore(reason: String)
        case capture(reason: String, isKeyFrame: Bool)
    }

    /// 输入一帧 UIImage，返回是否值得上传 + reason。
    func detect(_ image: UIImage) -> Detection {
        let now = Date.now
        guard let thumb = makeGrayscaleThumbnail(image) else {
            cameraLog = "观察中：未看到学习材料"
            return .ignore(reason: "画面无法分析")
        }

        // 内容量过少 → 空桌面，忽略
        let contentRatio = contentRatio(of: thumb)
        if contentRatio < minContentRatio {
            cameraLog = "观察中：未看到学习材料"
            return .ignore(reason: "画面过于空白")
        }

        // 模糊检测（简化：方差过低视为模糊）
        if isBlurry(thumb) {
            cameraLog = "观察中：画面模糊"
            return .ignore(reason: "画面模糊")
        }

        // 差分
        if let prev = previousThumb {
            let diff = differenceRatio(prev, thumb)
            previousThumb = thumb

            // 长时间停留：内容在、但变化小、超过阈值时长 → long_stay
            if diff < mediumThreshold, now.timeIntervalSince(lastChangeAt) >= longStaySeconds, now.timeIntervalSince(lastUploadAt) >= longStaySeconds {
                lastChangeAt = now
                lastUploadAt = now
                cameraLog = "捕获变化帧：长时间停留"
                return .capture(reason: "long_stay", isKeyFrame: true)
            }

            if diff >= largeThreshold {
                if now.timeIntervalSince(lastUploadAt) < minUploadInterval {
                    cameraLog = "捕获变化帧：缓存已提交"
                    return .ignore(reason: "节流")
                }
                lastChangeAt = now
                lastUploadAt = now
                cameraLog = "捕获变化帧：题目进入/翻页"
                return .capture(reason: "page_turned", isKeyFrame: true)
            } else if diff >= mediumThreshold {
                if now.timeIntervalSince(lastUploadAt) < minUploadInterval {
                    cameraLog = "捕获变化帧：缓存已提交"
                    return .ignore(reason: "节流")
                }
                lastChangeAt = now
                lastUploadAt = now
                cameraLog = "捕获变化帧：书写/答案变化"
                return .capture(reason: "writing_started", isKeyFrame: true)
            } else {
                cameraLog = "观察中：画面稳定"
                return .ignore(reason: "无显著变化")
            }
        } else {
            previousThumb = thumb
            lastChangeAt = now
            cameraLog = "捕获变化帧：初始画面"
            return .capture(reason: "question_entered", isKeyFrame: true)
        }
    }

    func reset() {
        previousThumb = nil
        lastChangeAt = .now
        lastUploadAt = .distantPast
        cameraLog = "观察中：等待画面"
    }

    /// 标记缓存已提交（上传成功后调用）。
    func markCommitted() {
        cameraLog = "缓存已提交"
    }

    // MARK: - 图像处理（轻量、纯 CPU）

    private func makeGrayscaleThumbnail(_ image: UIImage) -> [UInt8]? {
        let (w, h) = thumbSize
        let size = CGSize(width: w, height: h)
        let renderer = UIGraphicsImageRenderer(size: size)
        let rendered = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard let cg = rendered.cgImage else { return nil }
        let bytesPerPixel = 4
        let bytesPerRow = bytesPerPixel * w
        var pixelData = [UInt8](repeating: 0, count: bytesPerRow * h)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(data: &pixelData, width: w, height: h, bitsPerComponent: 8, bytesPerRow: bytesPerRow, space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        var gray = [UInt8](repeating: 0, count: w * h)
        for i in 0..<(w * h) {
            let r = Double(pixelData[i * bytesPerPixel])
            let g = Double(pixelData[i * bytesPerPixel + 1])
            let b = Double(pixelData[i * bytesPerPixel + 2])
            gray[i] = UInt8((r * 0.299 + g * 0.587 + b * 0.114).rounded())
        }
        return gray
    }

    private func contentRatio(of thumb: [UInt8]) -> Double {
        // 非白像素占比（灰度 < 200 视为有内容）
        let dark = thumb.filter { $0 < 200 }.count
        return Double(dark) / Double(thumb.count)
    }

    private func isBlurry(_ thumb: [UInt8]) -> Bool {
        // 用方差近似清晰度：方差极低 → 模糊
        let count = Double(thumb.count)
        let mean = thumb.reduce(0.0) { $0 + Double($1) } / count
        let variance = thumb.reduce(0.0) { acc, v in acc + (Double(v) - mean) * (Double(v) - mean) } / count
        // 经验阈值：方差 < 100 视为模糊（待真机调参）
        return variance < 100
    }

    private func differenceRatio(_ a: [UInt8], _ b: [UInt8]) -> Double {
        guard a.count == b.count else { return 1.0 }
        var changed = 0
        for i in 0..<a.count {
            if abs(Int(a[i]) - Int(b[i])) > 30 { changed += 1 }
        }
        return Double(changed) / Double(a.count)
    }
}
