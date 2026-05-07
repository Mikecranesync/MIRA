import { HelpHeader } from "../_components/HelpHeader";
import { HelpCard } from "../_components/HelpCard";
import { FEATURES } from "../_content/features";

export const metadata = {
  title: "Feature guides · Help · FactoryLM",
  description: "How every screen in FactoryLM works.",
};

export default function FeaturesIndexPage() {
  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <HelpHeader
        title="Feature guides"
        subtitle="One-page walk-through for every screen."
        backHref="/help"
        backLabel="Help"
      />

      <div className="px-4 py-4 max-w-3xl mx-auto space-y-2">
        {FEATURES.map((feature) => (
          <HelpCard
            key={feature.slug}
            icon={feature.icon}
            title={feature.title}
            description={feature.oneLiner}
            href={`/help/features/${feature.slug}`}
          />
        ))}
      </div>
    </div>
  );
}
