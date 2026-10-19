/** Request-time clock for server components (kept out of render bodies for lint purity rules). */
export function now(): Date {
  return new Date();
}
export function nowMs(): number {
  return now().getTime();
}
