import SwiftUI

/// 长期学习画像视图：薄弱知识点、错误类型分布、科目分布、复习情况、常被追问的问题。
struct PortraitView: View {
    @State private var profiles: [Profile] = []
    @State private var selectedProfile: Profile?
    @State private var portrait: ProfilePortrait?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack {
                if let profile = selectedProfile {
                    portraitContent(profile: profile)
                } else {
                    profilePicker
                }
            }
            .navigationTitle("学习画像")
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
        }.padding()
    }

    private func portraitContent(profile: Profile) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let portrait {
                    section("常见薄弱知识点", icon: "exclamationmark.triangle") {
                        if portrait.weakPoints?.isEmpty ?? true {
                            emptyNote("暂无明显薄弱点")
                        } else {
                            FlowTags(items: portrait.weakPoints ?? [])
                        }
                    }

                    section("错误类型分布", icon: "chart.pie") {
                        let types = portrait.errorTypes ?? [:]
                        if types.values.allSatisfy({ $0 == 0 }) {
                            emptyNote("暂无错题记录")
                        } else {
                            ForEach(types.sorted(by: { $0.value > $1.value }), id: \.key) { k, v in
                                HStack {
                                    Text(errorTypeLabel(k))
                                    Spacer()
                                    Text("\(v) 次").foregroundStyle(.secondary)
                                }
                                .padding(.vertical, 2)
                            }
                        }
                    }

                    section("科目分布", icon: "books.vertical") {
                        let dist = portrait.subjectDist ?? [:]
                        if dist.isEmpty { emptyNote("暂无数据") }
                        else {
                            ForEach(dist.sorted(by: { $0.value > $1.value }), id: \.key) { k, v in
                                HStack { Text(k); Spacer(); Text("\(v)").foregroundStyle(.secondary) }
                            }
                        }
                    }

                    if let review = portrait.reviewSummary {
                        section("复习情况", icon: "arrow.triangle.2.circlepath") {
                            Text(review).foregroundStyle(.secondary)
                        }
                    }

                    if let freq = portrait.frequentQuestions, !freq.isEmpty {
                        section("常被追问的问题", icon: "questionmark.bubble") {
                            VStack(alignment: .leading, spacing: 4) {
                                ForEach(Array(freq.enumerated()), id: \.offset) { _, q in
                                    Text("· \(q)").font(.subheadline)
                                }
                            }
                        }
                    }
                } else if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                } else {
                    ProgressView()
                }
            }
            .padding()
        }
    }

    private func load(profile: Profile) async {
        do { portrait = try await APIClient.shared.portrait(profileId: profile.id) }
        catch { errorMessage = error.localizedDescription }
    }

    private func section<Content: View>(_ title: String, icon: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: icon).font(.headline)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private func emptyNote(_ text: String) -> some View {
        Text(text).foregroundStyle(.secondary).font(.subheadline)
    }

    private func errorTypeLabel(_ t: String) -> String {
        switch t {
        case "calculation": return "计算错误"
        case "concept": return "概念错误"
        case "method": return "方法错误"
        case "careless": return "粗心"
        default: return "其他"
        }
    }
}

/// 简单的流式标签布局。
struct FlowTags: View {
    let items: [String]
    var body: some View {
        VStack(alignment: .leading) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                Text(item)
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(Color.orange.opacity(0.15))
                    .cornerRadius(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}
