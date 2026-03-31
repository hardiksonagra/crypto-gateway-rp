import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SETTLEMENT_UPLOADS_DIR = path.join(
  __dirname,
  "../../uploads/settlements",
);

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

function ensureDir() {
  fs.mkdirSync(SETTLEMENT_UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    try {
      ensureDir();
      cb(null, SETTLEMENT_UPLOADS_DIR);
    } catch (e) {
      cb(/** @type {Error} */ (e), SETTLEMENT_UPLOADS_DIR);
    }
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || "").slice(0, 16) || ".bin";
    const safeExt = /^\.[a-zA-Z0-9]+$/.test(ext) ? ext : ".bin";
    const name = `stl_${crypto.randomBytes(16).toString("hex")}${safeExt}`;
    cb(null, name);
  },
});

export const settlementProofUpload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const t = String(file.mimetype || "");
    if (ALLOWED_MIME.has(t)) {
      cb(null, true);
      return;
    }
    cb(new Error("invalid_proof_type"));
  },
});

/**
 * @param {string} fileName
 * @returns {string | null}
 */
export function proofPathForFileName(fileName) {
  const base = path.basename(String(fileName || ""));
  if (!base || base.includes("..") || base.includes("/") || base.includes("\\")) {
    return null;
  }
  const full = path.join(SETTLEMENT_UPLOADS_DIR, base);
  const resolvedDir = path.resolve(SETTLEMENT_UPLOADS_DIR);
  if (!full.startsWith(resolvedDir + path.sep) && full !== resolvedDir) {
    return null;
  }
  return full;
}
