import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { CitedAnswer } from "../../../src/factorylm-ui/cited-answer";
import "../../../../packages/factorylm-theme/src/workspace.css";
import "../../../../packages/factorylm-ui/src/evidence-reader.css";
const fileId = "11111111-1111-4111-8111-111111111111";
const citations = [
  { citationId: "1", page: 1, quote: "The equipment label records the model and serial number." },
  { citationId: "2", page: 1, quote: "Check the document revision against the equipment model." },
  { citationId: "3", page: 2, quote: "Source reference          Keep the page with the note." },
  { citationId: "4", page: 2, quote: "This quote is intentionally absent from this PDF." },
  { citationId: "5", page: 100, quote: "A nonexistent page should never become page one." },
].map(c => ({ ...c, fileId, docId: "synthetic-document", sourceTitle: "Synthetic uploaded manual" }));
createRoot(document.getElementById("root")!).render(<StrictMode><main style={{ padding: 24 }}>
  <h1>Real adapter test — synthetic upload</h1>
  <CitedAnswer text={'Identify the equipment [1]. Check applicability [2].\n\nRecord the source [3]. Missing quote [4]. Invalid page [5].'} citations={citations} onFallback={() => { throw new Error("Unexpected fallback"); }} />
</main></StrictMode>);
