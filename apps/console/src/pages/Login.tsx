import { useState } from "react";
import { api, setToken } from "../api";
import type { User } from "@zpai/shared";

export function LoginPage({ onLogin }: { onLogin: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [role, setRole] = useState("parent");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      const res = mode === "login"
        ? await api.login({ username, password })
        : await api.register({ role: role as User["role"], username, password, displayName });
      setToken(res.token);
      onLogin(res.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>zpai</h1>
        <p className="muted">学习陪伴控制台 · 家长 / 老师</p>

        <div className="row" style={{ marginBottom: 16 }}>
          {(["login", "register"] as const).map((m) => (
            <button key={m} className={`btn ${mode === m ? "" : "secondary"}`} style={{ flex: 1 }} onClick={() => setMode(m)}>
              {m === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        {mode === "register" && (
          <>
            <div className="field">
              <label>角色</label>
              <div className="row">
                {[["parent", "家长"], ["teacher", "老师"], ["student", "学生"]].map(([v, l]) => (
                  <button key={v} className={`btn ${role === v ? "" : "secondary"}`} style={{ flex: 1 }} onClick={() => setRole(v)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>昵称</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="如：张妈妈" />
            </div>
          </>
        )}

        <div className="field">
          <label>用户名</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="至少 3 个字符" />
        </div>
        <div className="field">
          <label>密码</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 6 个字符" />
        </div>

        {error && <div className="error">{error}</div>}

        <button className="btn" style={{ width: "100%", marginTop: 8 }} disabled={loading || username.length < 3 || password.length < 6} onClick={submit}>
          {loading ? "处理中…" : mode === "login" ? "登录" : "注册并登录"}
        </button>
      </div>
    </div>
  );
}
