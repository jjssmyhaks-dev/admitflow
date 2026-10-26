// Deterministic date formatting. toLocaleString() differs between Node's ICU
// and the browser, which causes React hydration mismatches (#418) whenever a
// date is rendered during SSR — so everything goes through this pure formatter.

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function parts(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return {
    day: d.getDate(),
    month: MONTHS[d.getMonth()],
    year: d.getFullYear(),
    hour: d.getHours() % 12 || 12,
    minute: String(d.getMinutes()).padStart(2, "0"),
    ampm: d.getHours() < 12 ? "AM" : "PM",
  };
}

/** "7 Oct 2026, 1:19 AM" */
export function fmtDateTime(iso: string): string {
  const p = parts(iso);
  if (!p) return "—";
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${p.ampm}`;
}

/** "7 Oct 2026" */
export function fmtDate(iso: string): string {
  const p = parts(iso);
  if (!p) return "—";
  return `${p.day} ${p.month} ${p.year}`;
}

/** "just now" | "5m ago" | "3h ago" | "2d ago" */
export function fmtRelative(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(iso);
}
