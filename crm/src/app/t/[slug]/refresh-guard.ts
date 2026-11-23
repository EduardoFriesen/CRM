// The board refreshes itself every few seconds; never while a dialog (e.g. an order
// being filled) is open, since a re-render could unmount it and lose what was typed.
export const shouldAutoRefresh = (doc: Document): boolean =>
  doc.visibilityState === "visible" && !doc.querySelector("dialog[open]");
