// Post-hoc sensitivity helper: which sealed questions does production classify as "broad" (rerank skipped by design)?
import { readFileSync } from "node:fs";
import { classifyBroad } from "@/lib/notebook-query";
const qs = JSON.parse(readFileSync(process.argv.slice(2).filter((a) => a !== "--")[0], "utf8")) as { id: string; question: string }[];
console.log(JSON.stringify(qs.filter((q) => classifyBroad(q.question).broad).map((q) => q.id)));
