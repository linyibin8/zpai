import AVFoundation
import UIKit
import Combine

/// 相机服务：AVFoundation 后置摄像头预览 + 抓帧。
/// 使用 hd1280x720 预设，发送前最长边压缩到 1280、JPEG 质量 0.42（已验证能稳定被模型读图）。
@MainActor
final class CameraService: NSObject, ObservableObject {
    let session = AVCaptureSession()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let sessionQueue = DispatchQueue(label: "zpai.camera.session")
    private let sampleBufferQueue = DispatchQueue(label: "zpai.camera.sample")

    @Published private(set) var isAuthorized = false
    @Published private(set) var isRunning = false
    @Published private(set) var latestSampleBuffer: CMSampleBuffer?

    private var currentPreset: AVCaptureSession.Preset = .hd1280x720

    enum CameraError: Error, LocalizedError {
        case notAuthorized
        case configurationFailed
        case tooLarge

        var errorDescription: String? {
            switch self {
            case .notAuthorized: return "未获得相机权限"
            case .configurationFailed: return "相机配置失败"
            case .tooLarge: return "当前画面过大，请调整镜头位置"
            }
        }
    }

    override init() {
        super.init()
    }

    /// 请求相机权限并配置会话。
    func configure() async {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        switch status {
        case .authorized:
            isAuthorized = true
        case .notDetermined:
            isAuthorized = await AVCaptureDevice.requestAccess(for: .video)
        default:
            isAuthorized = false
        }
        guard isAuthorized else { return }
        await startSession()
    }

    private func startSession() async {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.session.beginConfiguration()
            do {
                try self.configureSession()
                self.session.commitConfiguration()
                if !self.session.isRunning {
                    self.session.startRunning()
                }
                Task { @MainActor in self.isRunning = self.session.isRunning }
            } catch {
                self.session.commitConfiguration()
            }
        }
    }

    private func configureSession() throws {
        session.sessionPreset = currentPreset

        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
            ?? AVCaptureDevice.default(for: .video) else {
            throw CameraError.configurationFailed
        }
        let input = try AVCaptureDeviceInput(device: device)
        if session.canAddInput(input) { session.addInput(input) }

        videoOutput.setSampleBufferDelegate(self, queue: sampleBufferQueue)
        videoOutput.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        videoOutput.alwaysDiscardsLateVideoFrames = true
        if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }

        // 锁定后置摄像头方向为横屏
        if let conn = videoOutput.connection(with: .video) {
            if conn.isVideoOrientationSupported {
                conn.videoOrientation = .landscapeRight
            }
            if conn.isVideoMirroringSupported { conn.isVideoMirrored = false }
        }
    }

    func stop() {
        sessionQueue.async { [weak self] in
            self?.session.stopRunning()
        }
    }

    /// 从当前 sampleBuffer 生成 UIImage（供差分/手势/UI 预览）。
    func currentUIImage() -> UIImage? {
        guard let buffer = latestSampleBuffer else { return nil }
        return sampleBufferToUIImage(buffer)
    }

    /// 从当前 sampleBuffer 生成压缩后的 JPEG data URL。
    /// 返回 "data:image/jpeg;base64,..."；失败或过大返回 nil。
    func currentFrameDataUrl(maxLongEdge: CGFloat = 1280, quality: CGFloat = 0.42) -> String? {
        guard let buffer = latestSampleBuffer,
              let image = sampleBufferToUIImage(buffer) else { return nil }
        let resized = resize(image, maxLongEdge: maxLongEdge)
        guard let jpeg = resized.jpegData(compressionQuality: quality) else { return nil }
        let base64 = jpeg.base64EncodedString()
        let dataUrl = "data:image/jpeg;base64,\(base64)"
        return dataUrl
    }

    private func sampleBufferToUIImage(_ sampleBuffer: CMSampleBuffer) -> UIImage? {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return nil }
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let context = CIContext()
        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }

    private func resize(_ image: UIImage, maxLongEdge: CGFloat) -> UIImage {
        let size = image.size
        let longEdge = max(size.width, size.height)
        guard longEdge > maxLongEdge else { return image }
        let scale = maxLongEdge / longEdge
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: newSize)
        return renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: newSize)) }
    }
}

extension CameraService: AVCaptureVideoDataOutputSampleBufferDelegate {
    nonisolated func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        Task { @MainActor in
            self.latestSampleBuffer = sampleBuffer
        }
    }
}
