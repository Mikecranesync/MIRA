import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  type DeviceTier,
  type FieldbusDevice,
  type FieldbusInventory,
  tierLabel,
} from "@/lib/discovery";

const TIER_VARIANT: Record<DeviceTier, "green" | "yellow" | "gray"> = {
  device_identified: "green",
  protocol_confirmed: "yellow",
  port_open: "gray",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] uppercase tracking-wide text-[--foreground-muted]">{label}</span>
      <span className="text-sm text-[--foreground] break-words">{children}</span>
    </div>
  );
}

function identityText(d: FieldbusDevice): string {
  const { vendor, product, serial } = d.identity ?? {};
  const parts = [product, vendor && `vendor ${vendor}`, serial && `s/n ${serial}`].filter(Boolean);
  return parts.length ? (parts.join(" · ") as string) : "—";
}

function DeviceCard({ device }: { device: FieldbusDevice }) {
  return (
    <Card
      data-testid="discovery-device"
      data-tier={device.tier}
      data-profile={device.profile ?? ""}
      className="p-4 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-mono text-sm font-semibold text-[--foreground] break-all">
            {device.address}
          </span>
          <span className="text-xs text-[--foreground-muted]">
            {device.transport} · {device.protocol}
          </span>
        </div>
        <Badge variant={TIER_VARIANT[device.tier]} data-testid="tier-badge">
          {tierLabel(device.tier)}
        </Badge>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="Profile">{device.profile ?? "—"}</Field>
        <Field label="Identity">{identityText(device)}</Field>
        <Field label="UNS hint">
          {device.uns_hint ? (
            <span className="font-mono text-xs break-all" data-testid="uns-hint">
              {device.uns_hint}
            </span>
          ) : (
            "—"
          )}
        </Field>
      </div>

      {device.next_actions.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-[--foreground-muted]">
            Next actions
          </span>
          <ul className="list-disc pl-5 text-sm text-[--foreground] flex flex-col gap-0.5">
            {device.next_actions.map((a, i) => (
              <li key={i} className="break-words">{a}</li>
            ))}
          </ul>
        </div>
      )}

      {device.evidence.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {device.evidence.map((e, i) => (
            <Badge key={i} variant="outline" className="font-normal">{e}</Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

export function DeviceTable({ inventory }: { inventory: FieldbusInventory | null }) {
  const devices = inventory?.devices ?? [];
  const unknowns = inventory?.unknowns ?? [];

  if (devices.length === 0 && unknowns.length === 0) {
    return (
      <Card className="p-8 text-center" data-testid="discovery-empty">
        <p className="text-sm text-[--foreground-muted]">
          No devices yet. Run <span className="font-mono">python plc/discover.py</span> on a plant
          machine, then upload the resulting <span className="font-mono">inventory.json</span> below.
        </p>
      </Card>
    );
  }

  const counts = devices.reduce<Record<string, number>>((acc, d) => {
    acc[d.tier] = (acc[d.tier] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[--foreground-muted]">
        <span>{devices.length} device{devices.length === 1 ? "" : "s"}</span>
        {(["device_identified", "protocol_confirmed", "port_open"] as DeviceTier[])
          .filter((t) => counts[t])
          .map((t) => (
            <Badge key={t} variant={TIER_VARIANT[t]}>
              {counts[t]} {tierLabel(t)}
            </Badge>
          ))}
        {inventory?.scanned_at && <span>· scanned {new Date(inventory.scanned_at).toLocaleString()}</span>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {devices.map((d, i) => (
          <DeviceCard key={`${d.address}-${i}`} device={d} />
        ))}
      </div>

      {unknowns.length > 0 && (
        <div className="flex flex-col gap-2 mt-2" data-testid="discovery-unknowns">
          <span className="text-[11px] uppercase tracking-wide text-[--foreground-muted]">
            Unidentified ({unknowns.length}) — responded but no profile matched
          </span>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {unknowns.map((u, i) => (
              <Card key={`${u.address}-${i}`} className="p-3 opacity-70">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-mono text-xs break-all">{u.address}</span>
                  {u.open_ports.length > 0 && (
                    <span className="text-xs text-[--foreground-muted]">
                      ports {u.open_ports.join(", ")}
                    </span>
                  )}
                </div>
                {u.note && <p className="text-xs text-[--foreground-muted] mt-1">{u.note}</p>}
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
