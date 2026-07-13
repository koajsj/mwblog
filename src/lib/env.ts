import { isAbsolute } from "node:path";

export function getAppEnv() {
  const appOrigin = process.env.APP_ORIGIN || import.meta.env.APP_ORIGIN || "";
  const dataDir = process.env.APP_DATA_DIR || import.meta.env.APP_DATA_DIR || "";
  return { appOrigin, dataDir };
}

export function validateProductionEnvironment() {
  if (process.env.NODE_ENV !== "production") return;

  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 16)) {
    throw new Error("Node.js 22.16 or newer is required.");
  }

  const { appOrigin, dataDir } = getAppEnv();
  let origin: URL;
  try {
    origin = new URL(appOrigin);
  } catch {
    throw new Error("APP_ORIGIN must be a valid HTTPS origin.");
  }
  if (
    origin.protocol !== "https:"
    || !origin.hostname
    || origin.username
    || origin.password
    || origin.pathname !== "/"
    || origin.search
    || origin.hash
  ) {
    throw new Error("APP_ORIGIN must contain only the production HTTPS origin.");
  }
  if (!isAbsolute(dataDir)) throw new Error("APP_DATA_DIR must be an absolute path in production.");

  const backupKey = String(process.env.BACKUP_ENCRYPTION_KEY || "").trim();
  const validHex = /^[0-9a-f]{64}$/i.test(backupKey);
  let validBase64 = false;
  try {
    validBase64 = Buffer.from(backupKey, "base64").length === 32;
  } catch {
    validBase64 = false;
  }
  if (!validHex && !validBase64) throw new Error("BACKUP_ENCRYPTION_KEY must be a 32-byte key.");

  if (!/^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/.test(String(process.env.LOGIN_PASSWORD_HASH || ""))) {
    throw new Error("LOGIN_PASSWORD_HASH must contain the fixed-account scrypt verifier.");
  }
}
