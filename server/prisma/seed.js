import { PrismaClient, AdminRole, Chain } from "@prisma/client";
import bcrypt from "bcrypt";
import crypto from "crypto";

const prisma = new PrismaClient();

function sha256Hex(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@gateway.local";
  const adminPass = process.env.SEED_ADMIN_PASSWORD ?? "Admin#ChangeMe1";
  const merchEmail = process.env.SEED_MERCHANT_EMAIL ?? "merchant@gateway.local";
  const merchPass = process.env.SEED_MERCHANT_PASSWORD ?? "Merchant#Demo1";

  const adminHash = await bcrypt.hash(adminPass, 10);
  const merchHash = await bcrypt.hash(merchPass, 10);

  await prisma.adminUser.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      passwordHash: adminHash,
      role: AdminRole.ADMIN,
      displayName: "Super Admin",
      defaultChains: [Chain.ETH],
    },
    update: { passwordHash: adminHash, defaultChains: [Chain.ETH] },
  });

  const apiSecret = process.env.SEED_MERCHANT_API_KEY ?? "cpg_live_demo_dev_only_change_me";
  const apiHash = sha256Hex(apiSecret);

  await prisma.adminUser.upsert({
    where: { email: merchEmail },
    create: {
      email: merchEmail,
      passwordHash: merchHash,
      role: AdminRole.MERCHANT,
      displayName: "Demo Merchant",
      apiKeyHash: apiHash,
      apiKeyHint: apiSecret.slice(-6),
      defaultChains: [Chain.TRON],
      callbackUrl: process.env.SEED_MERCHANT_CALLBACK_URL ?? null,
    },
    update: {
      passwordHash: merchHash,
      apiKeyHash: apiHash,
      apiKeyHint: apiSecret.slice(-6),
      defaultChains: [Chain.TRON],
    },
  });

  console.log("Seed OK. Merchant API key (dev):", apiSecret);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
