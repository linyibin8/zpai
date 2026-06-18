import { useEffect, useState } from "react";
import { api } from "../api";
import type { ErrorType, ProfilePortrait } from "@zpai/shared";

const TYPE_LABEL: Record<string, string> = {
  calculation: "计算错误",
  concept: "概念错误",
  careless: "粗心",
  method: "方法错误",
  unknown: "其他"
};

export function PortraitPage({ profileId }: { profileId: string }) {
  const [p, setP] = useState<ProfilePortrait | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    api.portrait(profileId).then(setP).finally(() => setLoading(false));
  };
  useEffect(load, [profileId]);

  const errorTypes = (p?.errorTypes ?? {}) as Record<string, number>;
  const subjects = p?.subjectDist ?? {};

  return (
    <div className="card">
      <div className="between" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>长期学习画像</h2>
        <button className="btn secondary small" onClick={() => { api.refreshPortrait(profileId).then(load); }}>刷新画像</button>
      </div>

      {loading ? <div className="muted">加载中…</div> : p ? (
        <div className="col">
          <div>
            <h3>常见薄弱知识点</h3>
            {(p.weakPoints ?? []).length === 0 ? <span className="muted">暂无明显薄弱点</span> : (
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                {p.weakPoints!.map((k, i) => <span key={i} className="tag suspected">{k}</span>)}
              </div>
            )}
          </div>

          <div>
            <h3>错误类型分布</h3>
            {Object.values(errorTypes).every((v) => v === 0) ? <span className="muted">暂无错题</span> : (
              <div className="col" style={{ gap: 6 }}>
                {Object.entries(errorTypes).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <div key={k} className="between">
                    <span>{TYPE_LABEL[k] ?? k}</span>
                    <span className="muted">{v} 次</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3>科目分布</h3>
            {Object.keys(subjects).length === 0 ? <span className="muted">暂无数据</span> : (
              Object.entries(subjects).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <div key={k} className="between"><span>{k}</span><span className="muted">{v}</span></div>
              ))
            )}
          </div>

          {p.reviewSummary && (
            <div><h3>复习情况</h3><div className="muted">{p.reviewSummary}</div></div>
          )}

          {(p.frequentQuestions ?? []).length > 0 && (
            <div>
              <h3>常被追问的问题</h3>
              <ul>{p.frequentQuestions!.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </div>
          )}
        </div>
      ) : <div className="muted">暂无画像数据</div>}

      <div className="muted" style={{ marginTop: 16, fontSize: 12 }}>
        画像基于该档案下所有错题、提问、复习记录聚合，可手动刷新。
      </div>
    </div>
  );
}
