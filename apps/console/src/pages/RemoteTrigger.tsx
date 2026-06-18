import { useState } from "react";
import { api } from "../api";
import type { QaTurn } from "@zpai/shared";

/**
 * 远程触发一轮 QA（产品要求：Web 端可远程触发）。
 * 家长/老师可以从这里发起对某个会话的提问，结果推送到 iOS 端朗读。
 */
export function RemoteTriggerPage({ profileId }: { profileId: string }) {
  const [sessionId, setSessionId] = useState("");
  const [question, setQuestion] = useState("");
  const [turn, setTurn] = useState<QaTurn | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const send = async () => {
    setError("");
    setTurn(null);
    setLoading(true);
    try {
      const res = await api.ask({
        sessionId,
        profileId,
        question: question.trim()
      });
      setTurn(res.turn);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>远程触发问答</h2>
      <p className="muted">家长/老师可从这里向某个进行中的学习会话发起提问，回答会推送到学生 iPhone 端朗读。</p>

      <div className="col" style={{ maxWidth: 520 }}>
        <div className="field">
          <label>学习会话 ID</label>
          <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="进行中的 session id（可从学习报告页查到）" />
        </div>
        <div className="field">
          <label>提问内容</label>
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} placeholder="如：第 3 题再讲一遍思路" />
        </div>
        <button className="btn" disabled={loading || !sessionId || !question.trim()} onClick={send}>
          {loading ? "发送中…" : "发起提问"}
        </button>

        {error && <div className="error">{error}</div>}
        {turn && (
          <div style={{ marginTop: 12 }}>
            <div className="muted">已创建问答 turn：</div>
            <div className="card" style={{ padding: 12, marginTop: 8 }}>
              <div><strong>问：</strong>{turn.questionText}</div>
              <div className="muted" style={{ marginTop: 6 }}>状态：{turn.status}（回答将通过 iOS 端朗读；可在此页面或报告页刷新查看）</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
