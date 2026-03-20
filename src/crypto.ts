import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = "sha512";

export function generateSalt(): string {
  return crypto.randomBytes(SALT_LENGTH).toString("hex");
}

export function deriveKey(password: string, salt: string): Buffer {
  return crypto.pbkdf2Sync(
    password,
    Buffer.from(salt, "hex"),
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    PBKDF2_DIGEST
  );
}

export function createVerificationHash(key: Buffer): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function encrypt(
  data: string,
  key: Buffer
): { iv: string; authTag: string; encrypted: string } {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(data, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    encrypted,
  };
}

export function decrypt(
  encrypted: string,
  key: Buffer,
  iv: string,
  authTag: string
): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(authTag, "hex"));

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

export function generateProjectId(): string {
  return `prj_${crypto.randomBytes(4).toString("hex")}`;
}

export function getMachineId(): string {
  const os = require("os");
  const raw = `${os.hostname()}-${os.userInfo().username}-${os.platform()}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export function encryptForCache(derivedKey: Buffer, machineId: string): string {
  const cacheKey = crypto
    .createHash("sha256")
    .update(machineId)
    .digest()
    .slice(0, 32);
  const { iv, authTag, encrypted } = encrypt(
    derivedKey.toString("hex"),
    cacheKey
  );
  return JSON.stringify({ iv, authTag, encrypted });
}

export function decryptFromCache(
  cached: string,
  machineId: string
): Buffer | null {
  try {
    const cacheKey = crypto
      .createHash("sha256")
      .update(machineId)
      .digest()
      .slice(0, 32);
    const { iv, authTag, encrypted } = JSON.parse(cached);
    const hex = decrypt(encrypted, cacheKey, iv, authTag);
    return Buffer.from(hex, "hex");
  } catch {
    return null;
  }
}
