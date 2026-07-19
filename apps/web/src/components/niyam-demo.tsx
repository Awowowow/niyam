"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowIcon, CheckIcon, MoonIcon, NiyamMark, SunIcon } from "./icons";
import { PolicyCiWorkbench } from "./policy-ci-workbench";

type Theme = "light" | "dark";
const THEME_STORAGE_KEY = "niyam-theme-preference";

const PROOF_CHAIN = [
  {
    step: "01",
    eyebrow: "Read the rule",
    title: "Turn policy into a precise rule",
    detail:
      "Niyam reads speech, PDFs, or text and links every extracted rule to its source.",
    artifact: "Source page + document fingerprint + clarity warning",
    technical: "Source page · tamper check (SHA-256) · unclear-language stop",
    tone: "policy",
  },
  {
    step: "02",
    eyebrow: "Check the decision",
    title: "Find the person the software got wrong",
    detail:
      "The approved rule and the real application evaluate the same person side by side.",
    artifact: "The person + the correct result + the software result",
    technical: "Concrete case · expected outcome · actual outcome",
    tone: "mismatch",
  },
  {
    step: "03",
    eyebrow: "Repair the code",
    title: "Fix the code that made the decision",
    detail:
      "AI works on a safe copy of the code and proposes the smallest reviewable change.",
    artifact: "Isolated code copy + line-by-line change + added tests",
    technical:
      "AI repair · safe code copy · line-by-line change · saved commit",
    tone: "repair",
  },
  {
    step: "04",
    eyebrow: "Verify the repair",
    title: "Test the repair from every angle",
    detail:
      "Niyam reruns the original applicant, the existing tests, and new edge cases that target every rule path.",
    artifact: "112 edge cases + every policy path + remaining failures",
    technical: "112 generated cases · 4/4 rule paths · exact-limit testing",
    tone: "verify",
  },
  {
    step: "05",
    eyebrow: "Approve and record",
    title: "Create evidence that others can verify",
    detail:
      "A policy owner and an engineer approve before the repair can enter code review.",
    artifact: "Signed evidence + confirmed code review + future policy checks",
    technical:
      "Tamper-evident signature (Ed25519) · verified review package · automatic policy checks",
    tone: "evidence",
  },
] as const;

