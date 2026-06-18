import { useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
import type { Profile, User } from "@zpai/shared";
import { LoginPage } from "./pages/Login";
import { ReportsPage } from "./pages/Reports";
import { ErrorsPage } from "./pages/Errors";
import { ReviewPage } from "./pages/Review";
import { PortraitPage } from "./pages/Portrait";
import { RemoteTriggerPage } from "./pages/RemoteTrigger";

type Tab = "reports" | "errors" | "review" | "portrait" | "remote";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState<string>("");
  const [tab, setTab] = useState<Tab>("reports");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.me();
        setUser(me);
        const ps = await api.profiles();
        setProfiles(ps);
        if (ps[0]) setProfileId(ps[0].id);
      } catch {
        setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="login-wrap"><div className="muted">加载中…</div></div>;
  if (!user) return <LoginPage onLogin={(u) => { setUser(u); api.profiles().then((ps) => { setProfiles(ps); if (ps[0]) setProfileId(ps[0].id); }); }} />;

  const tabs: { key: Tab; label: string }[] = [
    { key: "reports", label: "学习报告" },
    { key: "errors", label: "错题确认" },
    { key: "review", label: "复习队列" },
    { key: "portrait", label: "学习画像" },
    { key: "remote", label: "远程触发" }
  ];

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">zpai 控制台</span>
        <nav>
          {tabs.map((t) => (
            <a key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
              {t.label}
            </a>
          ))}
        </nav>
        <span className="user">
          {user.displayName}（{roleLabel(user.role)}）
          <button className="btn secondary small" style={{ marginLeft: 12 }} onClick={() => { setToken(null); setUser(null); }}>
            退出
          </button>
        </span>
      </header>

      <main className="content">
        <div className="card">
          <div className="row">
            <label>学生档案：</label>
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}{p.grade ? ` · ${p.grade}` : ""}</option>)}
            </select>
          </div>
        </div>

        {!profileId ? (
          <div className="card empty">请先创建学生档案</div>
        ) : tab === "reports" ? (
          <ReportsPage profileId={profileId} />
        ) : tab === "errors" ? (
          <ErrorsPage profileId={profileId} />
        ) : tab === "review" ? (
          <ReviewPage profileId={profileId} />
        ) : tab === "portrait" ? (
          <PortraitPage profileId={profileId} />
        ) : (
          <RemoteTriggerPage profileId={profileId} />
        )}
      </main>
    </div>
  );
}

function roleLabel(role: string): string {
  return role === "parent" ? "家长" : role === "teacher" ? "老师" : "学生";
}
