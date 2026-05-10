"use client";

export default function PlcPage() {
  return (
    <div className="flex flex-col h-full -m-6">
      <iframe
        src="https://mikecranesync.github.io/ladder-logic-editor/"
        className="flex-1 w-full border-0"
        title="Ladder Logic Editor"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
