import Link from "next/link";

export function BrandMark({ size = 27 }: { size?: number }) {
  return (
    <svg
      className="brand-symbol"
      width={size}
      height={(size * 32) / 27}
      viewBox="0 0 28 34"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M7 3C10 1 18 1 21 3c4 3 6 9 6 14s-2 11-6 14c-3 2-11 2-14 0C3 28 1 22 1 17S3 6 7 3Z" />
      <path d="M3 9h22M1 16h26M3 24h22" />
    </svg>
  );
}

export function Brand() {
  return (
    <Link href="/" className="wordmark" aria-label="AdmitFlow home">
      <BrandMark />
      admitflow
    </Link>
  );
}

export function Ctas({ reverse = false }: { reverse?: boolean }) {
  const primary = (
    <Link className="tines-button tines-button-solid" href="/sign-up">
      Start free pilot
    </Link>
  );
  const secondary = (
    <Link className="tines-button tines-button-outline" href="/sign-in">
      Book a demo
    </Link>
  );
  return (
    <div className="cta-row">{reverse ? <>{secondary}{primary}</> : <>{primary}{secondary}</>}</div>
  );
}

export function Header() {
  return (
    <header className="site-header site-width">
      <Brand />
      <nav className="header-nav" aria-label="Main navigation">
        <a className="tines-nav-control" href="/#agents">Agents</a>
        <a className="tines-nav-control" href="/#how">How it works</a>
        <a className="tines-nav-control" href="/#pricing">Pricing</a>
      </nav>
      <div className="header-right">
        <Link className="tines-nav-control" href="/sign-in">Log in</Link>
        <Link className="tines-nav-control" href="/sign-up">Sign up</Link>
        <Link className="tines-button tines-button-solid" href="/sign-up">Start free pilot</Link>
      </div>
    </header>
  );
}

const FOOTER_COLS: { title: string; items: [string, string][] }[] = [
  {
    title: "Product",
    items: [
      ["Inquiry agent", "/#agents"],
      ["Counseling & nurture", "/#agents"],
      ["Counselor inbox", "/#how"],
      ["Funnel dashboard", "/#how"],
      ["Pricing", "/#pricing"],
    ],
  },
  {
    title: "Channels",
    items: [
      ["WhatsApp Business", "/#agents"],
      ["Website chat widget", "/#agents"],
      ["Lead form webhook", "/#agents"],
      ["Instagram (v1.1)", "/#agents"],
    ],
  },
  {
    title: "Company",
    items: [
      ["About", "/#why"],
      ["Contact", "/sign-up"],
      ["Book a demo", "/sign-in"],
    ],
  },
  {
    title: "Trust & security",
    items: [
      ["Data isolation", "/#why"],
      ["Audit logs", "/#why"],
      ["Consent & opt-out", "/#why"],
      ["Privacy", "/#why"],
    ],
  },
  {
    title: "Get started",
    items: [
      ["Sign up", "/sign-up"],
      ["Log in", "/sign-in"],
      ["Documentation", "/#how"],
    ],
  },
];

export function Footer() {
  return (
    <footer className="site-footer site-width">
      <Brand />
      <div className="footer-grid">
        {FOOTER_COLS.map((col) => (
          <div key={col.title}>
            <h3 className="footer-label">{col.title.toUpperCase()}</h3>
            {col.items.map(([label, href]) => (
              <Link key={label} href={href}>{label}</Link>
            ))}
          </div>
        ))}
      </div>
      <div className="footer-bottom">
        <span>© AdmitFlow 2026</span>
        <span>Built for Indian admissions teams</span>
      </div>
    </footer>
  );
}
