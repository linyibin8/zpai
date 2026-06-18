import SwiftUI

/// 学习报告视图：选择档案 → 看历史会话 → 查看某次报告。
struct ReportsView: View {
    @State private var profiles: [Profile] = []
    @State private var selectedProfile: Profile?
    @State private var sessions: [Session] = []
    @State private var selectedSession: Session?
    @State private var report: Report?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack {
                if let profile = selectedProfile {
                    sessionList(profile: profile)
                } else {
                    profilePicker
                }
            }
            .navigationTitle("学习报告")
        }
        .task {
            do { profiles = try await APIClient.shared.getProfiles() } catch { errorMessage = error.localizedDescription }
        }
        .sheet(item: $selectedSession) { session in
            ReportDetailView(sessionId: session.id)
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
        }.padding()
    }

    private func sessionList(profile: Profile) -> some View {
        List {
            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
            }
            ForEach(sessions) { s in
                Button { selectedSession = s } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(s.startedAt.prefix(16) + "…").font(.subheadline)
                        HStack {
                            Text("\(s.frameCount) 帧").font(.caption)
                            Text("\(s.qaCount) 问").font(.caption)
                            Spacer()
                            if s.endedAt == nil { Text("进行中").font(.caption2).foregroundStyle(.orange) }
                        }
                        if let summary = s.summary { Text(summary).font(.caption2).foregroundStyle(.secondary).lineLimit(2) }
                    }
                }
            }
        }
    }

    private func load(profile: Profile) async {
        do { sessions = try await APIClient.shared.sessions(profileId: profile.id) }
        catch { errorMessage = error.localizedDescription }
    }
}

/// 报告详情：展示报告各章节 + 给家长/老师的建议。
struct ReportDetailView: View {
    let sessionId: String
    @State private var report: Report?
    @State private var isLoading = true
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if isLoading {
                        ProgressView("正在生成报告…").padding()
                    } else if let report {
                        if report.status == "pending" {
                            VStack(spacing: 8) {
                                ProgressView()
                                Text("报告生成中，稍后刷新").foregroundStyle(.secondary)
                                Button("刷新") { Task { await load() } }
                            }.padding()
                        } else if report.status == "failed" {
                            Text("报告生成失败").foregroundStyle(.red)
                        } else {
                            ForEach(report.sections ?? []) { section in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(section.title).font(.headline)
                                    Text(section.content).font(.body).foregroundStyle(.primary)
                                }
                                Divider()
                            }
                            if let advice = report.advice {
                                VStack(alignment: .leading, spacing: 6) {
                                    Label("给家长/老师的建议", systemImage: "lightbulb").font(.headline)
                                    Text(advice).font(.body)
                                }
                                .padding()
                                .background(Color.yellow.opacity(0.1))
                                .cornerRadius(10)
                            }
                        }
                    } else {
                        Text("暂无报告").foregroundStyle(.secondary)
                    }
                }
                .padding()
            }
            .navigationTitle("学习报告")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } } }
            .task { await load() }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do { report = try await APIClient.shared.report(sessionId: sessionId) }
        catch { isLoading = false }
    }
}
