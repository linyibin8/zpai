import { useEffect, useState } from "react";
import { api } from "../api";
import type { ReviewQueueItem, ReviewResult, ReviewTodayResponse } from "@zpai/shared";

const RESULT_LABEL: Record<ReviewResult, string> = {
  right: "正确",
  wrong: "错误",
  later: "延后",
  mastered: "已掌握"
};

export function ReviewPage({ profileId }: { profileId: string }) {
  const [today, setToday] = useState<ReviewTodayResponse | null>(null);
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);

  const load = async () => {
    setToday(await api.todayReview(profileId));
    setQueue(await api.reviewQueue(profileId));
  };

  useEffect(() => { load(); }, [profileId]);

  const record = async (queueId: string, result: ReviewResult) => {
    await api.recordReview(queueId, result);
    load();
  };

  return (
    <>
      <div className="card">
        <h2>今日复习</h2>
        {today?.fallback ? (
          <div className="muted">{today.fallback.plan}</div>
        ) : (today?.due.length ?? 0) > 0 ? (
          <div>有 <strong>{today!.due.length}</strong> 条到期错题，学生在 iPhone「今日复习」入口即可开始。</div>
        ) : (
          <div className="muted">暂无到期复习。</div>
        )}
      </div>

      <div className="card">
        <h2>复习队列（全部）</h2>
        {queue.length === 0 ? (
          <div className="empty">复习队列为空。确认错题后会自动加入。</div>
        ) : (
          <table>
            <thead>
              <tr><th>题目</th><th>到期</th><th>间隔</th><th>已复习</th><th>上次</th><th>记录</th></tr>
            </thead>
            <tbody>
              {queue.map((q) => (
                <tr key={q.id}>
                  <td>{q.errorItem?.subject ?? "—"} {q.errorItem?.page ? `第${q.errorItem.page}页` : ""} {q.errorItem?.questionNo ?? ""}</td>
                  <td>{new Date(q.dueAt).toLocaleDateString("zh-CN")}</td>
                  <td>{q.intervalDays}天</td>
                  <td>{q.reps}次</td>
                  <td>{q.lastResult ? RESULT_LABEL[q.lastResult] : "—"}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn success small" onClick={() => record(q.id, "right")}>正确</button>
                      <button className="btn danger small" onClick={() => record(q.id, "wrong")}>错误</button>
                      <button className="btn secondary small" onClick={() => record(q.id, "later")}>延后</button>
                      <button className="btn secondary small" onClick={() => record(q.id, "mastered")}>掌握</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="muted" style={{ marginTop: 16, fontSize: 12 }}>
          复习结果按 SM-2 间隔重复算法安排下次到期时间。
        </div>
      </div>
    </>
  );
}
