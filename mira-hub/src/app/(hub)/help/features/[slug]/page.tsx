import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { HelpHeader } from "../../_components/HelpHeader";
import { Feedback } from "../../_components/Feedback";
import { FEATURES, getFeature } from "../../_content/features";

export function generateStaticParams() {
  return FEATURES.map((f) => ({ slug: f.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const f = getFeature(slug);
  if (!f) return { title: "Not found · Help · FactoryLM" };
  return {
    title: `${f.title} · Help · FactoryLM`,
    description: f.oneLiner,
  };
}

export default async function FeatureDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const feature = getFeature(slug);
  if (!feature) notFound();

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <HelpHeader
        title={feature.title}
        subtitle={feature.oneLiner}
        backHref="/help/features"
        backLabel="All features"
      />

      <div className="px-4 py-4 max-w-3xl mx-auto space-y-6">
        <section className="card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-2"
            style={{ color: "var(--foreground-muted)" }}>
            What this does
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: "var(--foreground)" }}>
            {feature.whatItDoes}
          </p>
        </section>

        <section className="card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: "var(--foreground-muted)" }}>
            How to use it
          </h2>
          <ol className="space-y-3">
            {feature.howToUse.map((item, i) => (
              <li key={i} className="flex gap-3">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                  style={{
                    background: "linear-gradient(135deg, #2563EB, #0891B2)",
                    color: "white",
                  }}
                >
                  {i + 1}
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                    {item.step}
                  </p>
                  <p className="text-sm mt-0.5" style={{ color: "var(--foreground-muted)" }}>
                    {item.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {feature.questions.length > 0 && (
          <section className="card p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3"
              style={{ color: "var(--foreground-muted)" }}>
              Common questions
            </h2>
            <div className="space-y-3">
              {feature.questions.map((qa, i) => (
                <div key={i}>
                  <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                    {qa.q}
                  </p>
                  <p className="text-sm mt-1" style={{ color: "var(--foreground-muted)" }}>
                    {qa.a}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {feature.related.length > 0 && (
          <section>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2 px-1"
              style={{ color: "var(--foreground-muted)" }}>
              Related
            </p>
            <div className="space-y-2">
              {feature.related.map((rel) => (
                <Link
                  key={rel.href}
                  href={rel.href}
                  className="card p-3 flex items-center justify-between hover:bg-[var(--surface-1)] transition-colors"
                >
                  <span className="text-sm" style={{ color: "var(--foreground)" }}>
                    {rel.label}
                  </span>
                  <ChevronRight className="w-4 h-4" style={{ color: "var(--foreground-subtle)" }} />
                </Link>
              ))}
            </div>
          </section>
        )}

        <Feedback pageSlug={`feature-${feature.slug}`} />
      </div>
    </div>
  );
}
