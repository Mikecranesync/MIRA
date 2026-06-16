import Link from "next/link";
import { Factory } from "lucide-react";

export default function NotFound() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)" }}
    >
      <div className="text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
          style={{
            background: "linear-gradient(135deg, #2563EB, #0891B2)",
            boxShadow: "0 0 32px rgba(37,99,235,0.4)",
          }}
        >
          <Factory className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-6xl font-bold text-white mb-3">404</h1>
        <p className="text-slate-400 text-lg mb-8">This page doesn&apos;t exist.</p>
        <Link
          href="/feed"
          className="inline-flex items-center px-6 py-3 rounded-lg font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
