import { PrismaClient, Chain, MerchantGatewayEnv } from "@prisma/client";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { encryptMerchantApiKey } from "../src/lib/merchant-api-key-cipher.js";

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

  const existingAdmin = await prisma.admin.findFirst({
    where: { email: adminEmail, deletedAt: null },
  });
  if (existingAdmin) {
    await prisma.admin.update({
      where: { id: existingAdmin.id },
      data: { passwordHash: adminHash },
    });
  } else {
    await prisma.admin.create({
      data: {
        email: adminEmail,
        passwordHash: adminHash,
        displayName: "Super Admin",
        portalEnvironment: MerchantGatewayEnv.live,
      },
    });
  }

  const apiSecret =
    process.env.SEED_MERCHANT_API_KEY ??
    process.env.SEED_MERCHANT_SANDBOX_API_KEY ??
    "cpg_demo_dev_only_change_me";
  const apiHash = sha256Hex(apiSecret);

  const existingMerch = await prisma.merchant.findFirst({
    where: { email: merchEmail, deletedAt: null },
  });
  if (existingMerch) {
    await prisma.merchant.update({
      where: { id: existingMerch.id },
      data: {
        passwordHash: merchHash,
        apiKeyHash: apiHash,
        apiKeyHint: apiSecret.slice(-6),
        apiKeyCipher: encryptMerchantApiKey(apiSecret),
        sandboxApiKeyHash: apiHash,
        sandboxApiKeyHint: apiSecret.slice(-6),
        sandboxApiKeyCipher: encryptMerchantApiKey(apiSecret),
        defaultChains: [Chain.TRON],
        portalEnvironment: MerchantGatewayEnv.sandbox,
      },
    });
  } else {
    await prisma.merchant.create({
      data: {
        email: merchEmail,
        passwordHash: merchHash,
        displayName: "Demo Merchant",
        apiKeyHash: apiHash,
        apiKeyHint: apiSecret.slice(-6),
        apiKeyCipher: encryptMerchantApiKey(apiSecret),
        sandboxApiKeyHash: apiHash,
        sandboxApiKeyHint: apiSecret.slice(-6),
        sandboxApiKeyCipher: encryptMerchantApiKey(apiSecret),
        defaultChains: [Chain.TRON],
        callbackUrl: process.env.SEED_MERCHANT_CALLBACK_URL ?? null,
        portalEnvironment: MerchantGatewayEnv.sandbox,
      },
    });
  }

  console.log("Seed OK. Merchant gateway API key (dev, live + sandbox):", apiSecret);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
