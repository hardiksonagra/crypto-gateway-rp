import {
  Connection,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Chain } from "@prisma/client";
import { env } from "../../config/env.js";
import { re } from "../../config/runtime-env.js";
import { prisma } from "../../lib/prisma.js";
import { postgresChainEnumHasSolana } from "../../lib/postgres-chain-enum-solana.js";
import { logger } from "../../lib/logger.js";
import { acquireOutboundRpcSlot } from "../../lib/network-rpc-rate-limit.js";
import { deriveSolanaKeypair } from "../wallet/solana-wallet.js";

const USDT_DECIMALS = 6;

/** Payer needs SOL for fees + possible dest ATA rent (lamports). */
const MIN_SOL_LAMPORTS = 3_000_000n;

/**
 * @returns {Promise<{ configured: boolean, master_address: string | null, rpc_url: string, mint: string, wallets: object[] }>}
 */
export async function listSolanaUsdtSweepTargets() {
  const master = re.sweepMasterSolana?.trim() ?? "";
  const mint = re.solanaUsdtMint.trim();
  const rpc = re.solanaRpcUrl.replace(/\/$/, "");

  if (!(await postgresChainEnumHasSolana())) {
    return {
      configured: Boolean(master),
      master_address: master || null,
      rpc_url: rpc,
      mint,
      wallets: [],
      chain_solana_enum_missing: true,
    };
  }

  const wallets = await prisma.wallet.findMany({
    where: {
      chain: Chain.SOLANA,
      currency: "USDT",
      network: "SPL",
    },
    orderBy: { createdAt: "asc" },
    include: {
      merchant: { select: { email: true, displayName: true } },
      assignedUser: { select: { externalUserId: true } },
    },
  });

  return {
    configured: Boolean(master),
    master_address: master || null,
    rpc_url: rpc,
    mint,
    wallets: wallets.map((w) => ({
      id: w.id,
      address: w.address,
      chain: w.chain,
      currency: w.currency,
      network: w.network,
      derivation_index: w.derivationIndex,
      environment: w.environment,
      external_user_id: w.assignedUser?.externalUserId ?? null,
      merchant_label: w.merchant.displayName ?? w.merchant.email,
    })),
  };
}

/**
 * @param {string} walletId
 */
export async function sweepSolanaUsdtOne(walletId) {
  if (!(await postgresChainEnumHasSolana())) {
    return {
      ok: false,
      error: "CHAIN_SOLANA_ENUM_MISSING",
      detail: "Apply Prisma migrations so Postgres enum Chain includes SOLANA.",
    };
  }

  const master = re.sweepMasterSolana?.trim();
  if (!master) {
    return { ok: false, error: "SWEEP_MASTER_SOLANA_NOT_SET" };
  }

  const mintPk = new PublicKey(re.solanaUsdtMint.trim());
  let destOwner;
  try {
    destOwner = new PublicKey(master);
  } catch {
    return { ok: false, error: "INVALID_MASTER_ADDRESS" };
  }

  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      chain: Chain.SOLANA,
      currency: "USDT",
      network: "SPL",
    },
  });

  if (!wallet) {
    return { ok: false, error: "WALLET_NOT_FOUND" };
  }

  if (wallet.address === master) {
    return { ok: false, error: "SOURCE_IS_MASTER" };
  }

  const fromKeypair = deriveSolanaKeypair(wallet.derivationIndex, env.mnemonic);
  if (fromKeypair.publicKey.toBase58() !== wallet.address) {
    logger.error("solana sweep: derived address mismatch", {
      walletId,
      expected: wallet.address,
      derived: fromKeypair.publicKey.toBase58(),
    });
    return { ok: false, error: "DERIVED_ADDRESS_MISMATCH" };
  }

  await acquireOutboundRpcSlot("SOLANA");
  const connection = new Connection(re.solanaRpcUrl, "confirmed");

  const fromAta = getAssociatedTokenAddressSync(
    mintPk,
    fromKeypair.publicKey,
    false,
  );
  const toAta = getAssociatedTokenAddressSync(mintPk, destOwner, false);

  let fromAccount;
  try {
    fromAccount = await getAccount(connection, fromAta);
  } catch {
    return {
      ok: true,
      skipped: true,
      reason: "no_token_account",
      from_address: wallet.address,
      balance_atomic: "0",
    };
  }

  const amount = fromAccount.amount;
  if (amount === 0n) {
    return {
      ok: true,
      skipped: true,
      reason: "zero_usdt_balance",
      from_address: wallet.address,
      balance_atomic: amount.toString(),
    };
  }

  await acquireOutboundRpcSlot("SOLANA");
  const lamports = BigInt(await connection.getBalance(fromKeypair.publicKey));
  if (lamports < MIN_SOL_LAMPORTS) {
    return {
      ok: false,
      error: "INSUFFICIENT_SOL_FOR_FEE",
      detail: `Need at least ${MIN_SOL_LAMPORTS} lamports on ${wallet.address}; have ${lamports}`,
    };
  }

  const tx = new Transaction();

  let destExists = true;
  try {
    await getAccount(connection, toAta);
  } catch {
    destExists = false;
  }

  if (!destExists) {
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        fromKeypair.publicKey,
        toAta,
        destOwner,
        mintPk,
        TOKEN_PROGRAM_ID,
      ),
    );
  }

  tx.add(
    createTransferCheckedInstruction(
      fromAta,
      mintPk,
      toAta,
      fromKeypair.publicKey,
      amount,
      USDT_DECIMALS,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  let signature;
  try {
    await acquireOutboundRpcSlot("SOLANA");
    signature = await sendAndConfirmTransaction(connection, tx, [fromKeypair], {
      commitment: "confirmed",
      maxRetries: 5,
    });
  } catch (e) {
    logger.error("solana sweep transfer failed", { walletId, err: String(e) });
    return { ok: false, error: "TRANSFER_FAILED", detail: String(e) };
  }

  logger.info("solana usdt swept", {
    walletId,
    from: wallet.address,
    to: master,
    amount: amount.toString(),
    signature,
  });

  return {
    ok: true,
    tx_hash: signature,
    amount_atomic: amount.toString(),
    from_address: wallet.address,
    to_address: master,
  };
}

/**
 * @returns {Promise<{ configured?: boolean, results: object[], summary: object }>}
 */
export async function sweepSolanaUsdtAll() {
  const { wallets, configured } = await listSolanaUsdtSweepTargets();
  if (!configured) {
    return {
      configured: false,
      results: [],
      summary: { attempted: 0, ok: 0, skipped: 0, failed: 0 },
    };
  }

  const results = [];
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const w of wallets) {
    const r = await sweepSolanaUsdtOne(w.id);
    if (r.ok) {
      if (r.skipped) {
        skipped += 1;
        results.push({
          wallet_id: w.id,
          status: "skipped",
          reason: r.reason,
          ...(r.from_address ? { from_address: r.from_address } : {}),
          ...(r.balance_atomic != null ? { balance_atomic: String(r.balance_atomic) } : {}),
          ...(r.detail ? { detail: r.detail } : {}),
        });
      } else {
        ok += 1;
        results.push({
          wallet_id: w.id,
          status: "swept",
          tx_hash: r.tx_hash,
          amount_atomic: r.amount_atomic,
        });
      }
    } else {
      failed += 1;
      results.push({
        wallet_id: w.id,
        status: "failed",
        error: r.error,
        detail: r.detail,
      });
    }
  }

  return {
    configured: true,
    results,
    summary: {
      attempted: wallets.length,
      ok,
      skipped,
      failed,
    },
  };
}
