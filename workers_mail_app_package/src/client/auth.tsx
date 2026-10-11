import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, Bot, Check, LogIn, Paperclip, ShieldCheck, Sparkles, X, Zap } from "lucide-react";
import { ThemeToggle } from "./components";
import { LoginWaves } from "./ui/waves";
import { DEFAULT_LANDING, DEFAULT_LOADING, api, authLoginUrl, cachedPublicConfig, getPublicConfig, tokenKey, type LandingSettings, type LoadingSettings, type PublicConfig } from "./lib";

const RENEW_KEY = "mail_agent_renew_at";

/** Redirect to Auth Center. If its refresh cookie is still valid, it re-issues a JWT without a prompt. */
export async function redirectToAuthCenter(config?: PublicConfig) {
  const cfg = config || (await getPublicConfig());
  window.location.href = authLoginUrl({ ...cfg, callback_url: cfg.callback_url || `${window.location.origin}/sso-callback` });
}

/** Silent renewal guard: at most one automatic round-trip per minute to avoid redirect loops. */
export function canAutoRenew() {
  const last = Number(sessionStorage.getItem(RENEW_KEY) || 0);
  return Date.now() - last > 60_000;
}
export function markRenewAttempt() {
  sessionStorage.setItem(RENEW_KEY, String(Date.now()));
}

function LandingBackdrop({ config, landing }: { config: PublicConfig | null; landing: LandingSettings }) {
  const url = landing.mode === "image" ? config?.landing_background_url : "";
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!url) return;
    const img = new Image();
    img.onload = () => setLoaded(true);
    img.src = url;
  }, [url]);
  const showWaves = !url || landing.waves_over_image;
  return (
    <>
      {url && loaded && <div className="login-bg" style={{ backgroundImage: `url(${url})`, ["--landing-opacity" as string]: String(config?.landing_background_opacity ?? 0.18) }} />}
      {showWaves && <LoginWaves opacity={(url ? 0.55 : 1) * landing.wave_opacity} />}
      <div className="login-glow" />
    </>
  );
}

/** Presentational sign-in page — also rendered (scaled) as the live preview in System settings. */
export function LoginView({ config, notice, redirecting, onLogin, preview }: { config: PublicConfig | null; notice?: string; redirecting?: boolean; onLogin?: () => void; preview?: boolean }) {
  const landing = { ...DEFAULT_LANDING, ...(config?.landing || {}) };
  const hasImage = landing.mode === "image" && !!config?.landing_background_url;
  return (
    <main className={`login ${hasImage ? "has-bg" : ""} ${preview ? "preview" : ""}`} aria-hidden={preview || undefined}>
      <LandingBackdrop config={config} landing={landing} />
      {!preview && <ThemeToggle />}
      <div className="login-stack">
        <section className="login-card">
          <div className="login-mark"><img src="/logo.svg" alt="" /></div>
          <h1>{landing.title} <span className="ver">beta</span></h1>
          <p className="lede">{landing.tagline}</p>
          {landing.show_features ? (
            <div className="login-features">
              <div><Zap size={16} />Disposable addresses on your own domain</div>
              <div><Paperclip size={16} />Attachments stored safely in R2</div>
              <div><Bot size={16} />Gemini drafts, replies and translations</div>
            </div>
          ) : <div style={{ height: 24 }} />}
          {notice && <div className="alert info" style={{ marginBottom: 14, textAlign: "left" }}>{notice}</div>}
          <button className="primary go" onClick={onLogin} disabled={redirecting} tabIndex={preview ? -1 : undefined}>
            {redirecting ? <span className="ring-spinner" style={{ borderColor: "color-mix(in oklab, currentColor 30%, transparent)", borderTopColor: "currentColor" }} /> : <LogIn size={18} />}
            {redirecting ? "Redirecting to Auth Center…" : "Continue with Auth Center"}
            {!redirecting && <ArrowRight className="arrow" size={17} />}
          </button>
          <p className="fine">Identity and permissions are verified server-side on every request.</p>
        </section>
        <div className="login-help"><ShieldCheck size={14} />Single sign-on by Aryuki Auth Center</div>
      </div>
    </main>
  );
}

export function Login({ notice }: { notice?: string }) {
  const [config, setConfig] = useState<PublicConfig | null>(cachedPublicConfig);
  const [redirecting, setRedirecting] = useState(false);
  useEffect(() => { void getPublicConfig().then(setConfig); }, []);
  const login = async () => {
    setRedirecting(true);
    markRenewAttempt();
    await redirectToAuthCenter(config || undefined);
  };
  return <LoginView config={config} notice={notice} redirecting={redirecting} onLogin={() => void login()} />;
}

