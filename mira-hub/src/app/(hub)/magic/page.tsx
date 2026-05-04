"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Factory, Loader2, XCircle } from "lucide-react";
import { Suspense } from "react";

function MagicVerify() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"verifying" | "error">("verifying");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      return;
    }
    signIn("magic-token", { token, redirect: false })
      .then(result => {
        if (result?.ok) {
          router.push("/feed");
        } else {
          setStatus("error");
        }
      })
      .catch(() => setStatus("error"));
  }, [token, router]);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)" }}
    >
      <div className="text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
          style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)", boxShadow: "0 0 32px rgba(37,99,235,0.4)" }}
        >
          <Factory className="w-8 h-8 text-white" />
        </div>
        {status === "verifying" ? (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto mb-4" />
            <p className="text-white text-lg font-semibold">Signing you in…</p>
            <p className="text-slate-400 text-sm mt-2">Verifying your magic link</p>
          </>
        ) : (
          <>
            <XCircle className="w-8 h-8 text-red-400 mx-auto mb-4" />
            <p className="text-white text-lg font-semibold">Link expired or already used</p>
            <p className="text-slate-400 text-sm mt-2">Magic links expire after 15 minutes.</p>
            <a
              href="/login"
              className="mt-6 inline-block px-6 py-2.5 rounded-lg text-sm font-semibold text-white"
              style={{ background: "linear-gradient(135deg,#2563EB,#0891B2)" }}
            >
              Back to login
            </a>
          </>
        )}
      </div>
    </div>
  );
}

export default function MagicPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    }>
      <MagicVerify />
    </Suspense>
  );
}
