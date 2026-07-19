# Niyam three-minute demo runbook

Niyam is an AI-assisted, human-gated workflow that finds when decision software disagrees with an approved written policy, proposes a repair, tests that repair, and creates signed evidence. The worked scholarship rejection is the example; Niyam is the product.

## Fixed roles

- **Person 1 — laptop driver:** controls Chrome, clicks, scrolls, and keeps the next result visible. They say nothing during the recording.
- **Person 2 — speaker and timekeeper:** delivers every spoken line and watches the timer. They never touch the laptop.
- Rehearse the sequence until the driver can move from the speaker's final word in each row. Never discuss the next click on camera.

## Preflight

Run this before recording and again before presenting:

```bash
NIYAM_PUBLIC_URL=https://d3rre9ztdq52vx.cloudfront.net pnpm smoke:production
```

Then:

1. Open the production site in a normal Chrome window at 100% zoom and use light mode.
2. Click **Start over**, close unrelated tabs, silence notifications, and keep the cursor away from important text.
3. Confirm the status says that live AI is connected and `policy-v3` is active.
4. Keep the most recent verified evidence JSON and the reliability slide open in background tabs for the failure fallback only.
5. Start the recording with the hero and rejected application card both visible.

## Exact two-person script

### 0:00–0:22 — The silent failure

**Driver:** Hold on the hero for two seconds. Slowly reveal the rejected application card. Do not click yet.

**Speaker:**

> This is Niyam. It catches software that silently breaks the written rules it is supposed to follow. In this worked example, the approved scholarship policy accepts this applicant, but the deployed application rejects her. Nothing crashed. One valid person was simply denied.

### 0:22–0:48 — Check the original decision

**Driver:** Click **Review this rejected application**. Keep the prefilled complaint, date, **Use voice**, and **Check this decision** visible. Click **Check this decision**, then place the cursor beside the green **ELIGIBLE** and red **INELIGIBLE** results. Pause on the `policy-v3` receipt.

**Speaker:**

> She can speak or type what happened in Hindi or English. Niyam extracts the facts, finds the policy version active on her decision date, and replays both decisions. The approved rule says eligible. Production said ineligible. AI helps understand her words; it never decides eligibility.

### 0:48–1:18 — Confirm the governing rules

**Driver:** Scroll to **Confirm the governing rules**. Pause on **Already registered by the organisation** and the `policy-v3` date. Click **Extract rules from policy-v3 with AI**. When the source-linked rules appear, show the income, age, and disability exception. Click **Approve these rules**.

**Speaker:**

> The applicant does not upload her organisation's policy. Niyam already selected policy-v3 from policy history. AI turns its exact sentences into cited, testable rules. If wording is unclear, Niyam stops instead of guessing. A policy owner must confirm the meaning before any code can change.

### 1:18–1:55 — Repair the application code

**Driver:** Keep **Node / TypeScript** selected. Click **Repair the code with live AI**. While it runs, leave the animated status visible. On completion, show **Faulty line found here**, the code diff, then **Before the repair: INELIGIBLE → After the repair: ELIGIBLE**.

**Speaker:**

> Now the repair agent works on an isolated copy of the real eligibility code. It finds the faulty line, proposes the smallest reviewable change, and generates tests from the approved rules. The agent cannot rewrite the policy, weaken the tests, or merge its own code. Here, the same application changes from ineligible to eligible.

### 1:55–2:20 — Try to break the repair

**Driver:** Scroll just enough to center **Stage 4 · Verify the repair** and **Independent edge-case search**. Trace the three numbers: `112`, `4/4`, and `0`.

**Speaker:**

> Fixing one example is not enough. Niyam reruns the existing application tests, generates policy tests, then independently searches the boundaries and rule interactions for another failure. One hundred and twelve edge cases, every supported rule path covered, zero counterexamples found.

### 2:20–2:45 — Keep authority human

**Driver:** Click **Policy owner approval**, **Engineer approval**, and **Create and verify evidence**. Pause on **Signature and evidence contents verified**. Briefly point to **Download verification report (PDF)** and **Download signed data (JSON)**; do not open either file during the main take.

**Speaker:**

> Two separate people still approve the repair: the policy owner for meaning, and the engineer for code. Only then does Niyam sign the evidence and verify its signature and contents. Judges can read the PDF; machines can verify the signed JSON. Nothing merges automatically.

### 2:45–3:00 — Define the category and stop

**Driver:** Hold on the verified evidence. Make no more clicks.

**Speaker:**

> Normal CI asks whether code matches developer expectations. Niyam asks whether software decisions match the rules people were promised. Before software says no, it should prove why.

Stop immediately. Do not add a thank-you or feature list after the closing line.

## Exact failure fallback

If the live repair call retries or fails, the driver waits for the visible retry. If the verified replay appears, they continue normally. If the call still cannot complete, the driver opens the preloaded verified evidence tab while the speaker says exactly:

> The live call paused, so we are switching to our last verified replay. The same code change, 112 tests, human approvals, and signature checks still apply. Nothing can merge automatically.

Do not apologize, refresh repeatedly, explain AWS, or attempt a third call.

## Other recovery paths

- **Microphone permission fails:** keep the prepared complaint and continue. The core proof does not depend on voice input.
- **AI refuses unclear wording:** show the clarification message. This is the intended safety gate, then reset to the prepared policy.
- **PDF is scanned and has no extractable text:** use the stored policy. Niyam reports missing text instead of inventing it.
- **A click is missed:** the speaker pauses at the end of the current sentence; the driver catches up silently.

## Claims to avoid

Do not call the worked example a real applicant. Do not claim universal legal interpretation, universal policy support, perfect formal verification, real population impact, autonomous deployment, automatic GitHub merge, or that an LLM decides eligibility.
