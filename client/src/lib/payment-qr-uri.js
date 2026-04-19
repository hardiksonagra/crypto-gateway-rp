/**
 * QR payload for hosted checkout: when an expected USDT amount exists, encode a
 * wallet payment URI where supported; otherwise return the raw deposit address.
 *
 * EVM: EIP-681 style `ethereum:token@chainId/transfer?address=recipient&uint256=amount`.
 * TRON: `tron:recipient?amount=atomic&token=USDT_CONTRACT` (best-effort; wallets vary).
 */

/** USDT TRC20 (mainnet) contract base58 */
const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

/** @type {Record<string, { chainId: number, token: string }>} Prisma `Chain` → USDT token + EIP-155 chain id */
const USDT_EVM_BY_CHAIN = {
  ETH: {
    chainId: 1,
    token: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  },
  BNB: {
    chainId: 56,
    token: "0x55d398326f99059fF775485246999027B3197955",
  },
  POLYGON: {
    chainId: 137,
    token: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
  },
  ARBITRUM: {
    chainId: 42161,
    token: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  },
  OPTIMISM: {
    chainId: 10,
    token: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
  },
};

/**
 * @param {string} hex
 * @returns {string | null}
 */
function normalizeEvmAddress(hex) {
  const h = String(hex ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(h)) return null;
  return h.toLowerCase();
}

/**
 * @param {{ chainId: number, tokenHex: string, recipientHex: string, amountAtomic: string }} p
 * @returns {string | null}
 */
function eip681Erc20Transfer(p) {
  const token = normalizeEvmAddress(p.tokenHex);
  const recipient = normalizeEvmAddress(p.recipientHex);
  if (!token || !recipient) return null;
  if (!/^\d+$/.test(p.amountAtomic) || p.amountAtomic === "0") return null;
  const id = Math.floor(Number(p.chainId));
  if (!Number.isFinite(id) || id < 1) return null;
  return `ethereum:${token}@${id}/transfer?address=${recipient}&uint256=${p.amountAtomic}`;
}

/**
 * @param {string} recipientBase58
 * @param {string} amountAtomic
 * @returns {string | null}
 */
function tronUsdtPaymentUri(recipientBase58, amountAtomic) {
  const to = String(recipientBase58 ?? "").trim();
  if (!to || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(to)) return null;
  if (!/^\d+$/.test(amountAtomic) || amountAtomic === "0") return null;
  return `tron:${to}?amount=${amountAtomic}&token=${USDT_TRC20_CONTRACT}`;
}

/**
 * @param {{
 *   address: string,
 *   chain: string,
 *   currency: string,
 *   network: string,
 *   expected_amount_atomic?: string | null,
 * }} session
 * @returns {string}
 */
export function paymentQrEncodedValue(session) {
  const address = String(session.address ?? "").trim();
  const atomicRaw = session.expected_amount_atomic;
  const atomic =
    typeof atomicRaw === "string" && /^\d+$/.test(atomicRaw.trim())
      ? atomicRaw.trim()
      : "";

  if (!address || !atomic) return address;

  const currency = String(session.currency ?? "").trim().toUpperCase();
  const network = String(session.network ?? "").trim().toUpperCase();
  const chain = String(session.chain ?? "").trim().toUpperCase();

  if (currency !== "USDT") return address;

  if (network === "TRC20" && chain === "TRON") {
    return tronUsdtPaymentUri(address, atomic) ?? address;
  }

  /** @type {Record<string, { chainId: number, token: string }>} */
  const evmByRail = {
    "ETH|ERC20": USDT_EVM_BY_CHAIN.ETH,
    "BNB|BEP20": USDT_EVM_BY_CHAIN.BNB,
    "POLYGON|ERC20": USDT_EVM_BY_CHAIN.POLYGON,
    "ARBITRUM|ERC20": USDT_EVM_BY_CHAIN.ARBITRUM,
    "OPTIMISM|ERC20": USDT_EVM_BY_CHAIN.OPTIMISM,
  };
  const evm = evmByRail[`${chain}|${network}`];
  if (evm) {
    const uri = eip681Erc20Transfer({
      chainId: evm.chainId,
      tokenHex: evm.token,
      recipientHex: address,
      amountAtomic: atomic,
    });
    if (uri) return uri;
  }

  return address;
}
