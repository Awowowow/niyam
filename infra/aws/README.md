# AWS deployment

Niyam deploys to Amazon ECS on Fargate as one task containing three containers:

- `web` is the only load-balanced container. Its same-origin `/api/niyam/*` route proxies to the API over `127.0.0.1`.
- `api` performs policy compilation, AI extraction, bounded repair, verification orchestration, and evidence signing.
- `verification` provides PDF extraction and bounded Z3 counterexample search to the API over `127.0.0.1`.

CloudFront provides the public HTTPS judge URL. The application load balancer accepts application traffic only when CloudFront supplies a private origin-verification header; direct ALB requests return `403`. Dynamic requests use CloudFront's managed `CachingDisabled` policy.

The ECS task role uses the AWS-managed `AmazonBedrockMantleInferenceAccess` policy. The API signs Bedrock Mantle requests with temporary task credentials, so the deployed application stores no AWS access key. Production uses `openai.gpt-oss-120b` for cited policy interpretation and `qwen.qwen3-coder-480b-a35b-instruct` for bounded source repair. The production image intentionally omits the Codex CLI because this account does not have frontier-model entitlement; the optional Codex backend remains available for a separate image when access is granted.

Evidence proofs use a stable Ed25519 private key stored in AWS Secrets Manager. ECS injects it only into the API container at runtime. The key, the CloudFront origin value, AWS credentials, and GitHub credentials must never be committed or copied into an image.

## One-time deployer permission

The `niyam-deployer` group needs the additional temporary policy in `deployer-policy.json` to create the ECS, VPC, load-balancing, CloudFront, Secrets Manager, and stack-owned IAM resources. Attach it as a customer-managed policy named `NiyamDeploymentAccess`, deploy, and remove it after the infrastructure is stable. Existing ECR and CloudFormation permissions remain in use.

## Deploy

From the repository root:

```bash
chmod +x infra/aws/deploy.sh
AWS_PROFILE=niyam AWS_REGION=us-east-2 ./infra/aws/deploy.sh
```

The script:

1. Creates three immutable, scan-on-push ECR repositories when absent.
2. Builds and pushes ARM64 images for Fargate.
3. Creates the two Secrets Manager values when absent.
4. Deploys `template.yaml` with `CAPABILITY_NAMED_IAM`.
5. Prints the CloudFront HTTPS URL, ECS cluster, and service.

Override `IMAGE_TAG`, `STACK_NAME`, or `PLATFORM` only when needed. Re-running the script creates a new immutable image tag and performs an ECS rolling deployment.

## Judge-proof verification

After deployment, verify all of the following before recording the submission video:

1. The CloudFront URL loads over HTTPS and the direct ALB output returns `403`.
2. `/api/niyam/v1/repairs/capabilities` reports `bedrock-chat`, the Qwen repair model, AWS task-role authentication, and `configured: true`.
3. English and Hindi policy extraction return exact source citations.
4. Approval unlocks repair; repair changes the responsible source file only.
5. Build, generated tests, replay, and all 112 adversarial cases pass.
6. The final evidence bundle reports Ed25519 signing with `keySource: environment`.

If deployment fails, inspect the ECS service events and `/ecs/niyam-production` CloudWatch log streams before changing infrastructure.
