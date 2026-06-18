import { useEffect, useState } from "react";
import { api } from "../api";
import type { ErrorItem, ErrorStatus, ErrorType } from "@zpai/shared";

const TYPE_LABEL: Record<ErrorType, string> = {
  calculation: "计算错误",
  concept: "概念错误",
  careless: "粗心",
  method: "方法错误",
  unknown: "待定"
};

const STATUS_FLOW: ErrorStatus[] = ["suspected", "confirmed", "corrected", "mastered", "ignored"];
const STATUS_LABEL: Record<ErrorStatus, string> = {
  suspected: "疑似错题",
  confirmed: "确认错题",
  corrected: "已订正",
  mastered: "已掌握",
  ignored: "已忽略"
};

export function ErrorsPage({ profileId }: { profileId: string }) {
  const [items, setItems] = useState<ErrorItem[]>([]);
  const [filter, setFilter] = useState<ErrorStatus>("suspected");
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    api.errors(profileId, filter).then(setItems).finally(() => setLoading(false));
  };

  useEffect(load, [profileId, filter]);

  const update = async (id: string, status: ErrorStatus) => {
    await api.updateError(id, status);
    load();
  };

  return (
    <div className="card">
      <div className="between" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>错题确认</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value as ErrorStatus)} style={{ width: 140 }}>
          {STATUS_FLOW.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="muted">加载中…</div>
      ) : items.length === 0 ? (
        <div className="empty">该状态下暂无错题。学生结束学习后，疑似错题会出现在这里供确认。</div>
      ) : (
        <table>
          <thead>
            <tr><th>科目/位置</th><th>类型</th><th>知识点</th><th>证据</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <td>
                  {e.subject ?? "—"}
                  {e.page ? ` 第${e.page}页` : ""}
                  {e.questionNo ? ` ${e.questionNo}` : ""}
                </td>
                <td>{TYPE_LABEL[e.errorType] ?? e.errorType}</td>
                <td className="muted">{(e.knowledgePoints ?? []).join("、") || "—"}</td>
                <td>{e.evidenceImageUrl ? <a href={e.evidenceImageUrl} target="_blank" rel="noreferrer">查看图</a> : "—"}</td>
                <td><span className={`tag ${e.status}`}>{STATUS_LABEL[e.status]}</span></td>
                <td>
                  <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
                    {e.status !== "confirmed" && <button className="btn small" onClick={() => update(e.id, "confirmed")}>确认</button>}
                    {e.status !== "ignored" && <button className="btn secondary small" onClick={() => update(e.id, "ignored")}>忽略</button>}
                    {e.status !== "corrected" && <button className="btn secondary small" onClick={() => update(e.id, "corrected")}>已订正</button>}
                    {e.status !== "mastered" && <button className="btn success small" onClick={() => update(e.id, "mastered")}>已掌握</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="muted" style={{ marginTop: 16, fontSize: 12 }}>
        状态流转：疑似 → 确认（进入复习队列）→ 订正 / 掌握；或忽略（非真错题）。
      </div>
    </div>
  );
}
