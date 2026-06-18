import { useEffect, useState } from "react";
import { api } from "../api";
import type { Report, Session } from "@zpai/shared";

export function ReportsPage({ profileId }: { profileId: string }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.sessions(profileId).then(setSessions).catch(() => setSessions([]));
  }, [profileId]);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    api.report(selected).then(setReport).finally(() => setLoading(false));
  }, [selected]);

  return (
    <>
      <div className="card">
        <h2>历史学习记录</h2>
        {sessions.length === 0 ? (
          <div className="empty">暂无学习记录。学生在 iPhone 上开始一次学习后，报告会出现在这里。</div>
        ) : (
          <table>
            <thead>
              <tr><th>时间</th><th>帧</th><th>提问</th><th>状态</th><th></th></tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.startedAt).toLocaleString("zh-CN")}</td>
                  <td>{s.frameCount}</td>
                  <td>{s.qaCount}</td>
                  <td>{s.endedAt ? <span className="muted">已结束</span> : <span style={{ color: "var(--warn)" }}>进行中</span>}</td>
                  <td><button className="btn small" onClick={() => setSelected(s.id)}>查看报告</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="card">
          <h2>学习报告 {loading && <span className="muted" style={{ fontSize: 12 }}>加载中…</span>}</h2>
          {!loading && report && report.status === "pending" && (
            <div className="muted">报告生成中，请稍后刷新。</div>
          )}
          {!loading && report && report.status === "done" && (
            <>
              {(report.sections ?? []).map((s, i) => (
                <div key={i} style={{ marginBottom: 16 }}>
                  <h3>{s.title}</h3>
                  <div style={{ whiteSpace: "pre-wrap" }}>{s.content}</div>
                </div>
              ))}
              {report.advice && (
                <div style={{ background: "#fffbeb", padding: 16, borderRadius: 8, marginTop: 16 }}>
                  <strong>给家长/老师的建议</strong>
                  <div style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{report.advice}</div>
                </div>
              )}
            </>
          )}
          {!loading && report && report.status === "failed" && (
            <div className="error">报告生成失败</div>
          )}
        </div>
      )}
    </>
  );
}
