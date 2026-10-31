// Runs inside the WebView via cdp.mjs evaluate; kept pure for offline controls.
export function readHistoryState(question) {
  const root = document.querySelector('[data-testid="unified-root"][data-notebook-id]');
  if (!root) return null;
  const current = [...root.querySelectorAll('[data-item-kind="thread"][aria-current="page"]')];
  const assistants = [...root.querySelectorAll('[data-turn-id][data-role="assistant"]')];
  const users = [...root.querySelectorAll('[data-turn-id][data-role="user"]')]
    .filter((turn) => turn.querySelector('[data-part-type="text"]')?.textContent?.trim() === question);
  const answers = users.map((user) => {
    const id = user.getAttribute("data-turn-id") ?? "";
    if (!id.endsWith("-q")) return null;
    const matching = assistants.filter((turn) => turn.getAttribute("data-turn-id") === `${id.slice(0, -2)}-a`);
    if (matching.length !== 1) return { userTurnId: id, pairedAssistantCount: matching.length };
    const assistant = matching[0];
    return {
      userTurnId: id,
      assistantTurnId: assistant.getAttribute("data-turn-id"),
      pairedAssistantCount: matching.length,
      answerText: assistant.querySelector('[data-part-type="text"]')?.textContent?.trim() ?? "",
      lifecycle: assistant.getAttribute("data-lifecycle"),
      citationIds: [...assistant.querySelectorAll('button[aria-label^="Citation "]')]
        .map((node) => node.getAttribute("aria-label").slice(9)),
      sources: [...assistant.querySelectorAll('button[data-part-type="source"][data-source-id]')]
        .map((node) => ({ id: node.getAttribute("data-source-id"), text: node.textContent ?? "" })),
    };
  });
  return {
    notebookId: root.getAttribute("data-notebook-id"),
    threadItemCount: current.length,
    threadItemId: current.length === 1 ? current[0].getAttribute("data-item-id") : null,
    questionCount: users.length,
    answers,
  };
}
