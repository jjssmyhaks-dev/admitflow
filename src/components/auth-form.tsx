"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/marketing";

export function DemoAuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [email, setEmail] = useState("owner@greenfield.edu");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/console");
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Sign-in failed");
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Brand />
      <div className="panel" style={{ width: "100%", maxWidth: 420, marginTop: 28 }}>
        <h3>{mode === "sign-in" ? "Sign in to AdmitFlow" : "Create your institution"}</h3>
        <p className="panel-sub">
          Demo mode: no Clerk keys detected, so credentials stay local. Use the prefilled accounts.
        </p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {error ? <p style={{ color: "var(--destructive)", fontSize: 13 }}>{error}</p> : null}
          <button className="tines-button tines-button-solid" type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? "Signing in…" : mode === "sign-in" ? "Sign in" : "Continue"}
          </button>
        </form>
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 18, paddingTop: 14, fontSize: 13, color: "var(--muted-foreground)" }}>
          <p style={{ margin: "4px 0" }}>owner@greenfield.edu — Owner, Greenfield Public School</p>
          <p style={{ margin: "4px 0" }}>counselor@suryainst.edu — Counselor, Surya Institute of Technology</p>
          <p style={{ margin: "4px 0" }}>Password for both: demo1234</p>
        </div>
      </div>
      <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 16 }}>
        {mode === "sign-in" ? "New here? " : "Already have an account? "}
        <a href={mode === "sign-in" ? "/sign-up" : "/sign-in"} style={{ textDecoration: "underline" }}>
          {mode === "sign-in" ? "Create an institution" : "Sign in"}
        </a>
      </p>
    </div>
  );
}
