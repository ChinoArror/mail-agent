import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { Callback, Login, RenewScreen, canAutoRenew, markRenewAttempt, redirectToAuthCenter } from "./auth";
import { ErrorPanel } from "./components";
import { ApiError, api, applyPrefs, getPublicConfig, readPrefs, tokenKey, type User } from "./lib";
import { Shell } from "./shell";
import { ConfirmProvider, FeedbackProvider } from "./ui/feedback";
import { SkeletonShell, useSkeletonSwap } from "./ui/skeleton";

type Session =
  | { phase: "restoring" }
  | { phase: "ready"; user: User }
  | { phase: "signed-out"; notice?: string }
  | { phase: "renewing" }
  | { phase: "error"; message: string };

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(tokenKey));
  const [session, setSession] = useState<Session>(() => (localStorage.getItem(tokenKey) ? { phase: "restoring" } : { phase: "signed-out" }));
  const isCallback = window.location.pathname === "/sso-callback";

  const restore = async () => {
    if (!localStorage.getItem(tokenKey)) {
      setSession({ phase: "signed-out" });
      return;
    }
    setSession({ phase: "restoring" });
    try {
      const { user } = await api<{ user: User }>("/api/me");
      setSession({ phase: "ready", user });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 401) {
        localStorage.removeItem(tokenKey);
        // Expired / revoked JWT → silent renewal via Auth Center's refresh cookie (unified sign-in guide).
        if (canAutoRenew()) {
          markRenewAttempt();
          setSession({ phase: "renewing" });
          await redirectToAuthCenter(await getPublicConfig());
          return;
        }
        setSession({ phase: "signed-out", notice: "Your session has ended. Sign in again to continue." });
        return;
      }
      if (status === 403) {
        localStorage.removeItem(tokenKey);
        setSession({ phase: "signed-out", notice: err instanceof Error ? err.message : "Your account cannot access Mail Agent." });
        return;
      }
      setSession({ phase: "error", message: err instanceof Error ? err.message : "Couldn't reach the server" });
    }
  };

  useEffect(() => {
    if (!isCallback) void restore();
  }, [token]);

  const logout = async () => {
    localStorage.removeItem(tokenKey);
    setToken(null);
    setSession({ phase: "signed-out" });
    const config = await getPublicConfig();
    const redirect = new URL(config.callback_url, window.location.origin).origin;
    window.location.href = `${config.auth_center_url}/logout?redirect=${encodeURIComponent(redirect)}`;
  };

  if (isCallback) return <Callback onDone={() => setToken(localStorage.getItem(tokenKey))} />;
  if (session.phase === "renewing") return <RenewScreen />;
  if (session.phase === "signed-out") return <Login notice={session.notice} />;
  if (session.phase === "error") {
    return (
      <main className="login">
        <section className="login-card boot-card">
          <div className="boot-head">
            <div className="boot-orbit error"><img src="/logo.svg" alt="" /></div>
            <div><strong>Can't load Mail Agent</strong><small>The server didn't respond as expected.</small></div>
          </div>
          <ErrorPanel message={session.message} onRetry={() => void restore()} />
        </section>
      </main>
    );
  }
  if (session.phase === "restoring") return <RestoringShell />;
  return <Shell user={session.user} onLogout={() => void logout()} />;
}

/** Session restore: app-shell skeleton (only after 120 ms, so fast restores never flash). */
function RestoringShell() {
  const { showSkeleton } = useSkeletonSwap(false);
  return showSkeleton ? <SkeletonShell /> : <div className="boot-splash" aria-label="Loading"><div><img src="/logo.svg" alt="" /></div></div>;
}

applyPrefs(readPrefs());

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FeedbackProvider>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </FeedbackProvider>
  </React.StrictMode>
);
