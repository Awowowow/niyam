#!/usr/bin/env bash
set -euo pipefail

AWS_PROFILE="${AWS_PROFILE:-niyam}"
AWS_REGION="${AWS_REGION:-us-east-2}"
STACK_NAME="${STACK_NAME:-niyam-production}"
PLATFORM="${PLATFORM:-linux/arm64}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M%S)}"

aws_cli() {
  aws --profile "${AWS_PROFILE}" --region "${AWS_REGION}" "$@"
}

ACCOUNT_ID="$(aws_cli sts get-caller-identity --query Account --output text)"
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

ensure_repository() {
  local repository="$1"
  if ! aws_cli ecr describe-repositories --repository-names "${repository}" >/dev/null 2>&1; then
    aws_cli ecr create-repository \
      --repository-name "${repository}" \
      --image-tag-mutability IMMUTABLE \
      --image-scanning-configuration scanOnPush=true \
      --tags Key=Project,Value=Niyam >/dev/null
  fi
}

ensure_repository niyam-api
ensure_repository niyam-web
ensure_repository niyam-verification

aws_cli ecr get-login-password | \
  docker login --username AWS --password-stdin "${ECR_REGISTRY}"

API_IMAGE="${ECR_REGISTRY}/niyam-api:${IMAGE_TAG}"
WEB_IMAGE="${ECR_REGISTRY}/niyam-web:${IMAGE_TAG}"
VERIFICATION_IMAGE="${ECR_REGISTRY}/niyam-verification:${IMAGE_TAG}"

docker buildx build --platform "${PLATFORM}" --file apps/api/Dockerfile --tag "${API_IMAGE}" --push .
docker buildx build --platform "${PLATFORM}" --file apps/web/Dockerfile --tag "${WEB_IMAGE}" --push .
docker buildx build --platform "${PLATFORM}" --file apps/verification/Dockerfile --tag "${VERIFICATION_IMAGE}" --push .

EVIDENCE_SECRET_NAME="niyam/evidence-signing-key"
if ! aws_cli secretsmanager describe-secret --secret-id "${EVIDENCE_SECRET_NAME}" >/dev/null 2>&1; then
  node -e "const {generateKeyPairSync}=require('node:crypto');const {privateKey}=generateKeyPairSync('ed25519');const pem=privateKey.export({type:'pkcs8',format:'pem'});process.stdout.write(Buffer.from(pem).toString('base64'))" | \
    aws_cli secretsmanager create-secret \
      --name "${EVIDENCE_SECRET_NAME}" \
      --description "Niyam production Ed25519 evidence signing key" \
      --secret-string file:///dev/stdin \
      --tags Key=Project,Value=Niyam >/dev/null
fi
EVIDENCE_SECRET_ARN="$(aws_cli secretsmanager describe-secret --secret-id "${EVIDENCE_SECRET_NAME}" --query ARN --output text)"

ORIGIN_SECRET_NAME="niyam/origin-verify-secret"
if ! aws_cli secretsmanager describe-secret --secret-id "${ORIGIN_SECRET_NAME}" >/dev/null 2>&1; then
  node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" | \
    aws_cli secretsmanager create-secret \
      --name "${ORIGIN_SECRET_NAME}" \
      --description "Niyam CloudFront to ALB origin verification value" \
      --secret-string file:///dev/stdin \
      --tags Key=Project,Value=Niyam >/dev/null
fi
ORIGIN_SECRET="$(aws_cli secretsmanager get-secret-value --secret-id "${ORIGIN_SECRET_NAME}" --query SecretString --output text)"

aws_cli cloudformation deploy \
  --stack-name "${STACK_NAME}" \
  --template-file infra/aws/template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "ApiImage=${API_IMAGE}" \
    "WebImage=${WEB_IMAGE}" \
    "VerificationImage=${VERIFICATION_IMAGE}" \
    "EvidencePrivateKeySecretArn=${EVIDENCE_SECRET_ARN}" \
    "OriginVerifySecret=${ORIGIN_SECRET}" \
  --tags Project=Niyam Environment=production

aws_cli cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' \
  --output table
