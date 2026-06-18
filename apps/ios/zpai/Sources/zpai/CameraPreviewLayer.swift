import SwiftUI
import AVFoundation

/// 把 AVCaptureSession 渲染成 SwiftUI 视图（UIViewRepresentable 桥接）。
struct CameraPreviewLayer: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.videoPreviewLayer.session = session
        view.videoPreviewLayer.videoGravity = .resizeAspectFill
        // 横屏预览
        if view.videoPreviewLayer.connection?.isVideoOrientationSupported == true {
            view.videoPreviewLayer.connection?.videoOrientation = .landscapeRight
        }
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}

    /// 容器 UIView：暴露 videoPreviewLayer。
    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var videoPreviewLayer: AVCaptureVideoPreviewLayer {
            layer as! AVCaptureVideoPreviewLayer
        }
    }
}
