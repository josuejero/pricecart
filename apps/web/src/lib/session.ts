export function getSessionId(): string {
  const k = "pricecart_session";
  const existing = localStorage.getItem(k);
  if (existing) return existing;
  const v = crypto.randomUUID();
  localStorage.setItem(k, v);
  return v;
}