# Niyam hackathon submission

## Title

Niyam — Policy CI for software decisions

## One line

Find the decision the code got wrong. Repair the system. Verify the evidence.

## Short description

Niyam converts written policy into cited, human-approved executable rules, finds decisions where software disagrees with policy, repairs the responsible Node or Python code in an isolated Git branch, stress-tests the repair with independently generated cases, and exports Ed25519-signed evidence after two human approvals.

## Problem

Consequential software can run perfectly while implementing a policy incorrectly: `income < 400000` when the document says “up to and including ₹4,00,000,” or an omitted disability exception. These failures do not crash, appear in logs, or fail conventional tests. The person receives the wrong decision silently.

## What makes it different

Normal CI checks whether software behaves as developers expected. Niyam checks whether it behaves as an approved policy requires. It connects cited policy interpretation, deterministic execution, real application adapters, bounded source repair, before/after replay, independent edge-case testing, human authority, signed evidence, and a permanent merge-blocking rule in one closed loop.

## Live judge moment

A judge can type, speak, or upload an unseen income limit, age rule, and disability relaxation. Niyam extracts the exact values with source citations, stops for approval, shows a clearly labelled fictional-sample impact preview, repairs a real application, runs its old and new tests, tries 112 independent edge cases, replays the rejected applicant, and verifies the signed evidence.

## AI and authority

- OpenAI gpt-oss-120b on Amazon Bedrock extracts cited policy candidates.
- Qwen3 Coder on Amazon Bedrock proposes a bounded single-file repair.
- Deterministic code makes policy decisions and judges the repair.
- A policy owner controls meaning; an engineer controls code review.
- AI cannot merge or deploy automatically.

## Links

- Live build: https://d3rre9ztdq52vx.cloudfront.net
- Architecture: `docs/ARCHITECTURE.md`
- Threat model: `docs/THREAT_MODEL.md`
- Permanent Policy CI workflow: `.github/workflows/niyam-policy-ci.yml`

## Scope statement

Niyam verifies specific human-approved rules against observable software behavior inside declared domains. It does not claim perfect legal interpretation, universal verification of arbitrary programs, guaranteed-safe patches, or real population forecasts.