export function NiyamDemo() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initialTheme: Theme =
      storedTheme === "dark" || storedTheme === "light" ? storedTheme : "light";
    setTheme(initialTheme);
    document.documentElement.dataset.niyamTheme = initialTheme;
    document.documentElement.style.colorScheme = initialTheme;
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.dataset.niyamTheme = next;
      document.documentElement.style.colorScheme = next;
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      return next;
    });
  }, []);

  return (
    <div className="niyam-app unified-niyam" data-theme={theme}>
      <header className="site-header">
        <a className="brand-lockup" href="#top" aria-label="Niyam home">
          <span className="brand-symbol" aria-hidden="true">
            <NiyamMark />
          </span>
          <span>
            <strong>Niyam</strong>
            <small>Keeps software decisions faithful to policy</small>
          </span>
        </a>

        <p className="header-thesis">
          Policy rules should match software decisions
        </p>

        <div className="header-actions">
          <a className="judge-link judge-link-secondary" href="#how-it-works">
            How it works
          </a>
          <button
            className="theme-toggle"
            type="button"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            <span>{theme === "dark" ? "Light" : "Dark"}</span>
          </button>
          <a className="judge-link judge-link-primary" href="#citizen-case">
            Review the rejected case
          </a>
        </div>
      </header>

      <main id="top">
        <section className="unified-hero" aria-labelledby="hero-title">
          <div className="unified-hero-copy">
            <div className="case-kicker">
              <span className="live-pill">
                <i /> Worked example
              </span>
              Scholarship appeal
            </div>
            <h1 id="hero-title">
              The applicant <em>qualifies</em>
              <br />
              under the policy.
              <br />
              The software <strong>rejected her.</strong>
            </h1>
            <p>
              Niyam catches when software applies a written policy incorrectly.
              It finds the person affected, repairs the real application, and
              produces evidence people can verify before anything changes.
            </p>
            <div className="hero-actions">
              <a className="main-cta" href="#citizen-case">
                Review this rejected application <ArrowIcon />
              </a>
              <span>
                Speak or type in Hindi or English, edit the policy, then repair
                a Node or Python application.
              </span>
            </div>
            <div
              className="hero-system-ledger"
              aria-label="Niyam system capabilities"
            >
              <span>
                <code>Inputs</code>
                <strong>Voice or typed appeal · policy PDF or text</strong>
              </span>
              <span>
                <code>Software</code>
                <strong>Node · Python · web and API decision logic</strong>
              </span>
              <span>
                <code>Outputs</code>
                <strong>Code repair · edge-case tests · signed evidence</strong>
              </span>
            </div>
          </div>

          <article
            className="boundary-convergence"
            aria-label="Policy and software disagreement"
          >
            <header>
              <span>Example applicant · Scholarship application</span>
              <code>REJECTED</code>
            </header>
            <div className="boundary-stream" data-side="policy">
              <span>What the approved policy allows</span>
              <strong>Age 30 is allowed with the disability exception</strong>
              <i />
            </div>
            <div className="boundary-stream" data-side="code">
              <span>What the application currently enforces</span>
              <strong>Age limit 25; disability exception missing</strong>
              <i />
            </div>
            <div className="boundary-collision">
              <span>!</span>
              <div>
                <small>Policy and software disagree</small>
                <strong>
                  Policy says eligible · software returned rejected
                </strong>
              </div>
            </div>
            <footer>
              <span>
                Next: find the faulty line, repair it, and verify the result
              </span>
              <ArrowIcon />
            </footer>
          </article>
        </section>

        <section className="proof-chain" id="how-it-works">
          <header className="proof-chain-heading">
            <div>
              <p>How Niyam works · from rejection to verified repair</p>
              <h2>Five steps. Every decision explained and verified.</h2>
            </div>
            <p>
              AI reads policy and proposes code changes. Repeatable tests decide
              whether the repair works. People approve the meaning and the final
              change.
            </p>
          </header>

          <div className="proof-chain-track" role="list">
            {PROOF_CHAIN.map((item) => (
              <article
                key={item.step}
                role="listitem"
                className="proof-chain-stage"
                data-tone={item.tone}
              >
                <div className="proof-chain-node" aria-hidden="true">
                  <span>{item.step}</span>
                  <i />
                </div>
                <span className="proof-chain-eyebrow">{item.eyebrow}</span>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
                <div className="proof-chain-artifact">
                  <small>Evidence produced</small>
                  <strong>{item.artifact}</strong>
                  <code>{item.technical}</code>
                </div>
              </article>
            ))}
          </div>

          <footer className="proof-chain-guardrails">
            <span>
              <CheckIcon /> AI never makes the eligibility decision
            </span>
            <span>
              <CheckIcon /> Unclear policy stops until a person clarifies it
            </span>
            <span>
              <CheckIcon /> Code never merges automatically
            </span>
            <a href="#citizen-case">
              Start with the case <ArrowIcon />
            </a>
          </footer>
        </section>

        <PolicyCiWorkbench />
      </main>

      <footer className="site-footer" aria-labelledby="footer-title">
        <section className="footer-closing">
          <span className="footer-closing-mark" aria-hidden="true">
            <NiyamMark />
            <i />
          </span>
          <div>
            <p>What Niyam protects</p>
            <h2 id="footer-title">
              When policy and code disagree, the person should not carry the
              error.
            </h2>
          </div>
          <a href="#citizen-case">
            Review the rejected application <ArrowIcon />
          </a>
        </section>

        <div className="footer-proof-docket">
          <section>
            <span>01 · Understand the rule</span>
            <strong>Listen to people. Read the exact policy.</strong>
            <ul>
              <li>Hindi and English speech</li>
              <li>PDF or text with page citations</li>
              <li>Document fingerprint for tamper detection (SHA-256)</li>
              <li>Unclear wording stops for human review</li>
            </ul>
          </section>
          <section>
            <span>02 · Repair real software</span>
            <strong>Change code—not just an explanation.</strong>
            <ul>
              <li>AI repair agent on Amazon Bedrock</li>
              <li>Node and Python targets</li>
              <li>Safe code copy; the original application stays unchanged</li>
              <li>Line-by-line change, commit, and tests</li>
            </ul>
          </section>
          <section>
            <span>03 · Verify the behavior</span>
            <strong>
              Recheck the original case, then test the boundaries.
            </strong>
            <ul>
              <li>Before and after decision replay</li>
              <li>Build and regression checks</li>
              <li>112 generated edge cases</li>
              <li>Every policy path tested (4/4)</li>
            </ul>
          </section>
          <section>
            <span>04 · Keep authority human</span>
            <strong>People approve before any code can change.</strong>
            <ul>
              <li>Policy owner and engineer approvals</li>
              <li>Tamper-evident signed evidence (Ed25519)</li>
              <li>Verified code-review package only after confirmation</li>
              <li>
                Future policy/code mismatches blocked automatically before merge
              </li>
            </ul>
          </section>
        </div>

        <div className="footer-truth-rail">
          <span>
            <i aria-hidden="true" /> Product boundary
          </span>
          <strong>
            AI can interpret policy and propose repairs. People still decide
            what the policy means and whether code may change.
          </strong>
          <a href="#top">
            Back to the case <ArrowIcon />
          </a>
        </div>

        <div className="footer-meta">
          <p>
            Appeal → cited policy rules → code repair → tests → two human
            approvals
          </p>
          <code>
            Niyam · policy-to-code verification · human-approved by design
          </code>
        </div>
      </footer>
    </div>
  );
}
