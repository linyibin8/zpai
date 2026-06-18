import SwiftUI

/// 今日复习视图。
/// 拉取到期错题，带题目/位置/错因/知识点进入 AI 复习问答。
/// 复习回合不抓当前镜头（避免污染上下文）。
/// 无到期错题可提前复习；完全无错题降级为 5 分钟复习计划。
struct ReviewTodayView: View {
    @State private var response: ReviewTodayResponse?
    @State private var selectedProfile: Profile?
    @State private var profiles: [Profile] = []
    @State private var errorMessage: String?
    @State private var activeReview: ReviewQueueItem?
    @State private var showProfilePicker = false

    var body: some View {
        NavigationStack {
            VStack {
                if let profile = selectedProfile {
                    reviewContent(profile: profile)
                } else {
                    profilePicker
                }
            }
            .navigationTitle("今日复习")
        }
        .task {
            do { profiles = try await APIClient.shared.getProfiles() } catch { errorMessage = error.localizedDescription }
        }
    }

    private var profilePicker: some View {
        VStack(spacing: 12) {
            Text("选择档案").font(.headline)
            ForEach(profiles) { p in
                Button { selectedProfile = p; Task { await load(profile: p) } } label: {
                    HStack { Image(systemName: "person.crop.circle"); Text(p.name); Spacer() }
                        .padding().background(Color(.secondarySystemBackground)).cornerRadius(8)
                }.buttonStyle(.plain)
            }
        }
        .padding()
    }

    private func reviewContent(profile: Profile) -> some View {
        VStack(spacing: 12) {
            if let response {
                if response.due.isEmpty, let fb = response.fallback {
                    // 降级：5 分钟复习计划
                    VStack(alignment: .leading, spacing: 12) {
                        Image(systemName: "sparkles").font(.largeTitle).foregroundStyle(.tint)
                        Text("暂无到期错题").font(.headline)
                        Text(fb.plan).foregroundStyle(.secondary)
                    }
                    .padding()
                    Spacer()
                } else {
                    List {
                        Section("到期复习（\(response.due.count)）") {
                            ForEach(response.due) { item in
                                Button { activeReview = item } label: {
                                    errorRow(item)
                                }
                            }
                        }
                    }
                    if let active = activeReview {
                        reviewDialog(item: active, profile: profile)
                    }
                }
            } else if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
            } else {
                ProgressView()
            }
        }
    }

    private func errorRow(_ item: ReviewQueueItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(item.errorItem?.subject ?? "未知科目").bold()
                if let p = item.errorItem?.page { Text("第\(p)页").font(.caption).foregroundStyle(.secondary) }
                if let q = item.errorItem?.questionNo { Text(q).font(.caption).foregroundStyle(.secondary) }
            }
            HStack {
                Text(errorTypeLabel(item.errorItem?.errorType))
                    .font(.caption).padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Color.orange.opacity(0.2)).cornerRadius(4)
                Spacer()
                Text("间隔 \(item.intervalDays)天").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    private func reviewDialog(item: ReviewQueueItem, profile: Profile) -> some View {
        ReviewDialogView(item: item, profile: profile) { result in
            Task {
                try? await APIClient.shared.recordReview(queueId: item.id, result: result)
                activeReview = nil
                await load(profile: profile)
            }
        }
        .padding()
    }

    private func load(profile: Profile) async {
        do { response = try await APIClient.shared.todayReview(profileId: profile.id) }
        catch { errorMessage = error.localizedDescription }
    }

    private func errorTypeLabel(_ t: String?) -> String {
        switch t {
        case "calculation": return "计算错误"
        case "concept": return "概念错误"
        case "method": return "方法错误"
        case "careless": return "粗心"
        default: return "待定"
        }
    }
}

/// 单个错题的复习问答弹窗。
struct ReviewDialogView: View {
    let item: ReviewQueueItem
    let profile: Profile
    let onResult: (String) -> Void

    @State private var question = ""
    @State private var answer = ""
    @State private var isThinking = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("复习：\(item.errorItem?.questionNo ?? "此题")").font(.headline)
            if let kp = item.errorItem?.knowledgePoints, !kp.isEmpty {
                Text("知识点：\(kp.joined(separator: "、"))").font(.caption).foregroundStyle(.secondary)
            }
            if let correction = item.errorItem?.correction {
                Text("订正方向：\(correction)").font(.caption)
            }

            TextField("关于这题想问什么？", text: $question, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(2...4)

            Button {
                Task { await ask() }
            } label: {
                Label("提问（复习模式，不抓镜头）", systemImage: "questionmark.bubble")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(question.isEmpty || isThinking)

            if !answer.isEmpty {
                ScrollView { Text(answer).padding(8) }.frame(maxHeight: 120)
                    .background(Color(.systemGray6)).cornerRadius(8)
            }
            if isThinking { ProgressView("思考中…") }

            Divider()
            Text("复习结果").font(.caption).foregroundStyle(.secondary)
            HStack {
                resultButton("会了", "mastered", .green)
                resultButton("对了", "right", .blue)
                resultButton("错了", "wrong", .red)
                resultButton("稍后", "later", .gray)
            }
        }
    }

    private func ask() async {
        isThinking = true
        defer { isThinking = false }
        // 复习场景：不抓当前镜头，传 reviewQueueId
        do {
            let res = try await APIClient.shared.ask(
                sessionId: "", profileId: profile.id,
                question: question, frameId: nil, reviewQueueId: item.id
            )
            // 简化：实际走 WS 拿答案；这里 3 秒后查 turn
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            answer = "（复习模式下，系统会基于这道错题引导你作答。完整回答通过语音朗读。）"
            _ = res
        } catch {
            answer = "提问失败：\(error.localizedDescription)"
        }
    }

    private func resultButton(_ title: String, _ value: String, _ color: Color) -> some View {
        Button { onResult(value) } label: {
            Text(title).frame(maxWidth: .infinity).padding(.vertical, 8)
        }
        .buttonStyle(.bordered).tint(color)
    }
}
