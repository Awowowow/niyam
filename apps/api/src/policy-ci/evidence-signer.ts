import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

export class EvidenceSigner {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  readonly keySource: "environment" | "ephemeral-demo";

  constructor() {
    const encoded = process.env.NIYAM_EVIDENCE_PRIVATE_KEY_BASE64;
    if (encoded) {
      this.privateKey = createPrivateKey(
        Buffer.from(encoded, "base64").toString("utf8"),
      );
      this.publicKey = createPublicKey(this.privateKey);
      this.keySource = "environment";
    } else {
      const pair = generateKeyPairSync("ed25519");
      this.privateKey = pair.privateKey;
      this.publicKey = pair.publicKey;
      this.keySource = "ephemeral-demo";
    }
  }

  sign(payload: unknown) {
    const canonical = JSON.stringify(payload);
    const publicKeyPem = this.publicKey
      .export({
        type: "spki",
        format: "pem",
      })
      .toString();
    return {
      algorithm: "Ed25519" as const,
      signature: sign(null, Buffer.from(canonical), this.privateKey).toString(
        "base64",
      ),
      publicKey: publicKeyPem,
      publicKeyFingerprint: `sha256:${createHash("sha256").update(publicKeyPem).digest("hex")}`,
      keySource: this.keySource,
    };
  }

  verify(
    payload: unknown,
    signatureBase64: string,
    publicKeyPem?: string,
  ): boolean {
    try {
      const verificationKey = publicKeyPem
        ? createPublicKey(publicKeyPem)
        : this.publicKey;
      return verify(
        null,
        Buffer.from(JSON.stringify(payload)),
        verificationKey,
        Buffer.from(signatureBase64, "base64"),
      );
    } catch {
      return false;
    }
  }
}
