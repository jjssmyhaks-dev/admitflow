import { landingSections } from "@/lib/landing-content";
import { Brand, Ctas, Footer, Header } from "@/components/marketing";
import { InquiryShowcase } from "@/components/inquiry-showcase";

export default function HomePage() {
  const { hero, reality, solution, teams, why } = landingSections;
  return (
    <>
      <Header />
      <main id="main-content">
        {/* Hero */}
        <section className="hero site-width">
          <div className="announcement">
            <span>NEW</span>
            <a href="#agents">
              Phase 1: Inquiry &amp; Counseling agents are live
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </a>
          </div>
          <h1>
            <span>Never miss an admission lead.</span>
            <span>Never let one go cold.</span>
          </h1>
          <p className="hero-copy">{hero.copy}</p>
          <Ctas />

          <div className="logo-strip" aria-label="Institutions">
            {["Greenfield Public School", "Surya Institute of Technology", "DPS Hyderabad", "St. Xavier’s College", "IIT Prep Academy"].map((name) => (
              <span key={name} className="logo-text">{name}</span>
            ))}
          </div>

          <div className="hero-showcase">
            <InquiryShowcase />
          </div>
        </section>

        {/* Reality */}
        <section className="section site-width">
          <p className="eyebrow">{reality.eyebrow}</p>
          <h2>
            {reality.headline}
            <br />
            <strong>{reality.headlineStrong}</strong>
          </h2>
          <div className="reality-layout">
            <div className="panel" style={{ padding: 32 }}>
              <div className="stat-grid">
                {reality.stats.map((s) => (
                  <div className="stat" key={s.label}>
                    <div className="label">{s.label}</div>
                    <div className="value">{s.value}</div>
                    <div className="delta">{s.delta}</div>
                  </div>
                ))}
              </div>
              <p style={{ fontFamily: "var(--font-serif)", fontSize: 20, lineHeight: 1.5, marginTop: 24 }}>
                {reality.caption}
              </p>
            </div>
            <div className="editorial-copy">
              {reality.paragraphs.map((p) => (
                <p key={p.slice(0, 24)}>{p}</p>
              ))}
            </div>
          </div>
        </section>

        {/* Solution band */}
        <section className="section solution-band" id="agents">
          <div className="site-width">
            <p className="eyebrow">{solution.eyebrow}</p>
            <h2 className="solution-title">
              {solution.title}
              <br />
              <strong>{solution.titleStrong}</strong>
            </h2>
            <div className="solution-grid">
              {solution.items.map((item) => (
                <article key={item.title}>
                  <div className="solution-icon" aria-hidden>
                    {item.icon}
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
            <div className="solution-bottom">
              <p>
                <strong>{solution.ctaHighlight}</strong> {solution.ctaText}
              </p>
              <a className="tines-button tines-button-solid" href="/sign-up">
                Start free pilot
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </a>
            </div>
          </div>
        </section>

        {/* Teams */}
        <section className="section site-width">
          <p className="eyebrow">{teams.eyebrow}</p>
          <div className="teams-intro">
            <h2>{teams.headline}</h2>
            <p>{teams.sub}</p>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Screen</th>
                  <th>Who</th>
                  <th>What happens</th>
                </tr>
              </thead>
              <tbody>
                {teams.rows.map((r) => (
                  <tr key={r.screen}>
                    <td style={{ fontWeight: 600 }}>{r.screen}</td>
                    <td>{r.who}</td>
                    <td>{r.what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Why */}
        <section className="section why-band">
          <div className="site-width">
            <p className="eyebrow">{why.eyebrow}</p>
            <div className="why-heading">
              <h2>
                {why.headline}
                <br />
                <strong>{why.headlineStrong}</strong>
              </h2>
              <p>{why.sub}</p>
            </div>
            <div className="why-grid">
              {why.items.map((item) => (
                <article key={item.bold}>
                  <div
                    aria-hidden
                    style={{
                      height: 120,
                      borderRadius: 10,
                      border: "1px solid var(--border)",
                      background:
                        "linear-gradient(135deg, var(--accent), var(--secondary) 60%, var(--soft-purple))",
                      marginBottom: 25,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 34,
                    }}
                  >
                    {item.glyph}
                  </div>
                  <h3>
                    <strong>{item.bold}</strong> {item.text}
                  </h3>
                </article>
              ))}
            </div>
            <div className="closing-cta">
              <p>{why.cta}</p>
              <Ctas reverse />
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