/* ---------- Boot / sign-in progress screen --------------------------------- */
type StepState = "pending" | "active" | "done" | "error";

export function BootScreen({ title, subtitle, steps, progress, error, actions, loading, preview }: { title?: string; subtitle?: string; steps: Array<{ label: string; state: StepState }>; progress: number | null; error?: boolean; actions?: React.ReactNode; loading?: LoadingSettings; preview?: boolean }) {
  const cfg = { ...DEFAULT_LOADING, ...(loading || cachedPublicConfig()?.loading || {}) };
  const allDone = steps.every((s) => s.state === "done");
  const minimal = cfg.style === "minimal";
  // Admin-configured copy is used for the normal in-progress state; errors always explain themselves.
  const heading = error ? title : title === undefined || title === DEFAULT_LOADING.title ? cfg.title : title;
  const sub = error ? subtitle : subtitle === undefined || subtitle === DEFAULT_LOADING.subtitle ? cfg.subtitle : subtitle;
  return (
    <main className={`login ${preview ? "preview" : ""}`} aria-hidden={preview || undefined}>
      {cfg.show_waves && <LoginWaves />}
      <div className="login-glow" />
      <section className={`login-card boot-card ${minimal ? "minimal" : ""}`} aria-live="polite">
        <div className="boot-head">
          <div className={`boot-orbit ${allDone ? "done" : ""} ${error ? "error" : ""}`}><img src="/logo.svg" alt="" /></div>
          <div>
            <strong>{heading}</strong>
            <small>{sub}</small>
          </div>
        </div>
        {(!minimal || error) && (
          <div className="boot-steps">
            {steps.map((s) => (
              <div key={s.label} className={`boot-step ${s.state}`}>
                <span className="dot">
                  {s.state === "active" && <span className="ring-spinner" style={{ width: 14, height: 14 }} />}
                  {s.state === "done" && <Check size={12} strokeWidth={3} />}
                  {s.state === "error" && <X size={12} strokeWidth={3} />}
                </span>
                {s.label}
              </div>
            ))}
          </div>
        )}
        {!error && cfg.show_progress && (
          <div className="boot-bar progress-track"><b style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} /></div>
        )}
        {actions && <div className="boot-actions">{actions}</div>}
      </section>
    </main>
  );
}

export function Callback({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<0 | 1 | 2 | 3>(0);
  const [error, setError] = useState("");
  const ran = useRef(false);
  const run = async () => {
    setError("");
    const token = new URLSearchParams(window.location.search).get("token") || sessionStorage.getItem("mail_agent_pending_token");
    // Never leave a JWT in the address bar / history.
    window.history.replaceState({}, "", "/sso-callback");
    if (!token) {
      setError("The sign-in response did not include a token.");
      return;
    }
    sessionStorage.setItem("mail_agent_pending_token", token);
    setPhase(1);
    try {
      await api<{ token: string }>("/api/sso-callback", { method: "POST", body: JSON.stringify({ token }) });
      localStorage.setItem(tokenKey, token);
      sessionStorage.removeItem("mail_agent_pending_token");
      setPhase(2);
      await api("/api/me");
      setPhase(3);
      window.setTimeout(() => {
        window.history.replaceState({}, "", "/");
        onDone();
      }, 280);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    }
  };
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void run();
  }, []);
  const state = (i: number): StepState => (error && phase === i ? "error" : phase > i ? "done" : phase === i ? "active" : "pending");
  return (
    <BootScreen
      title={error ? "Sign-in didn't complete" : phase === 3 ? "Welcome back" : undefined}
      subtitle={error || (phase === 3 ? "Opening your workspace…" : undefined)}
      error={!!error}
      progress={[0.12, 0.45, 0.8, 1][phase]}
      steps={[
        { label: "Received token from Auth Center", state: state(0) },
        { label: "Verifying identity and app access", state: state(1) },
        { label: "Loading your workspace", state: state(2) }
      ]}
      actions={error ? (
        <>
          <button onClick={() => { sessionStorage.removeItem("mail_agent_pending_token"); window.location.replace("/"); }}>Back</button>
          <button className="primary" onClick={() => { markRenewAttempt(); void redirectToAuthCenter(); }}><Sparkles size={15} />Sign in again</button>
        </>
      ) : undefined}
    />
  );
}

export function RenewScreen() {
  return (
    <BootScreen
      title="Renewing your session"
      subtitle="Your sign-in expired — refreshing it with Auth Center."
      progress={0.5}
      steps={[
        { label: "Session expired", state: "done" },
        { label: "Requesting a new token", state: "active" }
      ]}
    />
  );
}
