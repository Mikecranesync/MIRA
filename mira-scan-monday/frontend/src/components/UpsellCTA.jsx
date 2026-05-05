import { Button } from "@mondaydotcomorg/vibe";

export default function UpsellCTA({ plate }) {
  const signupUrl = import.meta.env.VITE_FACTORYLM_SIGNUP_URL || "https://app.factorylm.com/signup";
  const params = new URLSearchParams();
  if (plate?.make) params.set("make", plate.make);
  if (plate?.model) params.set("model", plate.model);
  if (plate?.serial) params.set("serial", plate.serial);
  const href = `${signupUrl}?${params.toString()}`;

  return (
    <div className="card">
      <h3 style={{ margin: 0, fontSize: 16 }}>No manual on file yet</h3>
      <p className="muted" style={{ marginTop: 4 }}>
        We don't have OEM documentation for{" "}
        <strong>
          {plate?.make || "this make"} {plate?.model || ""}
        </strong>
        . Add it to FactoryLM and we'll ingest the manual, build a diagnostic
        index, and bring chat back here.
      </p>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <Button onClick={() => window.open(href, "_blank", "noopener,noreferrer")}>
          Add to FactoryLM
        </Button>
      </div>
    </div>
  );
}
