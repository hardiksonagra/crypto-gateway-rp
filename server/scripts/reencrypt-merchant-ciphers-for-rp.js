/**
 * One-shot: re-encrypt merchant AES-GCM blobs for merchants under an RP email.
 *
 * When ENCRYPTION_KEY is not 64-hex, envelopes use sha256(JWT_SECRET).
 *
 *   OLD_JWT_SECRET='…' JWT_SECRET='…' node scripts/reencrypt-merchant-ciphers-for-rp.js test@rp.com
 *
 * Loads ../.env for DATABASE_URL / JWT_SECRET; OLD_JWT_SECRET must be set in the environment.
 */
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env") });
dotenv.config({ path: path.join(__dirname, "../.env") });

const OLD_JWT = String(process.env.OLD_JWT_SECRET ?? "").trim();
const NEW_JWT = String(process.env.JWT_SECRET ?? "")
  .trim()
  .replace(/^"|"$/g, "");
const rpEmail = String(process.argv[2] ?? "test@rp.com").trim().toLowerCase();

if (!OLD_JWT || !NEW_JWT) {
  console.error("Set OLD_JWT_SECRET and JWT_SECRET (new).");
  process.exit(1);
}

/** @param {string} jwt */
function keyFromJwt(jwt) {
  return crypto.createHash("sha256").update(jwt, "utf8").digest();
}

/**
 * @param {string} blob
 * @param {Buffer} key
 */
function decryptWith(blob, key) {
  const buf = Buffer.from(String(blob), "base64");
  if (buf.length < 12 + 16 + 1) throw new Error("invalid cipher blob");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/**
 * @param {string} plain
 * @param {Buffer} key
 */
function encryptWith(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([
    cipher.update(String(plain), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

const CIPHER_FIELDS = [
  "mnemonicCipher",
  "apiKeyCipher",
  "sandboxApiKeyCipher",
  "trxSweepFunderPrivateKeyCipher",
];

const oldKey = keyFromJwt(OLD_JWT);
const newKey = keyFromJwt(NEW_JWT);
const prisma = new PrismaClient();

const rp = await prisma.resellerPartner.findFirst({
  where: { email: rpEmail, deletedAt: null },
  select: { id: true, email: true },
});
if (!rp) {
  console.error(`RP not found: ${rpEmail}`);
  await prisma.$disconnect();
  process.exit(1);
}
console.log(`RP #${rp.id} ${rp.email}`);

const merchants = await prisma.merchant.findMany({
  where: { resellerPartnerId: rp.id },
  select: {
    id: true,
    email: true,
    mnemonicCipher: true,
    apiKeyCipher: true,
    sandboxApiKeyCipher: true,
    trxSweepFunderPrivateKeyCipher: true,
  },
});

if (merchants.length === 0) {
  console.log("No merchants under this RP.");
  await prisma.$disconnect();
  process.exit(0);
}

let updated = 0;
for (const m of merchants) {
  /** @type {Record<string, string>} */
  const data = {};
  for (const f of CIPHER_FIELDS) {
    const blob = m[f];
    if (!blob) continue;
    let plain;
    let via;
    try {
      plain = decryptWith(blob, oldKey);
      via = "old";
    } catch {
      try {
        decryptWith(blob, newKey);
        via = "already_new";
      } catch (e2) {
        console.error(`  FAIL #${m.id} ${m.email} ${f}: ${e2}`);
        continue;
      }
    }
    if (via === "already_new") {
      console.log(`  skip #${m.id} ${f} (already new key)`);
      continue;
    }
    data[f] = encryptWith(plain, newKey);
    console.log(`  reencrypt #${m.id} ${m.email} ${f}`);
  }
  if (Object.keys(data).length) {
    await prisma.merchant.update({ where: { id: m.id }, data });
    updated += 1;
  }
}

console.log(`Done. Merchants updated: ${updated}/${merchants.length}`);
await prisma.$disconnect();
