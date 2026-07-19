"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  approvePolicyDraft,
  approveRepositoryRepair,
  createPolicyDraft,
  getNiyamCapabilities,
  getPolicyCiWorkspace,
  getSignedRepairEvidence,
  ingestPolicyDocument,
  publishRepairPullRequest,
  queryTimeMachine,
  reconstructComplaint,
  resetJudgeWorkspace,
  rollbackPolicyVersion,
  runRepositoryRepair,
  verifySignedRepairEvidence,
  type ComplaintResult,
  type DraftApprovalResult,
  type EvidenceVerification,
  type NiyamCapabilities,
  type PolicyCiWorkspace,
  type PolicyDocumentResult,
  type PolicyDraft,
  type PolicyLanguage,
  type RepairResult,
  type SignedEvidence,
  type TimeMachineDecision,
} from "../lib/policy-ci-api";
import { ArrowIcon, CheckIcon, DocumentIcon, LockIcon, MicIcon } from "./icons";

interface RecognitionResult {
  0?: { transcript: string };
  isFinal: boolean;
}

interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}

interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionConstructor = new () => Recognition;
type DictationTarget = "policy" | "complaint";
type RuntimeLoadState = "loading" | "ready" | "unavailable";
type RepairCallState = "idle" | "retrying" | "failed";

const ENGLISH_POLICY =
  "Applicants with annual household income up to and including INR 437,500 are eligible. Applicants must be 27 years old or younger. Applicants with disabilities receive a 4 year age relaxation.";
const HINDI_POLICY =
  "₹ 437,500 तक वार्षिक आय वाले आवेदक पात्र हैं। आवेदक की आयु 27 वर्ष या कम होनी चाहिए। दिव्यांग आवेदकों को आयु में 4 वर्ष की छूट मिलेगी।";
const HINDI_COMPLAINT =
  "मेरी आय ₹ 300,000 है, मेरी आयु 30 वर्ष है और मैं दिव्यांग हूँ, लेकिन आवेदन अस्वीकार हुआ।";
const JUDGE_SESSION_KEY = "niyam-judge-session-v3";

function compactHash(value?: string): string {
  if (!value) return "—";
  return `${value.slice(0, 15)}…${value.slice(-8)}`;
}

function formatIncome(value: number): string {
  return `₹${new Intl.NumberFormat("en-IN").format(value)}`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("The selected file could not be read"));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      resolve(dataUrl.split(",")[1] ?? "");
    };
    reader.readAsDataURL(file);
  });
}

