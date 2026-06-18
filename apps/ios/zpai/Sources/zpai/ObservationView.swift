import SwiftUI
import AVFoundation

/// 观察模式主视图（横屏）。
/// 左大区：相机预览 / 浮动小窗；右侧：QA 状态 + 手势提示 + 控制条。
struct ObservationView: View {
    @StateObject private var vm = ObservationViewModel()
    @State private var showProfilePicker = true

    var body: some View {
        Group {
            if let profile = vm.currentProfile {
                content(profile: profile)
            } else {
                ProfilePickerView { picked in
                    Task { await vm.start(profile: picked) }
                }
            }
        }
        .onDisappear {
            Task { await vm.stop() }
        }
    }

    private func content(profile: Profile) -> some View {
        HStack(spacing: 0) {
            // 左侧：相机预览（大）
            ZStack(alignment: .topLeading) {
                CameraPreviewLayer(session: vm.cameraService.session)
                    .ignoresSafeArea()

                // 浮动小预览窗：点击放大、长按关闭
                floatingPreview

                // 相机日志（浮窗关闭后显示一行小字）
                if !vm.previewExpanded {
                    Text(vm.cameraLog)
                        .font(.caption2)
                        .padding(8)
                        .background(.ultraThinMaterial)
                        .cornerRadius(8)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            // 右侧：QA + 控制
            controlPanel
                .frame(width: 320)
                .background(Color(.systemGray6))
        }
    }

    // 浮动小窗
    private var floatingPreview: some View {
        Group {
            if vm.previewExpanded {
                // 预览已铺满左侧，提供"长按关闭"提示
                Color.clear
                    .contentShape(Rectangle())
                    .onLongPressGesture(minimumDuration: 0.6) {
                        vm.previewExpanded = false
                    }
                    .overlay(alignment: .topTrailing) {
                        Button {
                            vm.previewExpanded = false
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.title2)
                                .padding(10)
                        }
                    }
            } else {
                // 关闭后：右下角小窗，点击重新放大
                CameraPreviewLayer(session: vm.cameraService.session)
                    .frame(width: 160, height: 90)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(.white.opacity(0.3), lineWidth: 1))
                    .padding(12)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                    .onTapGesture { vm.previewExpanded = true }
            }
        }
    }

    // 右侧控制面板
    private var controlPanel: some View {
        VStack(alignment: .leading, spacing: 16) {
            // 当前状态
            statusHeader

            // QA 区
            qaArea

            Divider()

            // 语音按钮 + 手势提示
            VStack(spacing: 12) {
                Button {
                    vm.startListeningFromButton()
                } label: {
                    Label(qaButtonTitle, systemImage: qaButtonIcon)
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .disabled(vm.qaState == .thinking || vm.qaState == .listening)

                if vm.qaState == .speaking || vm.qaState == .thinking {
                    Button(role: .destructive) {
                        vm.endCurrentQa()
                    } label: {
                        Label("结束 / 打断", systemImage: "stop.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }

                Button {
                    vm.manualCapture()
                } label: {
                    Label("手动抓拍", systemImage: "camera")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }

            // 手势提示
            VStack(alignment: .leading, spacing: 4) {
                Text("手势").font(.caption).foregroundStyle(.secondary)
                gestureHint(.pointing, "食指指题 → 提问")
                gestureHint(.ok, "OK → 追问 / 打断")
                gestureHint(.peace, "V → 结束问答")
            }

            Spacer()

            // 结束学习
            Button(role: .destructive) {
                Task {
                    await vm.stop()
                    vm.currentProfile = nil
                }
            } label: {
                Label("结束本次学习", systemImage: "stop.fill")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
        }
        .padding(16)
    }

    private var statusHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Circle().fill(vm.isObserving ? Color.green : Color.gray).frame(width: 8, height: 8)
                Text(vm.isObserving ? "观察中" : "已暂停").font(.headline)
                Spacer()
                Toggle("", isOn: Binding(get: { vm.isObserving }, set: { vm.setObservation($0) }))
                    .labelsHidden()
            }
            if let p = vm.currentProfile {
                Text("档案：\(p.name)").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var qaArea: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("问答").font(.subheadline).foregroundStyle(.secondary)
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    if !vm.recentQuestion.isEmpty {
                        messageBubble(text: vm.recentQuestion, isUser: true)
                    }
                    if !vm.lastAnswer.isEmpty {
                        messageBubble(text: vm.lastAnswer, isUser: false)
                    }
                    if case .thinking = vm.qaState {
                        HStack { ProgressView().scaleEffect(0.8); Text("正在思考…").font(.caption) }
                    }
                    if case .failed(let msg) = vm.qaState {
                        Text(msg).font(.caption).foregroundStyle(.red)
                    }
                }
            }
            .frame(maxHeight: 180)
        }
    }

    private func messageBubble(text: String, isUser: Bool) -> some View {
        Text(text)
            .padding(8)
            .background(isUser ? Color.accentColor.opacity(0.15) : Color(.systemBackground))
            .cornerRadius(8)
            .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }

    private func gestureHint(_ g: GestureDetector.Gesture, _ label: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: vm.gestureDetector.lastGesture == g ? "circle.fill" : "circle")
                .font(.system(size: 6))
                .foregroundStyle(vm.gestureDetector.lastGesture == g ? .green : .secondary)
            Text(label).font(.caption2)
        }
    }

    private var qaButtonTitle: String {
        switch vm.qaState {
        case .listening: return "正在听…"
        case .thinking: return "思考中…"
        case .speaking: return "朗读中"
        case .failed: return "重试提问"
        case .idle: return "语音提问"
        }
    }

    private var qaButtonIcon: String {
        switch vm.qaState {
        case .listening: return "waveform"
        case .thinking: return "ellipsis.circle"
        case .speaking: return "speaker.wave.2"
        default: return "mic"
        }
    }
}

/// 档案选择器（学习开始前选学生档案）。
struct ProfilePickerView: View {
    @State private var profiles: [Profile] = []
    @State private var errorMessage: String?
    let onPick: (Profile) -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("选择学习档案").font(.title2).bold()
            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red).font(.caption)
            }
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(profiles) { p in
                        Button { onPick(p) } label: {
                            HStack {
                                Image(systemName: "person.crop.circle")
                                VStack(alignment: .leading) {
                                    Text(p.name).bold()
                                    if let grade = p.grade { Text(grade).font(.caption).foregroundStyle(.secondary) }
                                }
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(.secondary)
                            }
                            .padding()
                            .background(Color(.secondarySystemBackground))
                            .cornerRadius(10)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)
            }
        }
        .padding()
        .task {
            do { profiles = try await APIClient.shared.getProfiles() }
            catch { errorMessage = error.localizedDescription }
        }
    }
}
