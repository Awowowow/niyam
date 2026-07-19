# Niyam judge Q&A

## Is this just an LLM comparing a PDF with code?

No. The model extracts a cited candidate interpretation. A policy owner approves it, and Niyam compiles the supported rule into deterministic logic. That contract—not a model call—produces expected outcomes. The repaired executable is then tested independently.

## How do you know the extraction is correct?

Every rule carries the exact source sentence, page, document hash, extraction mode, and model receipt. Blocking ambiguity prevents approval. The defensible claim is not that AI understands every policy perfectly; it is that Niyam makes the interpretation inspectable and requires authority to approve it.

## Is the patch prewritten?

The public application sends the approved parameters and responsible source file to a Bedrock code-repair model. It validates the returned source file, rejects changes outside the supported target, creates a real isolated Git branch, commits the diff, and runs the application. The local fallback is clearly labelled and disabled in the public application.

## Can the repair agent modify the tests until they pass?

No. Niyam generates policy tests outside the agent, preserves the original regression tests, limits the repair to the responsible source file, and runs verification after the agent finishes. The independent reviewer then generates additional inputs against the repaired executable.

## Is 112 cases a formal proof?

No. It is bounded behavioral verification across the declared scholarship domain and all supported rule paths. Z3 is used for concrete bounded counterexample search. The interface and evidence bundle explicitly avoid a universal-proof claim.

## What makes the evidence tamper-evident?

The canonical payload contains the approved contract and document hashes, source trace, real diff and commit, command results, before/after replay, independent review, approvals, and authority boundaries. Production signs it with a stable Ed25519 key from AWS Secrets Manager. Niyam then verifies the signature, content hash, and public-key fingerprint. Changing any signed field makes verification fail.

## Can someone bypass the two approvals by calling the API?

No. The UI gate is backed by server enforcement. Evidence signing and pull-request publishing both reject requests until a policy owner and an engineer have independently approved the verified repair.

## Does it touch production?

No. Repair happens in an isolated temporary Git repository and branch. The public demo exports the verified patch after two approvals without requesting repository credentials. A privately connected deployment can publish a pull request, but automatic merge and production deployment do not exist.

## What happens to unclear or scanned policies?

Undefined or discretionary terms, conflicts, missing units or dates, unclear exception priority, translation drift, and unsupported rules stop for human clarification. A scanned PDF with no selectable text produces an explicit OCR-not-enabled error instead of empty or invented evidence.

## Is the population-impact number real?

No. The interface clearly labels it as fictional sample data. It demonstrates behavioral gains and losses on a disclosed example set, not a forecast of real people.

## Where does OpenAI fit?

The public AWS application uses OpenAI gpt-oss-120b on Amazon Bedrock for cited policy interpretation. Qwen3 Coder proposes source repairs. Each model has a visible, limited role; deterministic rules, tests, approvals, and signed evidence remain authoritative.

## What would production adoption add?

Organization authentication, durable policy and evidence storage, repository-specific sandboxes, malware scanning and OCR, approval identity federation, key rotation, retention rules, and branch-protection configuration. The hackathon build deliberately exposes these boundaries rather than claiming they already exist.