function downloadText(
  filename: string,
  mimeType: string,
  content: string,
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ListeningBloom({
  language,
  transcript,
  target,
  onStop,
}: {
  language: PolicyLanguage;
  transcript: string;
  target: DictationTarget;
  onStop: () => void;
}) {
  return (
    <section className="listening-bloom" aria-live="polite" aria-atomic="false">
      <div className="listening-bloom-visual" aria-hidden="true">
        <span className="bloom-petal bloom-petal-one" />
        <span className="bloom-petal bloom-petal-two" />
        <span className="bloom-petal bloom-petal-three" />
        <span className="bloom-mic">
          <MicIcon />
        </span>
      </div>
      <div className="listening-bloom-copy">
        <span className="listening-kicker">
          <i /> Listening in {language === "hi" ? "Hindi" : "English"}
        </span>
        <strong>
          {target === "complaint" ? "Tell your story" : "Say the policy change"}
        </strong>
        <p>
          {transcript || "Start speaking—your words will appear here live."}
        </p>
        <div className="voice-wave" aria-hidden="true">
          {Array.from({ length: 7 }, (_, index) => (
            <i key={index} style={{ animationDelay: `${index * -0.09}s` }} />
          ))}
        </div>
      </div>
      <button type="button" onClick={onStop}>
        Stop listening
      </button>
    </section>
  );
}

export function PolicyCiWorkbench() {
  const [workspace, setWorkspace] = useState<PolicyCiWorkspace | null>(null);
  const [capabilities, setCapabilities] = useState<NiyamCapabilities | null>(
    null,
  );
  const [documentResult, setDocumentResult] =
    useState<PolicyDocumentResult | null>(null);
  const [policyLanguage, setPolicyLanguage] = useState<PolicyLanguage>("en");
  const [policyText, setPolicyText] = useState(ENGLISH_POLICY);
  const [effectiveFrom, setEffectiveFrom] = useState("2026-08-01");
  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  const [approval, setApproval] = useState<DraftApprovalResult | null>(null);
  const [repairTarget, setRepairTarget] = useState<"node" | "python">("node");
  const [repair, setRepair] = useState<RepairResult | null>(null);
  const [evidence, setEvidence] = useState<SignedEvidence | null>(null);
  const [evidenceVerification, setEvidenceVerification] =
    useState<EvidenceVerification | null>(null);
  const [complaintLanguage, setComplaintLanguage] =
    useState<PolicyLanguage>("hi");
  const [complaint, setComplaint] = useState(HINDI_COMPLAINT);
  const [complaintResult, setComplaintResult] =
    useState<ComplaintResult | null>(null);
  const [decisionDate, setDecisionDate] = useState("2026-07-18");
  const [historyDate, setHistoryDate] = useState("2026-03-18");
  const [historyResult, setHistoryResult] =
    useState<TimeMachineDecision | null>(null);
  const [transcript, setTranscript] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [listeningTarget, setListeningTarget] =
    useState<DictationTarget | null>(null);
  const [transcriptTarget, setTranscriptTarget] =
    useState<DictationTarget | null>(null);
  const [highContrast, setHighContrast] = useState(false);
  const [repository, setRepository] = useState("");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [runtimeLoadState, setRuntimeLoadState] =
    useState<RuntimeLoadState>("loading");
  const [repairCallState, setRepairCallState] =
    useState<RepairCallState>("idle");
  const [status, setStatus] = useState(
    "Checking the live AI connection, policy history, and evidence signature.",
  );
  const recognitionRef = useRef<Recognition | null>(null);
  const recognitionFailedRef = useRef(false);
  const speechHeardRef = useRef(false);
  const sessionHydratedRef = useRef(false);
  const evidenceRef = useRef<SignedEvidence | null>(null);
  const workspaceLoadAttemptRef = useRef(0);

  const loadWorkspace = useCallback(() => {
    const loadAttempt = workspaceLoadAttemptRef.current + 1;
    workspaceLoadAttemptRef.current = loadAttempt;
    setRuntimeLoadState("loading");
    Promise.all([getPolicyCiWorkspace(), getNiyamCapabilities()])
      .then(([workspaceResult, capabilityResult]) => {
        if (loadAttempt !== workspaceLoadAttemptRef.current) return;
        setWorkspace(workspaceResult);
        setCapabilities(capabilityResult);
        setRuntimeLoadState("ready");
        if (!evidenceRef.current) {
          setStatus(
            capabilityResult.status === "live-ai-configured"
              ? "AI is connected. Tests and human approvals are still required before any code review."
              : capabilityResult.status === "judge-mode-blocked"
                ? "AI policy reading and code repair are unavailable until Amazon Bedrock is connected."
                : "Verified replay mode is ready. Deterministic checks and human approvals remain required before code review.",
          );
        }
      })
      .catch((error: Error) => {
        if (loadAttempt !== workspaceLoadAttemptRef.current) return;
        setRuntimeLoadState("unavailable");
        setStatus(
          `${error.message} Safety gates remain active; use Start over to retry the status check.`,
        );
      });
  }, []);

  useEffect(loadWorkspace, [loadWorkspace]);
  useEffect(() => {
    evidenceRef.current = evidence;
    if (evidence && evidenceVerification?.valid) {
      setStatus(
        `Evidence verified: the signature, contents, and signing key all match. Nothing was merged automatically.`,
      );
    }
  }, [evidence, evidenceVerification]);
  useEffect(() => {
    const saved = window.sessionStorage.getItem(JUDGE_SESSION_KEY);
    if (saved) {
      try {
        const session = JSON.parse(saved) as {
          policyLanguage?: PolicyLanguage;
          policyText?: string;
          effectiveFrom?: string;
          draft?: PolicyDraft;
          approval?: DraftApprovalResult;
          repairTarget?: "node" | "python";
          repair?: RepairResult;
          evidence?: SignedEvidence;
          evidenceVerification?: EvidenceVerification;
          complaintLanguage?: PolicyLanguage;
          complaint?: string;
          complaintResult?: ComplaintResult;
          decisionDate?: string;
        };
        if (session.policyLanguage) setPolicyLanguage(session.policyLanguage);
        if (session.policyText) setPolicyText(session.policyText);
        if (session.effectiveFrom) setEffectiveFrom(session.effectiveFrom);
        if (session.draft) setDraft(session.draft);
        if (session.approval) setApproval(session.approval);
        if (session.repairTarget) setRepairTarget(session.repairTarget);
        if (session.repair) setRepair(session.repair);
        if (session.evidence) setEvidence(session.evidence);
        if (session.evidenceVerification)
          setEvidenceVerification(session.evidenceVerification);
        if (session.complaintLanguage)
          setComplaintLanguage(session.complaintLanguage);
        if (session.complaint) setComplaint(session.complaint);
        if (session.complaintResult)
          setComplaintResult(session.complaintResult);
        if (session.decisionDate) setDecisionDate(session.decisionDate);
      } catch {
        window.sessionStorage.removeItem(JUDGE_SESSION_KEY);
      }
    }
    sessionHydratedRef.current = true;
  }, []);
  useEffect(() => {
    if (!sessionHydratedRef.current) return;
    window.sessionStorage.setItem(
      JUDGE_SESSION_KEY,
      JSON.stringify({
        policyLanguage,
        policyText,
        effectiveFrom,
        draft,
        approval,
        repairTarget,
        repair,
        evidence,
        evidenceVerification,
        complaintLanguage,
        complaint,
        complaintResult,
        decisionDate,
      }),
    );
  }, [
    approval,
    complaint,
    complaintLanguage,
    complaintResult,
    decisionDate,
    draft,
    effectiveFrom,
    evidence,
    evidenceVerification,
    policyLanguage,
    policyText,
    repair,
    repairTarget,
  ]);
  useEffect(() => {
    document.documentElement.dataset.niyamContrast = highContrast
      ? "high"
      : "standard";
    document.documentElement.style.colorScheme = highContrast
      ? "light"
      : document.documentElement.dataset.niyamTheme === "dark"
        ? "dark"
        : "light";
    return () => {
      delete document.documentElement.dataset.niyamContrast;
      document.documentElement.style.colorScheme =
        document.documentElement.dataset.niyamTheme === "dark"
          ? "dark"
          : "light";
    };
  }, [highContrast]);
  useEffect(
    () => () => {
      recognitionRef.current?.stop();
    },
    [],
  );

  const activeVersion = workspace?.activeVersion;
  const blockingIssues = useMemo(
    () =>
      draft?.ambiguities.filter((issue) => issue.severity === "blocking") ?? [],
    [draft],
  );
  const approvalRoles = new Set(repair?.approvals.map((item) => item.role));
  const repairVerified = Boolean(
    repair &&
    repair.verification.every((check) => check.passed) &&
    repair.adversarialReview.status === "passed",
  );
  const journeySteps = [
    {
      id: "citizen-case",
      title: "Tell your story",
      description: "Speak or type what happened.",
      complete: Boolean(complaintResult),
    },
    {
      id: "policy-change",
      title: "Check the policy",
      description: "Review the exact rule and approve its meaning.",
      complete: draft?.status === "approved",
    },
    {
      id: "repair-code",
      title: "Repair the code",
      description: "Let AI propose a small, reviewable code change.",
      complete: Boolean(repair),
    },
    {
      id: "verify-repair",
      title: "Verify the repair",
      description: "Rerun the rejected application and test edge cases.",
      complete: repairVerified,
    },
    {
      id: "proof-bundle",
      title: "Approve and sign evidence",
      description: "Require two people to approve before signing the record.",
      complete: Boolean(evidence),
    },
  ];
  const completedJourneySteps = journeySteps.filter(
    (step) => step.complete,
  ).length;
  const activeJourneyIndex = evidence
    ? 4
    : repairVerified
      ? 4
      : repair
        ? 3
        : draft?.status === "approved"
          ? 2
          : complaintResult
            ? 1
            : 0;
  const nextAction = !complaintResult
    ? {
        target: "citizen-case",
        kicker: "Start here",
        title: "Tell Niyam what happened",
        detail:
          "The example case is ready. Edit it, enter a new case, or speak naturally.",
        label: "Start the review",
      }
    : !draft
      ? {
          target: "policy-change",
          kicker: "Story understood",
          title: "Now check the written policy",
          detail: "Upload it, edit the sample, or say a new rule aloud.",
          label: "Check the policy",
        }
      : draft.status !== "approved"
        ? {
            target: "policy-approval",
            kicker:
              draft.status === "needs-clarification"
                ? "Human clarification needed"
                : "One human gate",
            title:
              draft.status === "needs-clarification"
                ? "Resolve the highlighted policy language"
                : "Approve the policy interpretation",
            detail:
              draft.status === "needs-clarification"
                ? "Niyam will not guess when the rule is unclear."
                : "Confirm the cited interpretation before code can change.",
            label:
              draft.status === "needs-clarification"
                ? "Review the issues"
                : "Review and approve",
          }
        : !repair
          ? {
              target: "repair-code",
              kicker: "Policy approved",
              title: "Repair the application code",
              detail:
                "Choose Node or Python. Niyam changes a safe copy and runs the checks.",
              label: "Repair the code",
            }
          : !repairVerified
            ? {
                target: "verify-repair",
                kicker: "Repair proposed",
                title: "Verify the application behavior",
                detail:
                  "Rerun the rejected application, run old and new tests, and search for edge-case failures.",
                label: "Review the test results",
              }
            : approvalRoles.size < 2
              ? {
                  target: "proof-bundle",
                  kicker: "Repair verified",
                  title: "Add the two human approvals",
                  detail: "The policy owner and engineer must both sign off.",
                  label: "Review approvals",
                }
              : !evidence
                ? {
                    target: "proof-bundle",
                    kicker: "Approvals complete",
                    title: "Create signed, tamper-evident evidence",
                    detail:
                      "Package the policy, person, code change, tests, and approvals.",
                    label: "Create signed evidence",
                  }
                : {
                    target: "proof-bundle",
                    kicker: "Journey complete",
                    title: "The verified repair evidence is ready",
                    detail:
                      "Download the signed evidence or open the approved code review.",
                    label: "Review the evidence",
                  };

  const goToStep = (target: string) => {
    document.getElementById(target)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  };

  const switchPolicyLanguage = (language: PolicyLanguage) => {
    setPolicyLanguage(language);
    setPolicyText(language === "hi" ? HINDI_POLICY : ENGLISH_POLICY);
    setDraft(null);
    setApproval(null);
    setRepair(null);
    setEvidence(null);
    setEvidenceVerification(null);
  };

  const stopDictation = () => {
    recognitionRef.current?.stop();
  };

  const startDictation = (
    target: DictationTarget,
    language: PolicyLanguage,
  ) => {
    const browserWindow = window as typeof window & {
      SpeechRecognition?: RecognitionConstructor;
      webkitSpeechRecognition?: RecognitionConstructor;
    };
    const Constructor =
      browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Constructor) {
      setStatus(
        "Speech-to-text is not available in this browser. Text editing remains available.",
      );
      return;
    }
    recognitionRef.current?.stop();
    const recognition = new Constructor();
    recognition.lang = language === "hi" ? "hi-IN" : "en-IN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognitionFailedRef.current = false;
    speechHeardRef.current = false;
    setListeningTarget(target);
    setTranscriptTarget(target);
    setLiveTranscript("");
    setTranscript("");
    if (target === "policy") {
      setPolicyText("");
      setDocumentResult(null);
      setDraft(null);
      setApproval(null);
      setRepair(null);
      setRepairCallState("idle");
      setEvidence(null);
      setEvidenceVerification(null);
    } else {
      setComplaint("");
      setComplaintResult(null);
    }
    recognition.onresult = (event) => {
      let spoken = "";
      for (let index = 0; index < event.results.length; index += 1) {
        spoken += `${event.results[index]?.[0]?.transcript ?? ""} `;
      }
      spoken = spoken.trim();
      if (!spoken) return;
      speechHeardRef.current = true;
      setLiveTranscript(spoken);
      setTranscript(spoken);
      if (target === "policy") setPolicyText(spoken);
      else setComplaint(spoken);
      setStatus(
        `Listening in ${language === "hi" ? "Hindi" : "English"}—your words are appearing live.`,
      );
    };
    recognition.onerror = () => {
      recognitionFailedRef.current = true;
      setStatus("Speech recognition stopped. Nothing was submitted.");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListeningTarget(null);
      if (!recognitionFailedRef.current) {
        setStatus(
          speechHeardRef.current
            ? "Voice captured. Read the transcript, edit anything, then continue."
            : "Listening ended before any words were captured. You can try again or type instead.",
        );
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setStatus(
        "Listening now—your words will appear in the field as you speak.",
      );
    } catch {
      recognitionRef.current = null;
      setListeningTarget(null);
      setStatus("Voice input could not start. You can continue by typing.");
    }
  };

  const uploadDocument = async (file?: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setStatus("Policy documents must be 5 MB or smaller.");
      return;
    }
    const filename = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || filename.endsWith(".pdf");
    const isText = file.type === "text/plain" || filename.endsWith(".txt");
    if (!isPdf && !isText) {
      setStatus("Choose a PDF or plain-text policy document.");
      return;
    }
    setBusy("document");
    setStatus(`Extracting cited text from ${file.name}…`);
    try {
      const mimeType = isPdf ? "application/pdf" : "text/plain";
      const result = await ingestPolicyDocument({
        filename: file.name,
        mimeType,
        language: policyLanguage,
        contentBase64: await fileToBase64(file),
      });
      setDocumentResult(result);
      setDraft(null);
      setApproval(null);
      setRepair(null);
      setEvidence(null);
      setEvidenceVerification(null);
      setStatus(
        `${result.pages.length} source ${result.pages.length === 1 ? "page" : "pages"} saved with citations and a document fingerprint.`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Document extraction failed",
      );
    } finally {
      setBusy(null);
    }
  };

  const analyzePolicy = async () => {
    setBusy("draft");
    setStatus(
      capabilities?.status === "live-ai-configured"
        ? "AI is linking each rule to its source and flagging unclear language…"
        : "Reading the supported rules and flagging unclear language…",
    );
    try {
      const result = await createPolicyDraft({
        ...(documentResult
          ? { documentId: documentResult.id }
          : { policyText }),
        language: policyLanguage,
        effectiveFrom,
      });
      setDraft(result);
      setApproval(null);
      setRepair(null);
      setEvidence(null);
      setEvidenceVerification(null);
      setStatus(
        result.status === "needs-clarification"
          ? `Stopped safely: ${result.ambiguities.length} unclear policy issues require a person.`
          : result.compilation?.extraction?.mode !==
              "deterministic-supported-grammar"
            ? "AI linked the rules to their source. A policy owner must now confirm the meaning."
            : "The supported rules are ready for a policy owner to confirm.",
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Policy analysis failed",
      );
    } finally {
      setBusy(null);
    }
  };

  const approveDraft = async () => {
    if (!draft) return;
    setBusy("approval");
    setStatus(
      "Recording who approved the rule, what it means, and when it starts…",
    );
    try {
      const result = await approvePolicyDraft(draft.id);
      setApproval(result);
      setDraft(result.draft);
      setStatus(
        `${result.version.id} approved. The impact preview uses example people, not a real population count.`,
      );
      loadWorkspace();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Approval failed");
    } finally {
      setBusy(null);
    }
  };

  const createRepair = async () => {
    if (!draft) return;
    setBusy("repair");
    setRepairCallState("idle");
    setStatus(
      capabilities?.repositoryRepair.enabled
        ? `Live AI is inspecting a safe copy of the ${repairTarget} application and proposing a repair…`
        : `Replaying a verified deterministic repair on an isolated copy of the ${repairTarget} application…`,
    );
    try {
      let result: RepairResult | null = null;
      let lastError: unknown;
      const attempts = capabilities?.repositoryRepair.enabled ? 2 : 1;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          result = await runRepositoryRepair(draft.id, repairTarget);
          break;
        } catch (error) {
          lastError = error;
          if (attempt < attempts) {
            setRepairCallState("retrying");
            setStatus(
              "The first live AI repair attempt did not complete. Retrying once with the same approved policy and safety gates…",
            );
            await new Promise((resolve) => window.setTimeout(resolve, 400));
          }
        }
      }
      if (!result) throw lastError;
      setRepair(result);
      setRepairCallState("idle");
      setEvidence(null);
      setEvidenceVerification(null);
      setStatus(
        `The code change was saved on ${result.branch}. The applicant’s result changed from ${result.originalReplay.outcomeCode} to ${result.repairedReplay.outcomeCode}.`,
      );
    } catch (error) {
      setRepairCallState("failed");
      setStatus(
        error instanceof Error
          ? `${error.message} No code was changed or merged. Retry when ready.`
          : "The repair did not complete. No code was changed or merged. Retry when ready.",
      );
    } finally {
      setBusy(null);
    }
  };

  const approveRepair = async (role: "policy-owner" | "engineer") => {
    if (!repair) return;
    setBusy(role);
    try {
      const result = await approveRepositoryRepair(repair.runId, role);
      setRepair(result);
      setStatus(
        `${role === "engineer" ? "Engineer" : "Policy owner"} approval recorded.`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Repair approval failed",
      );
    } finally {
      setBusy(null);
    }
  };

  const signEvidence = async () => {
    if (!repair) return;
    setBusy("evidence");
    try {
      const result = await getSignedRepairEvidence(repair.runId);
      const verification = await verifySignedRepairEvidence(result);
      if (!verification.valid) {
        throw new Error(
          "The signed evidence did not pass independent verification",
        );
      }
      setEvidence(result);
      setEvidenceVerification(verification);
      setStatus(
        "Evidence verified: the signature, contents, and signing key all match. Nothing was merged automatically.",
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Evidence signing failed",
      );
    } finally {
      setBusy(null);
    }
  };

  const publishPullRequest = async () => {
    if (!repair || !confirmPublish || !repository) return;
    setBusy("publish");
    setStatus(`Opening ${repair.branch} for code review in ${repository}…`);
    try {
      const result = await publishRepairPullRequest(repair.runId, repository);
      setRepair(result);
      setStatus(`GitHub code review opened: ${result.pullRequest.url}`);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Pull request publishing failed",
      );
    } finally {
      setBusy(null);
    }
  };

  const runTimeMachine = async () => {
    setBusy("history");
    try {
      const result = await queryTimeMachine({
        decisionDate: historyDate,
        applicant: {
          annualHouseholdIncome: 250_000,
          age: 25,
          hasDisability: false,
        },
      });
      setHistoryResult(result);
      setStatus(
        `${result.governingPolicy.id} was the policy active on ${historyDate}.`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Historical query failed",
      );
    } finally {
      setBusy(null);
    }
  };

  const analyzeComplaint = async () => {
    setBusy("complaint");
    try {
      const result = await reconstructComplaint({
        complaint,
        language: complaintLanguage,
        decisionDate,
        transcript: transcript || complaint,
      });
      setComplaintResult(result);
      setStatus(
        result.disagreement
          ? "Niyam found where the written policy and software disagree. The evidence was added to the appeal."
          : "The active policy and software return the same result for these facts.",
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Complaint reconstruction failed",
      );
    } finally {
      setBusy(null);
    }
  };

  const readExplanation = () => {
    if (!complaintResult || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(complaintResult.explanation);
    utterance.lang = complaintResult.language === "hi" ? "hi-IN" : "en-IN";
    window.speechSynthesis.speak(utterance);
  };

  const rollback = async (versionId: string) => {
    setBusy(`rollback-${versionId}`);
    try {
      await rollbackPolicyVersion(versionId);
      setStatus(
        `${versionId} was restored in policy history. Any matching code change still requires an engineer.`,
      );
      loadWorkspace();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Rollback failed");
    } finally {
      setBusy(null);
    }
  };

  const resetDemo = async () => {
    setBusy("reset");
    recognitionRef.current?.stop();
    try {
      const result = await resetJudgeWorkspace();
      window.sessionStorage.removeItem(JUDGE_SESSION_KEY);
      setDocumentResult(null);
      setPolicyLanguage("en");
      setPolicyText(ENGLISH_POLICY);
      setEffectiveFrom("2026-08-01");
      setDraft(null);
      setApproval(null);
      setRepairTarget("node");
      setRepair(null);
      setRepairCallState("idle");
      setEvidence(null);
      setEvidenceVerification(null);
      setComplaintLanguage("hi");
      setComplaint(HINDI_COMPLAINT);
      setComplaintResult(null);
      setDecisionDate("2026-07-18");
      setTranscript("");
      setLiveTranscript("");
      setTranscriptTarget(null);
      setRepository("");
      setConfirmPublish(false);
      setStatus(result.message);
      loadWorkspace();
      window.scrollTo({
        top: document.getElementById("citizen-case")?.offsetTop ?? 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Reset failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      className="policy-ci-workbench"
      id="policy-ci"
      aria-labelledby="policy-ci-title"
    >
      <header className="policy-ci-heading">
        <div>
          <p className="eyebrow">Interactive example · Scholarship appeal</p>
          <h2 id="policy-ci-title">Trace the rejection. Verify the repair.</h2>
        </div>
        <p>
          Follow one rejected application through the policy that should apply,
          the faulty decision logic, the repaired code, and the final signed
          evidence.
        </p>
        <div className="workbench-controls">
          <span
            className="ai-runtime-pill"
            data-status={
              runtimeLoadState === "unavailable"
                ? "unavailable"
                : (capabilities?.status ?? "loading")
            }
          >
            <i />
            {runtimeLoadState === "loading"
              ? "Checking AI connection"
              : runtimeLoadState === "unavailable"
                ? "Runtime status unavailable"
                : capabilities?.status === "live-ai-configured"
                  ? `AI connected · ${capabilities.model}`
                  : capabilities?.status === "judge-mode-blocked"
                    ? "AI connection required"
                    : "Verified replay mode"}
          </span>
          <button
            className="contrast-switch"
            type="button"
            aria-pressed={highContrast}
            onClick={() => setHighContrast((value) => !value)}
          >
            {highContrast ? "Standard contrast" : "High contrast"}
          </button>
          <button
            className="reset-demo"
            type="button"
            disabled={Boolean(busy)}
            onClick={resetDemo}
          >
            {busy === "reset" ? "Starting over…" : "Start over"}
          </button>
        </div>
      </header>

      {capabilities?.status === "judge-mode-blocked" ? (
        <div className="judge-runtime-block" role="alert">
          <strong>
            AI policy reading and code repair are currently unavailable.
          </strong>
          <span>
            Connect Amazon Bedrock to use these steps. Niyam does not replace a
            missing AI service with a simulated result.
          </span>
        </div>
      ) : null}

      <nav
        className="journey-guide"
        aria-label="Niyam guided workflow"
        style={
          {
            "--journey-progress": `${(completedJourneySteps / journeySteps.length) * 100}%`,
          } as CSSProperties
        }
      >
        <ol>
          {journeySteps.map((step, index) => (
            <li
              key={step.id}
              data-active={activeJourneyIndex === index}
              data-complete={step.complete}
            >
              <a
                href={`#${step.id}`}
                aria-current={activeJourneyIndex === index ? "step" : undefined}
              >
                <span className="journey-number" aria-hidden="true">
                  {step.complete ? <CheckIcon /> : index + 1}
                </span>
                <span>
                  <strong>{step.title}</strong>
                  <small>{step.description}</small>
                </span>
              </a>
            </li>
          ))}
        </ol>
        <div className="journey-progress" aria-hidden="true">
          <i>
            <b />
          </i>
        </div>
      </nav>

      <aside className="next-best-action" data-complete={Boolean(evidence)}>
        <span className="niyam-guide-mark" aria-hidden="true">
          नि
          <i />
        </span>
        <span className="next-best-copy">
          <small>{nextAction.kicker}</small>
          <strong>{nextAction.title}</strong>
          <span>{nextAction.detail}</span>
        </span>
        <button type="button" onClick={() => goToStep(nextAction.target)}>
          {nextAction.label} <ArrowIcon />
        </button>
      </aside>

      <details className="policy-history-disclosure">
        <summary>
          <span className="history-orbit" aria-hidden="true">
            ↺
          </span>
          <span>
            <small>Policy history</small>
            <strong>Find the rule active on any date</strong>
            <span>See which policy version governed a past decision.</span>
          </span>
          <b>Check a past date</b>
        </summary>
        <div className="policy-time-ribbon" aria-label="Policy version history">
          <div className="ribbon-title">
            <span>Policy version history</span>
            <strong>Which rule was active on the decision date?</strong>
          </div>
          <ol>
            {workspace?.versions.map((version) => (
              <li key={version.id} data-status={version.status}>
                <span>{version.effectiveFrom}</span>
                <strong>{version.id}</strong>
                <small>{version.amendmentNote}</small>
                <code>{version.codeRevision}</code>
                {version.status !== "active" ? (
                  <button
                    type="button"
                    disabled={busy === `rollback-${version.id}`}
                    onClick={() => rollback(version.id)}
                  >
                    Restore this policy version
                  </button>
                ) : (
                  <em>Active policy now</em>
                )}
              </li>
            ))}
          </ol>
          <form
            className="time-query"
            onSubmit={(event) => {
              event.preventDefault();
              void runTimeMachine();
            }}
          >
            <label htmlFor="history-date">Decision date</label>
            <input
              id="history-date"
              type="date"
              value={historyDate}
              onChange={(event) => setHistoryDate(event.target.value)}
            />
            <button type="submit" disabled={busy === "history"}>
              Find the active rule <ArrowIcon />
            </button>
            {historyResult ? (
              <output>
                <strong>{historyResult.governingPolicy.id}</strong>
                <span>
                  {historyResult.evaluation.decision?.code ?? "Unresolved"}
                </span>
                <code>
                  {compactHash(historyResult.governingPolicy.contractHash)}
                </code>
              </output>
            ) : null}
          </form>
        </div>
      </details>

      <div className="policy-ci-intake-grid">
        <article className="citizen-statement" id="citizen-case">
          <header>
            <div className="intake-title">
              <span>
                <b>1</b> Tell your story
              </span>
              <small>
                Type it or say it naturally. Niyam will find the relevant facts.
              </small>
            </div>
            <div className="language-toggle" aria-label="Complaint language">
              {(["hi", "en"] as const).map((language) => (
                <button
                  key={language}
                  type="button"
                  aria-pressed={complaintLanguage === language}
                  onClick={() => {
                    setComplaintLanguage(language);
                    setComplaint(
                      language === "hi"
                        ? HINDI_COMPLAINT
                        : "My household income is exactly INR 300,000. I am 30 years old and have a disability, but my application was rejected.",
                    );
                  }}
                >
                  {language === "hi" ? "हिन्दी" : "English"}
                </button>
              ))}
            </div>
          </header>
          <label htmlFor="citizen-complaint">What happened?</label>
          <textarea
            id="citizen-complaint"
            rows={5}
            value={complaint}
            placeholder="Example: The policy says I qualify, but my application was rejected…"
            onChange={(event) => setComplaint(event.target.value)}
          />
          {listeningTarget === "complaint" ? (
            <ListeningBloom
              language={complaintLanguage}
              transcript={liveTranscript}
              target="complaint"
              onStop={stopDictation}
            />
          ) : null}
          <div className="statement-controls">
            <label htmlFor="complaint-date">Decision date</label>
            <input
              id="complaint-date"
              type="date"
              value={decisionDate}
              onChange={(event) => setDecisionDate(event.target.value)}
            />
            <button
              className="voice-trigger"
              type="button"
              aria-pressed={listeningTarget === "complaint"}
              disabled={Boolean(
                listeningTarget && listeningTarget !== "complaint",
              )}
              onClick={() =>
                listeningTarget === "complaint"
                  ? stopDictation()
                  : startDictation("complaint", complaintLanguage)
              }
            >
              <MicIcon />{" "}
              {listeningTarget === "complaint" ? "Stop" : "Use voice"}
            </button>
            <button
              type="button"
              disabled={busy === "complaint"}
              onClick={analyzeComplaint}
            >
              Check this decision <ArrowIcon />
            </button>
          </div>
          {transcript &&
          transcriptTarget === "complaint" &&
          !listeningTarget ? (
            <output className="visible-transcript" aria-live="polite">
              <CheckIcon /> Voice captured · {transcript}
            </output>
          ) : null}
          {complaintResult ? (
            <div
              className="complaint-proof"
              data-drift={complaintResult.disagreement}
            >
              <div>
                <span>Written policy says</span>
                <strong>{complaintResult.expectedOutcome}</strong>
              </div>
              <div>
                <span>Software returned</span>
                <strong>{complaintResult.productionOutcome}</strong>
              </div>
              <p>{complaintResult.explanation}</p>
              <footer>
                <button type="button" onClick={readExplanation}>
                  Read explanation aloud
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadText(
                      complaintResult.appealDocument.filename,
                      complaintResult.appealDocument.mimeType,
                      complaintResult.appealDocument.html,
                    )
                  }
                >
                  Download appeal document
                </button>
              </footer>
            </div>
          ) : null}
        </article>

        <article className="policy-source-desk" id="policy-change">
          <header>
            <div className="intake-title">
              <span>
                <b>2</b> Check the policy
              </span>
              <small>
                Upload the document, edit the example, or speak a new rule.
              </small>
            </div>
            <div className="language-toggle" aria-label="Policy language">
              {(["en", "hi"] as const).map((language) => (
                <button
                  key={language}
                  type="button"
                  aria-pressed={policyLanguage === language}
                  onClick={() => switchPolicyLanguage(language)}
                >
                  {language === "hi" ? "हिन्दी" : "English"}
                </button>
              ))}
            </div>
          </header>
          <label className="document-drop" htmlFor="policy-document">
            <DocumentIcon />
            <span>
              <strong>Upload policy PDF or text</strong>
              <small>
                Niyam keeps the source page and records a tamper-detection
                fingerprint (SHA-256).
              </small>
            </span>
            <input
              id="policy-document"
              type="file"
              accept="application/pdf,text/plain,.pdf,.txt"
              disabled={busy === "document"}
              onChange={(event) => void uploadDocument(event.target.files?.[0])}
            />
          </label>
          {documentResult ? (
            <div className="document-receipt">
              <strong>{documentResult.filename}</strong>
              <span>
                {documentResult.pages.length} pages ·{" "}
                {documentResult.extraction}
              </span>
              <code>{compactHash(documentResult.sourceHash)}</code>
            </div>
          ) : (
            <>
              <label htmlFor="policy-ci-text">Or edit policy language</label>
              <textarea
                id="policy-ci-text"
                rows={6}
                value={policyText}
                placeholder="Example: Applicants earning up to and including INR 4,00,000 are eligible…"
                onChange={(event) => setPolicyText(event.target.value)}
              />
            </>
          )}
          {listeningTarget === "policy" ? (
            <ListeningBloom
              language={policyLanguage}
              transcript={liveTranscript}
              target="policy"
              onStop={stopDictation}
            />
          ) : null}
          <div className="policy-source-controls">
            <label htmlFor="effective-from">Effective from</label>
            <input
              id="effective-from"
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
            <button
              className="voice-trigger"
              type="button"
              aria-pressed={listeningTarget === "policy"}
              disabled={Boolean(
                listeningTarget && listeningTarget !== "policy",
              )}
              onClick={() =>
                listeningTarget === "policy"
                  ? stopDictation()
                  : startDictation("policy", policyLanguage)
              }
            >
              <MicIcon /> {listeningTarget === "policy" ? "Stop" : "Use voice"}
            </button>
            <button
              type="button"
              disabled={busy === "draft"}
              onClick={analyzePolicy}
            >
              {busy === "draft"
                ? "AI is reading the policy…"
                : capabilities?.status === "live-ai-configured"
                  ? "Read and identify rules with AI"
                  : "Read and identify the rules"}{" "}
              <ArrowIcon />
            </button>
          </div>
          {busy === "draft" ? (
            <div className="ai-activity-trace" aria-live="polite">
              <span className="ai-orbit" aria-hidden="true">
                नि
                <i />
              </span>
              <span>
                <small>Reading the policy</small>
                <strong>
                  Linking each rule to its source · finding unclear wording ·
                  preparing human review
                </strong>
              </span>
            </div>
          ) : null}
          {transcript && transcriptTarget === "policy" && !listeningTarget ? (
            <output className="visible-transcript" aria-live="polite">
              <CheckIcon /> Voice captured · {transcript}
            </output>
          ) : null}
        </article>
      </div>

      {draft ? (
        <section
          className="contract-docket"
          id="policy-approval"
          data-status={draft.status}
        >
          <header>
            <div>
              <span>Stage 2 · Confirm what the policy means</span>
              <strong>
                {draft.status === "approved"
                  ? "Policy interpretation approved"
                  : draft.status === "awaiting-policy-owner"
                    ? "Ready for human review"
                    : draft.status.replaceAll("-", " ")}
              </strong>
            </div>
            <code>{draft.id}</code>
          </header>
          {draft.compilation?.extraction ? (
            <div
              className="extraction-receipt"
              data-live={
                draft.compilation.extraction.mode !==
                "deterministic-supported-grammar"
              }
            >
              <span>
                {draft.compilation.extraction.mode !==
                "deterministic-supported-grammar"
                  ? "AI reading with source links"
                  : "Local rule reading"}
              </span>
              <strong>{draft.compilation.extraction.summary}</strong>
              <code>
                {draft.compilation.extraction.model ??
                  "repeatable rule checker"}
              </code>
            </div>
          ) : null}
          <div className="policy-diff" aria-label="Textual policy diff">
            {draft.textualDiff.map((line, index) => (
              <code
                key={`${line}-${index}`}
                data-kind={line.startsWith("+") ? "add" : "remove"}
              >
                {line}
              </code>
            ))}
          </div>
          {draft.ambiguities.length ? (
            <div className="ambiguity-register">
              {draft.ambiguities.map((issue, index) => (
                <article
                  key={`${issue.code}-${index}`}
                  data-severity={issue.severity}
                >
                  <span>{issue.code.replaceAll("_", " ")}</span>
                  <strong>{issue.message}</strong>
                  <p>{issue.resolution}</p>
                  <q>{issue.sourceExcerpt}</q>
                </article>
              ))}
            </div>
          ) : null}
          {draft.compilation ? (
            <div className="compiled-rules">
              {draft.compilation.extractedRules.map((rule) => (
                <div key={rule.id}>
                  <span>{rule.label}</span>
                  <code>{rule.expression}</code>
                </div>
              ))}
            </div>
          ) : null}
          <footer>
            <span>
              {blockingIssues.length
                ? `${blockingIssues.length} unclear policy issues · stopped for human clarification`
                : draft.status === "approved"
                  ? "Policy owner approved this meaning · code repair unlocked"
                  : "No unclear wording found · a policy owner must still approve the meaning"}
            </span>
            <button
              type="button"
              disabled={
                blockingIssues.length > 0 ||
                draft.status === "approved" ||
                busy === "approval"
              }
              onClick={approveDraft}
            >
              {draft.status === "approved"
                ? "Policy interpretation approved"
                : "Approve policy interpretation"}{" "}
              <CheckIcon />
            </button>
          </footer>
        </section>
      ) : null}

      {approval ? (
        <section className="impact-ledger">
          <header>
            <div>
              <span>Example impact preview</span>
              <strong>Whose result would change under this rule?</strong>
            </div>
            <code>
              {approval.impact.populationSize} fictional applicants ·
              demonstration only
            </code>
          </header>
          <div className="impact-columns">
            <article>
              <span>Gains eligibility</span>
              <strong>{approval.impact.gainedEligibility.length}</strong>
              {approval.impact.gainedEligibility.map((person) => (
                <p key={person.id}>
                  {person.name} · {formatIncome(person.annualHouseholdIncome)} ·
                  age {person.age}
                </p>
              ))}
            </article>
            <article>
              <span>Loses eligibility</span>
              <strong>{approval.impact.lostEligibility.length}</strong>
              {approval.impact.lostEligibility.map((person) => (
                <p key={person.id}>{person.name}</p>
              ))}
            </article>
            <article>
              <span>Unchanged</span>
              <strong>{approval.impact.unchanged}</strong>
              <p>
                {approval.impact.populationSize} fictional applicants checked.
              </p>
            </article>
          </div>
        </section>
      ) : null}

      {draft?.status === "approved" ? (
        <section className="repository-operating-table" id="repair-code">
          <header>
            <div>
              <span>Step 3 · Repair the application code</span>
              <h3>
                Change the faulty line, rerun the original applicant, then test
                the edges.
              </h3>
            </div>
            <div className="target-toggle" aria-label="Repair target">
              {(["node", "python"] as const).map((target) => (
                <button
                  key={target}
                  type="button"
                  aria-pressed={repairTarget === target}
                  onClick={() => setRepairTarget(target)}
                >
                  {target === "node" ? "Node / TypeScript" : "Python"}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy === "repair"}
              onClick={createRepair}
            >
              {busy === "repair"
                ? repairCallState === "retrying"
                  ? "First attempt paused · retrying live AI…"
                  : "AI is repairing an isolated copy of the code…"
                : repairCallState === "failed"
                  ? "Retry live AI repair"
                  : capabilities?.repositoryRepair.enabled
                    ? "Repair the code with live AI"
                    : "Replay the previously verified safe repair"}
              <ArrowIcon />
            </button>
          </header>
          {repairCallState !== "idle" ? (
            <p
              className="repair-call-status"
              role={repairCallState === "failed" ? "alert" : "status"}
            >
              {repairCallState === "retrying"
                ? "The first attempt ended safely. Niyam is retrying once; policy approval, tests, and the no-auto-merge rule remain enforced."
                : "Live AI did not complete after two attempts. Nothing changed or merged; use Retry live AI repair when the connection is ready."}
            </p>
          ) : null}
          {repair ? (
            <div className="repair-record">
              <div className="ai-repair-receipt" data-live={repair.ai.used}>
                <span className="ai-orbit" aria-hidden="true">
                  नि
                  <i />
                </span>
                <span>
                  <small>
                    {repair.ai.used
                      ? "AI code repair · Amazon Bedrock"
                      : "Previously verified repair · safety replay"}
                  </small>
                  <strong>{repair.ai.summary}</strong>
                </span>
                <code>{repair.ai.model ?? repair.mode}</code>
              </div>
              <aside className="source-trace-card">
                <span>Faulty line found here</span>
                <strong>
                  {repair.sourceTrace.file}:{repair.sourceTrace.line}
                </strong>
                <code>{repair.sourceTrace.snippet}</code>
                <small>
                  {repair.sourceTrace.symbol} · {repair.mode}
                </small>
              </aside>
              <div className="repository-patch">
                <header>
                  <span>{repair.branch}</span>
                  <code>{repair.commitHash.slice(0, 12)}</code>
                </header>
                <pre>{repair.patch}</pre>
              </div>
              <div className="replay-fracture">
                <div>
                  <span>Before the repair</span>
                  <strong>{repair.originalReplay.outcomeCode}</strong>
                </div>
                <ArrowIcon />
                <div>
                  <span>After the repair</span>
                  <strong>{repair.repairedReplay.outcomeCode}</strong>
                </div>
              </div>
              <div className="verification-ledger" id="verify-repair">
                <header className="verification-stage-heading">
                  <span>Stage 4 · Verify the repair</span>
                  <strong>
                    The original case passed. Now search for another failure.
                  </strong>
                </header>
                {repair.verification.map((check) => (
                  <div key={check.label}>
                    <CheckIcon />
                    <span>{check.label}</span>
                    <code>{check.command}</code>
                    <strong>{check.passed ? "passed" : "failed"}</strong>
                  </div>
                ))}
                <footer>
                  Existing application tests {repair.existingTests.passed}/
                  {repair.existingTests.total} · Policy tests{" "}
                  {repair.policyTests.passed}/{repair.policyTests.total}
                </footer>
              </div>
              <aside
                className="adversarial-review-card"
                data-status={repair.adversarialReview.status}
              >
                <div>
                  <span>Independent edge-case search</span>
                  <strong>
                    {repair.adversarialReview.status === "passed"
                      ? `All ${repair.adversarialReview.casesGenerated} generated edge cases passed`
                      : "A failing edge case was found"}
                  </strong>
                  <p>
                    {repair.adversarialReview.status === "passed"
                      ? `Boundary and interaction cases covered ${repair.adversarialReview.policyBranches.covered}/${repair.adversarialReview.policyBranches.total} rule paths. This verifies the demonstrated policy behavior, not every possible software system.`
                      : repair.adversarialReview.claim}
                  </p>
                </div>
                <dl>
                  <div>
                    <dt>Edge cases tried</dt>
                    <dd>{repair.adversarialReview.casesGenerated}</dd>
                  </div>
                  <div>
                    <dt>Rule paths tested</dt>
                    <dd>
                      {repair.adversarialReview.policyBranches.covered}/
                      {repair.adversarialReview.policyBranches.total}
                    </dd>
                  </div>
                  <div>
                    <dt>Failures</dt>
                    <dd>{repair.adversarialReview.counterexamplesFound}</dd>
                  </div>
                </dl>
              </aside>
              <div className="dual-approval-gate" id="proof-bundle">
                <div className="proof-gate-copy">
                  <span>Stage 5 · Approve and save the evidence</span>
                  <strong>
                    A policy owner and engineer approve. Then Niyam signs the
                    record.
                  </strong>
                </div>
                <button
                  type="button"
                  disabled={
                    approvalRoles.has("policy-owner") || busy === "policy-owner"
                  }
                  onClick={() => approveRepair("policy-owner")}
                >
                  {approvalRoles.has("policy-owner") ? <CheckIcon /> : null}
                  Policy owner approval
                </button>
                <button
                  type="button"
                  disabled={
                    approvalRoles.has("engineer") || busy === "engineer"
                  }
                  onClick={() => approveRepair("engineer")}
                >
                  {approvalRoles.has("engineer") ? <CheckIcon /> : null}
                  Engineer approval
                </button>
                <button
                  type="button"
                  disabled={
                    Boolean(evidence) ||
                    busy === "evidence" ||
                    !approvalRoles.has("policy-owner") ||
                    !approvalRoles.has("engineer")
                  }
                  onClick={signEvidence}
                >
                  {evidence
                    ? "Evidence verified"
                    : "Create and verify evidence"}{" "}
                  {evidence ? <CheckIcon /> : <ArrowIcon />}
                </button>
              </div>
              {evidence ? (
                <div
                  className="signed-evidence-seal"
                  aria-label="Signed evidence verified"
                >
                  <span className="proof-spark" aria-hidden="true">
                    ✦
                  </span>
                  <div>
                    <span>Signature and evidence contents verified</span>
                    <strong>
                      {evidenceVerification?.valid ? "Verified" : "Signed"}
                    </strong>
                    <code>
                      {evidence.signature.algorithm} ·{" "}
                      {compactHash(evidence.signature.publicKeyFingerprint)}
                    </code>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      downloadText(
                        evidence.filename,
                        "application/json",
                        JSON.stringify(evidence, null, 2),
                      )
                    }
                  >
                    Download signed evidence
                  </button>
                </div>
              ) : null}
              <details className="github-publisher">
                <summary>
                  Open the approved code change for GitHub review
                </summary>
                <label htmlFor="github-repository">
                  Repository (owner/name)
                </label>
                <input
                  id="github-repository"
                  value={repository}
                  placeholder="owner/decision-app"
                  onChange={(event) => setRepository(event.target.value)}
                />
                <label>
                  <input
                    type="checkbox"
                    checked={confirmPublish}
                    onChange={(event) =>
                      setConfirmPublish(event.target.checked)
                    }
                  />
                  I confirm this publishes the approved code copy and opens a
                  GitHub pull request (code review).
                </label>
                <button
                  type="button"
                  disabled={
                    !confirmPublish ||
                    !repository ||
                    !approvalRoles.has("policy-owner") ||
                    !approvalRoles.has("engineer") ||
                    busy === "publish"
                  }
                  onClick={publishPullRequest}
                >
                  Open GitHub code review
                </button>
                {repair.pullRequest.url ? (
                  <a
                    href={repair.pullRequest.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open the GitHub code review
                  </a>
                ) : null}
              </details>
            </div>
          ) : null}
        </section>
      ) : (
        <section
          className="locked-journey-stage"
          id="repair-code"
          data-lock="approval"
        >
          <span className="locked-step" aria-hidden="true">
            <b>3</b>
            <LockIcon />
          </span>
          <span className="locked-stage-copy">
            <em>Locked until policy approval</em>
            <strong>Repair the application</strong>
            <small>
              Opens only after a policy owner confirms what the rule means.
            </small>
          </span>
          <span className="locked-stage-status">
            <LockIcon />
            <span>
              <small>Human policy approval required</small>
              <strong>Approve the policy interpretation first</strong>
            </span>
          </span>
          <div
            className="locked-artifact-preview"
            aria-label="Repair stage evidence preview"
          >
            <span className="locked-preview-label">What unlocks here</span>
            <span>
              <small>AI code repair</small>
              <strong>Amazon Bedrock proposes a minimal patch</strong>
            </span>
            <span>
              <small>Isolated code copy</small>
              <strong>The original application remains unchanged</strong>
            </span>
            <span>
              <small>Review package</small>
              <code>code diff · commit · policy tests</code>
            </span>
          </div>
        </section>
      )}

      {!repair ? (
        <section
          className="locked-journey-stage"
          id="verify-repair"
          data-lock="repair"
        >
          <span className="locked-step" aria-hidden="true">
            <b>4</b>
            <LockIcon />
          </span>
          <span className="locked-stage-copy">
            <em>Locked until code repair</em>
            <strong>Verify the repair</strong>
            <small>
              Opens after AI proposes a reviewable change to the application.
            </small>
          </span>
          <span className="locked-stage-status">
            <LockIcon />
            <span>
              <small>Code change required</small>
              <strong>Create a repair before running tests</strong>
            </span>
          </span>
          <div
            className="locked-artifact-preview"
            aria-label="Verification stage evidence preview"
          >
            <span className="locked-preview-label">What unlocks here</span>
            <span>
              <small>Original case rerun</small>
              <strong>INELIGIBLE → ELIGIBLE</strong>
            </span>
            <span>
              <small>Old and new checks</small>
              <strong>Build + application tests + policy tests</strong>
            </span>
            <span>
              <small>Independent edge-case search</small>
              <code>112 cases · every rule path tested (4/4)</code>
            </span>
          </div>
        </section>
      ) : null}

      {!repair ? (
        <section
          className="locked-journey-stage"
          id="proof-bundle"
          data-lock="evidence"
        >
          <span className="locked-step" aria-hidden="true">
            <b>5</b>
            <LockIcon />
          </span>
          <span className="locked-stage-copy">
            <em>Locked until every test passes</em>
            <strong>Approve and sign the evidence</strong>
            <small>
              Opens after the repaired application passes every required check.
            </small>
          </span>
          <span className="locked-stage-status">
            <LockIcon />
            <span>
              <small>Passing test results required</small>
              <strong>Pass every required check first</strong>
            </span>
          </span>
          <div
            className="locked-artifact-preview"
            aria-label="Evidence stage preview"
          >
            <span className="locked-preview-label">What unlocks here</span>
            <span>
              <small>Required human approvals</small>
              <strong>Policy owner + engineer</strong>
            </span>
            <span>
              <small>Tamper-evident evidence</small>
              <strong>Tamper-evident record (Ed25519 signature)</strong>
            </span>
            <span>
              <small>Code review</small>
              <code>
                confirmed GitHub code review · future policy/code checks
              </code>
            </span>
          </div>
        </section>
      ) : null}

      <footer
        className="policy-ci-status"
        aria-busy={runtimeLoadState === "loading" || Boolean(busy)}
        aria-live="polite"
        data-runtime-state={runtimeLoadState}
      >
        <span className="policy-ci-status-label">
          <i aria-hidden="true" />{" "}
          {busy
            ? "Working"
            : runtimeLoadState === "loading"
              ? "Checking status"
              : runtimeLoadState === "unavailable"
                ? "Status unavailable"
                : "Current status"}
        </span>
        <strong>{status}</strong>
        <code>
          {runtimeLoadState === "loading"
            ? "Checking live AI · Policy history pending · Evidence settings pending"
            : runtimeLoadState === "unavailable"
              ? "Safety gates active · Policy history unavailable · Evidence settings unavailable"
              : `${capabilities?.status === "live-ai-configured" ? "AI connected" : "Verified replay"} · Current policy: ${activeVersion?.id ?? "unavailable"} · ${workspace?.signing.algorithm ? `Tamper-evident signature: ${workspace.signing.algorithm}` : "Evidence signature unavailable"}`}
        </code>
      </footer>
    </section>
  );
}
