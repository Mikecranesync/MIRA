import "@factorylm/theme/workspace.css";
import "@factorylm/ui/shell.css";
import "@factorylm/ui/conversation.css";
import "./lab.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EvidencePrototype } from "./EvidencePrototype";

createRoot(document.getElementById("root")!).render(<StrictMode><EvidencePrototype /></StrictMode>);
