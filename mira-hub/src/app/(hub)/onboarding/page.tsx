"use client";

/**
 * Namespace onboarding wizard — Phase 3 slice 0.
 *
 * Spec: docs/specs/maintenance-namespace-builder-spec.md §"Onboarding wizard"
 * Plan: docs/plans/2026-05-15-maintenance-namespace-builder.md (Phase 3)
 *
 * Minimum 3-step flow:
 *   1. Company  — company name
 *   2. Site     — first site name + optional location
 *   3. Line     — first production line name + optional description
 *   → Finish creates kg_entities (site + line) with uns_path values,
 *     writes namespace_versions audit rows, redirects to /namespace.
 *
 * Slice 1 will add area, equipment, tag-import CSV.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Building2, Factory, Loader2, MapPin, MessageSquare, ShieldCheck, Sparkles, Tag } from "lucide-react";
import { API_BASE } from "@/lib/config";
import { AssetValidateTab } from "@/components/AssetValidateTab";

type StepId = "company" | "site" | "line" | "tag-import" | "review" | "try" | "validate";

interface CompanyPayload    { name: string }
interface SitePayload       { name: string; location?: string }
interface LinePayload       { name: string; description?: string }
interface TagImportPayload  { proposals_created?: number; skipped?: boolean }
interface AllPayloads {
  company?: CompanyPayload;
  site?: SitePayload;
  line?: LinePayload;
  tagImport?: TagImportPayload;
}

const STEPS: { id: StepId; label: string; icon: React.ElementType }[] = [
  { id: "company",    label: "Company",        icon: Building2 },
  { id: "site",       label: "First site",     icon: MapPin },
  { id: "line",       label: "First line",     icon: Factory },
  { id: "tag-import", label: "Import tags",    icon: Tag },
  { id: "review",     label: "Review & finish", icon: Sparkles },
  { id: "try",        label: "Try MIRA",        icon: MessageSquare },
  { id: "validate",   label: "Train & approve", icon: ShieldCheck },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [activeStep, setActiveStep] = useState<StepId>("company");
  const [payloads, setPayloads] = useState<AllPayloads>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resume from server: read whatever step the user was last on.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/wizard/company/`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          if (res.status !== 401) setError(`Failed to load progress: HTTP ${res.status}`);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (data.status === "completed") {
          router.replace("/namespace");
          return;
        }
        const restored: AllPayloads = data.stepPayloads ?? {};
        setPayloads(restored);
        const current = String(data.currentStep ?? "company");
        const known: StepId[] = ["company", "site", "line", "tag-import", "review"];
        setActiveStep(known.includes(current as StepId) ? (current as StepId) : "review");
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function saveStep(stepId: Exclude<StepId, "review">, value: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/wizard/${stepId}/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setSaving(false);
    }
  }

  async function finish() {
    setFinishing(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/wizard/finish/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; sitePath?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      advance("try");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFinishing(false);
    }
  }

  function advance(next: StepId) {
    setActiveStep(next);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading wizard…
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6 sm:p-10" data-testid="onboarding-page">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Build your namespace</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          A namespace gives MIRA the factory context to ground every answer. We&apos;ll start
          with one site and one line — you can add more later from the namespace tab.
        </p>
      </header>

      <Stepper active={activeStep} payloads={payloads} />

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" data-testid="onboarding-error">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {activeStep === "company" && (
          <CompanyStep
            value={payloads.company}
            saving={saving}
            onSubmit={async (value) => {
              await saveStep("company", value as unknown as Record<string, unknown>);
              setPayloads((p) => ({ ...p, company: value }));
              advance("site");
            }}
          />
        )}
        {activeStep === "site" && (
          <SiteStep
            value={payloads.site}
            saving={saving}
            onBack={() => advance("company")}
            onSubmit={async (value) => {
              await saveStep("site", value as unknown as Record<string, unknown>);
              setPayloads((p) => ({ ...p, site: value }));
              advance("line");
            }}
          />
        )}
        {activeStep === "line" && (
          <LineStep
            value={payloads.line}
            saving={saving}
            onBack={() => advance("site")}
            onSubmit={async (value) => {
              await saveStep("line", value as unknown as Record<string, unknown>);
              setPayloads((p) => ({ ...p, line: value }));
              advance("tag-import");
            }}
          />
        )}
        {activeStep === "tag-import" && (
          <TagImportStep
            saving={saving}
            onBack={() => advance("line")}
            onSubmit={async (proposalsCreated) => {
              await saveStep("tag-import", { proposals_created: proposalsCreated });
              setPayloads((p) => ({ ...p, tagImport: { proposals_created: proposalsCreated } }));
              advance("review");
            }}
            onSkip={async () => {
              await saveStep("tag-import", { skipped: true });
              setPayloads((p) => ({ ...p, tagImport: { skipped: true } }));
              advance("review");
            }}
          />
        )}
        {activeStep === "review" && (
          <ReviewStep
            payloads={payloads}
            finishing={finishing}
            onBack={() => advance("tag-import")}
            onFinish={finish}
          />
        )}
        {activeStep === "try" && (
          <TryStep
            payloads={payloads}
            onTry={() => router.push("/quickstart")}
            onValidate={() => advance("validate")}
            onSkip={() => router.replace("/namespace")}
          />
        )}
        {activeStep === "validate" && (
          <ValidateStep
            onBack={() => advance("try")}
            onDone={() => router.replace("/namespace")}
          />
        )}
      </div>
    </div>
  );
}

function Stepper({ active, payloads }: { active: StepId; payloads: AllPayloads }) {
  return (
    <ol className="flex flex-wrap gap-2 sm:gap-3" data-testid="onboarding-stepper">
      {STEPS.map((s, i) => {
        const done = isStepDone(s.id, payloads);
        const isActive = s.id === active;
        const Icon = s.icon;
        return (
          <li key={s.id} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-medium ${
                isActive
                  ? "border-blue-500 bg-blue-50 text-blue-600"
                  : done
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-white text-slate-400"
              }`}
              data-testid={`stepper-${s.id}`}
              data-active={isActive ? "true" : "false"}
              data-done={done ? "true" : "false"}
            >
              <Icon className="h-4 w-4" />
            </div>
            <span className={`text-sm ${isActive ? "font-semibold text-slate-900" : "text-slate-500"}`}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="hidden text-slate-300 sm:inline">→</span>}
          </li>
        );
      })}
    </ol>
  );
}

function isStepDone(id: StepId, p: AllPayloads): boolean {
  if (id === "company")    return !!p.company?.name;
  if (id === "site")       return !!p.site?.name;
  if (id === "line")       return !!p.line?.name;
  if (id === "tag-import") return p.tagImport?.proposals_created !== undefined || p.tagImport?.skipped === true;
  return false;
}

function CompanyStep({
  value,
  saving,
  onSubmit,
}: {
  value: CompanyPayload | undefined;
  saving: boolean;
  onSubmit: (v: CompanyPayload) => Promise<void>;
}) {
  const [name, setName] = useState(value?.name ?? "");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        await onSubmit({ name: name.trim() });
      }}
      className="space-y-4"
      data-testid="step-company"
    >
      <Field
        label="Company name"
        hint="Used as the namespace root label. You can rename it later."
      >
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Harper Industries"
          required
          maxLength={200}
          autoFocus
          data-testid="input-company-name"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </Field>
      <NavButtons rightLabel="Continue" rightLoading={saving} disableRight={!name.trim()} />
    </form>
  );
}

function SiteStep({
  value,
  saving,
  onBack,
  onSubmit,
}: {
  value: SitePayload | undefined;
  saving: boolean;
  onBack: () => void;
  onSubmit: (v: SitePayload) => Promise<void>;
}) {
  const [name, setName] = useState(value?.name ?? "");
  const [location, setLocation] = useState(value?.location ?? "");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        await onSubmit({ name: name.trim(), location: location.trim() || undefined });
      }}
      className="space-y-4"
      data-testid="step-site"
    >
      <Field label="First site" hint="A plant, factory, or facility you operate.">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Lake Wales Plant"
          required
          maxLength={200}
          autoFocus
          data-testid="input-site-name"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </Field>
      <Field label="Location (optional)">
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Lake Wales, FL"
          maxLength={200}
          data-testid="input-site-location"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </Field>
      <NavButtons
        leftLabel="Back"
        onLeft={onBack}
        rightLabel="Continue"
        rightLoading={saving}
        disableRight={!name.trim()}
      />
    </form>
  );
}

function LineStep({
  value,
  saving,
  onBack,
  onSubmit,
}: {
  value: LinePayload | undefined;
  saving: boolean;
  onBack: () => void;
  onSubmit: (v: LinePayload) => Promise<void>;
}) {
  const [name, setName] = useState(value?.name ?? "");
  const [description, setDescription] = useState(value?.description ?? "");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        await onSubmit({ name: name.trim(), description: description.trim() || undefined });
      }}
      className="space-y-4"
      data-testid="step-line"
    >
      <Field label="First production line" hint="MIRA proposes assets and components under this line.">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Sorting Line"
          required
          maxLength={200}
          autoFocus
          data-testid="input-line-name"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </Field>
      <Field label="What does it produce? (optional)">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Sorts incoming product by height before packaging"
          maxLength={500}
          rows={3}
          data-testid="input-line-description"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </Field>
      <NavButtons
        leftLabel="Back"
        onLeft={onBack}
        rightLabel="Continue"
        rightLoading={saving}
        disableRight={!name.trim()}
      />
    </form>
  );
}

function ReviewStep({
  payloads,
  finishing,
  onBack,
  onFinish,
}: {
  payloads: AllPayloads;
  finishing: boolean;
  onBack: () => void;
  onFinish: () => Promise<void>;
}) {
  const siteSlug = slugify(payloads.site?.name ?? "");
  const lineSlug = slugify(payloads.line?.name ?? "");
  return (
    <div className="space-y-4" data-testid="step-review">
      <p className="text-sm text-slate-600">
        Confirm and we&apos;ll seed your namespace with one site and one line. You can
        rename, move, or expand from the namespace tab right after.
      </p>
      <dl className="space-y-2 rounded-md bg-slate-50 p-4 text-sm">
        <Pair k="Company"  v={payloads.company?.name ?? "—"} />
        <Pair k="Site"     v={payloads.site?.name ?? "—"} />
        {payloads.site?.location && <Pair k="Location" v={payloads.site.location} />}
        <Pair k="Line"     v={payloads.line?.name ?? "—"} />
        {payloads.line?.description && <Pair k="Produces" v={payloads.line.description} />}
      </dl>
      <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
        <strong>Namespace preview:</strong>
        <div className="mt-2 space-y-1 font-mono">
          <div>enterprise.{siteSlug || "<site>"}</div>
          <div className="pl-4">enterprise.{siteSlug || "<site>"}.{lineSlug || "<line>"}</div>
        </div>
      </div>
      <NavButtons
        leftLabel="Back"
        onLeft={onBack}
        rightLabel="Create namespace"
        rightLoading={finishing}
        rightTestId="onboarding-finish"
        onRight={onFinish}
      />
    </div>
  );
}

function TryStep({
  payloads,
  onTry,
  onValidate,
  onSkip,
}: {
  payloads: AllPayloads;
  onTry: () => void;
  onValidate: () => void;
  onSkip: () => void;
}) {
  const lineName = payloads.line?.name ?? "your line";
  return (
    <div className="space-y-5" data-testid="step-try">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Namespace ready.</h2>
          <p className="mt-1 text-sm text-slate-600">
            MIRA now knows about <span className="font-medium text-slate-900">{lineName}</span>.
            Ask a real maintenance question and get a cited answer from the OEM corpus —
            fault codes, troubleshooting steps, part references.
          </p>
        </div>
      </div>
      <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
        <strong>Example asks:</strong>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>What does fault F0004 mean on a PowerFlex 525?</li>
          <li>How do I reset an Allen-Bradley 1756-EN2T module?</li>
          <li>Common causes of overheating on a SEW-Eurodrive gearmotor?</li>
        </ul>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onSkip}
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
          data-testid="onboarding-skip-try"
        >
          Skip to namespace
        </button>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onTry}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            data-testid="onboarding-try-mira"
          >
            <MessageSquare className="h-4 w-4" /> Try MIRA now
          </button>
          <button
            type="button"
            onClick={onValidate}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            data-testid="onboarding-train-approve"
          >
            <ShieldCheck className="h-4 w-4" /> Train &amp; approve <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Train-before-deploy wizard step. Pick an asset, then drive the asset-agent
 * lifecycle (validate Q&A → approve) via the AssetValidateTab from #1783. Only
 * approved assets answer on the Ignition/HMI surface — the Command Center is
 * where you train MIRA before deploying it. See
 * docs/specs/asset-agent-validation-spec.md §8 and .claude/rules/train-before-deploy.md.
 */
function ValidateStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [assets, setAssets] = useState<{ id: string; tag: string; name: string }[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/assets/`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) throw new Error(`Failed to load assets: HTTP ${res.status}`);
        const data = (await res.json()) as Array<{ id?: unknown; tag?: unknown; name?: unknown }>;
        if (cancelled) return;
        const list = (Array.isArray(data) ? data : []).map((a) => ({
          id: String(a.id ?? ""),
          tag: String(a.tag ?? a.id ?? ""),
          name: String(a.name ?? a.tag ?? a.id ?? ""),
        })).filter((a) => a.id);
        setAssets(list);
        if (list.length === 1) setSelectedId(list[0].id);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-5" data-testid="step-validate">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Train &amp; approve before deploy</h2>
          <p className="mt-1 text-sm text-slate-600">
            Pick an asset, ask MIRA real questions, mark the cited answers good or bad, and
            approve it. Only <span className="font-medium text-slate-900">approved</span> assets
            answer on the Ignition / HMI surface — you train MIRA here, then deploy.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" data-testid="validate-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading assets…
        </div>
      ) : assets.length === 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="validate-no-assets">
          No assets yet. Add one from the{" "}
          <a className="font-medium underline" href={`${API_BASE}/assets`}>Assets tab</a>, then come
          back to validate it. (The wizard created your site and line; assets, docs, and tags fill in
          from there — you can always reach this from an asset&apos;s <strong>Validate</strong> tab later.)
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Asset to validate" hint="MIRA validates and approves one asset agent at a time.">
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              data-testid="validate-asset-select"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Select an asset…</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.tag && a.tag !== a.name ? ` (${a.tag})` : ""}
                </option>
              ))}
            </select>
          </Field>
          {selectedId && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4" data-testid="validate-tab-host">
              <AssetValidateTab assetId={selectedId} />
            </div>
          )}
        </div>
      )}

      <NavButtons
        leftLabel="Back"
        onLeft={onBack}
        rightLabel="Finish"
        onRight={onDone}
        rightTestId="onboarding-validate-done"
      />
    </div>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex">
      <dt className="w-28 shrink-0 text-slate-500">{k}</dt>
      <dd className="text-slate-900">{v}</dd>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-900">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

function NavButtons({
  leftLabel,
  onLeft,
  rightLabel,
  onRight,
  rightLoading,
  rightTestId,
  disableRight,
}: {
  leftLabel?: string;
  onLeft?: () => void;
  rightLabel: string;
  onRight?: () => void;
  rightLoading?: boolean;
  rightTestId?: string;
  disableRight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between pt-2">
      {leftLabel ? (
        <button
          type="button"
          onClick={onLeft}
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
          data-testid="onboarding-back"
        >
          <ArrowLeft className="h-4 w-4" /> {leftLabel}
        </button>
      ) : (
        <span />
      )}
      <button
        type={onRight ? "button" : "submit"}
        onClick={onRight}
        disabled={rightLoading || disableRight}
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        data-testid={rightTestId ?? "onboarding-next"}
      >
        {rightLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {rightLabel}
        {!rightLoading && <ArrowRight className="h-4 w-4" />}
      </button>
    </div>
  );
}

function TagImportStep({
  saving,
  onBack,
  onSubmit,
  onSkip,
}: {
  saving: boolean;
  onBack: () => void;
  onSubmit: (proposalsCreated: number) => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const [classifying, setClassifying] = useState(false);
  const [result, setResult] = useState<{ proposals_created: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function classify() {
    setClassifying(true);
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/connectors/ignition/import/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connector_type: "mock" }),
      });
      const data = (await res.json().catch(() => ({}))) as { proposals_created?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult({ proposals_created: data.proposals_created ?? 0 });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setClassifying(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="step-tag-import">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Import Ignition tags</h2>
        <p className="mt-1 text-sm text-slate-600">
          MIRA classifies your Ignition tags into UNS paths and creates mapping proposals for review.
          Use the demo tag set to see how it works, then review proposals in the Suggestions tab.
        </p>
      </div>

      {err && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>
      )}

      {!result ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
          <Tag className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm text-slate-600">
            Click to classify the demo Ignition tag set and generate tag-mapping proposals.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            File import from a live Ignition gateway is coming in a future release.
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-800">
            {result.proposals_created} tag proposals created.
          </p>
          <p className="mt-1 text-xs text-emerald-700">
            Review and accept or reject them in the{" "}
            <a className="underline" href={`${API_BASE}/knowledge/suggestions`}>Suggestions tab</a>.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
          data-testid="onboarding-back"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="flex items-center gap-3">
          {!result && (
            <button
              type="button"
              onClick={classify}
              disabled={classifying}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              data-testid="tag-import-classify"
            >
              {classifying && <Loader2 className="h-4 w-4 animate-spin" />}
              {classifying ? "Classifying…" : "Classify demo tags"}
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              if (result) {
                await onSubmit(result.proposals_created);
              } else {
                await onSkip();
              }
            }}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            data-testid="tag-import-continue"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {result ? "Continue" : "Skip"}
            {!saving && <ArrowRight className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || "_";
}
