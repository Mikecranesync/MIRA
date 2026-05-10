// Minimal layout for mobile QR landing pages.
// No sidebar, no bottom tabs — just a clean full-bleed mobile view
// for technicians scanning a QR code in the field.
export const dynamic = "force-dynamic";

export default function MLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      {children}
    </div>
  );
}
