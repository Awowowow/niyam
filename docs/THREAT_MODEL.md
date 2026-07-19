# Niyam threat model

## Protected assets

- Policy documents, citations, versions, and approval identities
- Citizen complaints and decision facts
- Source repositories and credentials
- Repair patches, test output, and evidence signatures
- GitHub and AWS authority

## Trust boundaries and controls

| Threat                                          | Control                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Prompt injection in a policy document           | Extracted text is data; deterministic grammar and human approval define the contract. Repair prompts receive only cited approved evidence. |
| Confident interpretation of vague law           | Blocking ambiguity types stop execution. Missing dates remain visible.                                                                     |
| LLM changes tests or policy to make itself pass | Isolated worktree prompt prohibits it; independent commands run after the worker; diff and logs enter evidence.                            |
| Repository or secret exfiltration               | Workspace-only sandbox, no network in the repair prompt, no secret values returned by capability endpoints.                                |
| Unreviewed consequential change                 | Policy-owner and engineer approvals are separately recorded; auto-merge is always false.                                                   |
| Evidence tampering                              | Contract/document hashes plus Ed25519 signatures; production private key is injected at runtime.                                           |
| Proof issued before review                      | The API refuses to sign evidence until policy-owner and engineer approvals exist and every verification check passes.                      |
| Forged or altered exported proof                | Exported evidence carries its signed payload and public key; portable verification checks the signature, hashes, and key fingerprint.       |
| Malformed or oversized document upload          | Uploads are limited to 5 MB, restricted to PDF or UTF-8 text, checked for PDF magic bytes, and rejected when empty or scanned-only.          |
| Public AI endpoint abuse                        | Per-session and per-client limits bound document upload, extraction, and repair requests.                                                   |
| PII leakage                                     | Public evidence export redacts local paths and approval identifiers; production must add field-level complaint retention controls.         |
| Synthetic impact presented as real              | Every impact report is labelled `synthetic-sample-not-real-population`.                                                                    |
| Overclaiming formal proof                       | Z3 output states its bounds; all other checks are labelled behavioral verification.                                                        |
| Compromised historical answer                   | Time-machine responses bind policy version, document hash, contract hash, effective dates, and code revision.                              |

## Residual risks

The supported extraction and offline repair subsets are intentionally narrow. Production authentication, durable audit storage, key rotation, malware scanning for uploaded PDFs, OCR for scanned documents, branch protection configuration, and organization-specific retention rules remain deployment responsibilities.
