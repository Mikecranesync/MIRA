"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Factory, Loader2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authProvider } from "@/providers/auth-provider";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("mike@factorylm.com");
  const [password, setPassword] = useState("admin123");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const result = await authProvider.login({ email, password });
    setLoading(false);
    if (result.success) {
      router.push("/feed");
    } else {
      setError(result.error?.message ?? "Invalid credentials");
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)" }}>

      {/* Background grid pattern */}
      <div className="absolute inset-0 opacity-5"
        style={{ backgroundImage: "radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)", backgroundSize: "32px 32px" }} />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)", boxShadow: "0 0 32px rgba(37,99,235,0.4)" }}>
            <Factory className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">FactoryLM</h1>
          <p className="text-slate-400 text-sm mt-1">Industrial Maintenance Platform</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-700/50 p-8"
          style={{ background: "rgba(26,29,35,0.95)", backdropFilter: "blur(12px)", boxShadow: "0 24px 64px rgba(0,0,0,0.4)" }}>

          <h2 className="text-lg font-semibold text-white mb-6">Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Email address</label>
              <Input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                required
                className="h-11 bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
              <div className="relative">
                <Input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  className="h-11 pr-10 bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 text-base font-semibold mt-2"
              disabled={loading}
              style={{ background: loading ? undefined : "linear-gradient(135deg, #2563EB, #0891B2)" }}
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</> : "Sign In"}
            </Button>
          </form>

          <p className="text-center text-xs text-slate-500 mt-6">
            Demo: <span className="text-slate-400 font-mono">mike@factorylm.com</span> /{" "}
            <span className="text-slate-400 font-mono">admin123</span>
          </p>
        </div>
      </div>
    </div>
  );
}
