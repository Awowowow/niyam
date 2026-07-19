# Niyam three-minute demo runbook

The presentation has one story: software rejected a person whom the approved policy accepts. Niyam finds the disagreement, repairs the real application, stress-tests the repair, and creates signed evidence after human approval.

## Preflight

Run this before recording and again before presenting:

```bash
NIYAM_PUBLIC_URL=https://d3rre9ztdq52vx.cloudfront.net pnpm smoke:production
```

Then open the live application in a fresh Chrome window, keep light mode enabled, click **Start over**, allow microphone permission, and close unrelated tabs and notifications.

Keep `output/pdf/niyam-demo-policy.pdf` ready in Finder if you want to demonstrate page-aware PDF extraction instead of dictating the rule.

## Exact timeline

### 0:00–0:18 — State the human problem

Show the opening contradiction. Say:

> This applicant qualifies under the written scholarship policy, but the software rejected her. Nothing crashed. The code simply implemented the rule incorrectly.

Do not explain the architecture yet.

### 0:18–0:42 — Let the applicant speak

Click **Review this rejected application**, then **Use voice** under “Tell your story.” Speak the Hindi complaint or use the prepared transcript. Click **Check this decision**.

Point only to:

- policy result: eligible;
- software result: rejected;
- policy version active on the decision date.

Say:

> The model helps understand her words. It never decides eligibility. The approved executable policy does that deterministically.

### 0:42–1:10 — Give the judge control

In “Check the policy,” type or dictate an unseen change. Recommended wording:

> Applicants with annual household income up to and including INR 437,500 are eligible. Applicants must be 27 years old or younger. Applicants with disabilities receive a 4 year age relaxation.

Click **Read and identify rules with AI**. Show the source-linked rules, parameters, textual change, and any ambiguity state. Click **Approve policy interpretation**.

Say:

> AI translates the document into cited rules. A policy owner confirms the meaning before any code can change.

### 1:10–1:43 — Repair real code

Keep **Node / TypeScript** selected and click **Repair the application**.

While it runs, narrate the visible stages: safe code copy, responsible line, minimal change, generated tests, replay. When it completes, show:

- the source location;
- the real Git diff;
- `INELIGIBLE → ELIGIBLE`;
- the isolated branch and commit.

Say:

> The agent may propose code, but it cannot change the policy or the tests that judge its work.

### 1:43–2:10 — Stress-test the repair

Show the verification ledger and the adversarial review:

- existing tests passed;
- generated policy tests passed;
- 112 independently generated edge cases;
- every supported rule path covered;
- zero remaining counterexamples.

Say:

> The repair agent does not grade itself. Niyam runs repeatable checks against the repaired executable and searches separately for a case that still breaks it.

### 2:10–2:36 — Keep authority human

Click **Policy owner approval**, then **Engineer approval**, then **Create and verify evidence**.

Point to **Verified** and the Ed25519 fingerprint. Download the JSON only if time allows.

Say:

> The API itself enforces both approvals. The exported record is signed, then its signature, content hash, and public-key fingerprint are verified again. Niyam never merges automatically.

### 2:36–3:00 — Define the category

Briefly open Policy history only if it is already visible; do not start a second workflow. Close with:

> Normal CI asks whether code behaves the way developers expected. Niyam asks whether it behaves the way the approved policy requires. It finds the decision the code got wrong, repairs the system, and carries the approved rule into every future release.

## Recovery paths

- **Microphone permission fails:** type or paste the same complaint. Say that the transcript remains editable by design.
- **Live AI is slow:** keep narrating the visible stage message. Do not refresh; requests allow up to three minutes.
- **AI refuses an ambiguous rule:** this is a successful safety demonstration. Show the unresolved language, then use the prepared precise rule.
- **Repair fails:** switch Node/Python once only. If it still fails, show the last downloaded signed evidence and the production smoke output; do not fake a live result.
- **PDF contains only scanned images:** paste the policy text. Niyam deliberately reports that OCR is not enabled instead of inventing text.

## What not to say

Do not claim universal formal verification, perfect legal interpretation, guaranteed-safe patches, real population impact, autonomous deployment, or that an LLM decides eligibility.
