/**
 * Explorer pool rails shown in Admin (tabs) and accepted by deposit-scanner API routes.
 * When adding a new product rail: extend Prisma enum `DepositScannerExplorerRail`, migrate DB,
 * wire worker + `deposit-scanner-explorer-key-pool.js` (`prismaRail`), then append here.
 *
 * @typedef {{ id: string, label: string }} DepositScannerExplorerRailTab
 */

/** @type {DepositScannerExplorerRailTab[]} */
export const DEPOSIT_SCANNER_EXPLORER_RAIL_TABS = [
  { id: "erc20", label: "USDT · ERC20 (Etherscan)" },
  { id: "trc20", label: "USDT · TRC20 (TronScan)" },
];

/** @type {string[]} */
export const DEPOSIT_SCANNER_EXPLORER_RAIL_IDS = DEPOSIT_SCANNER_EXPLORER_RAIL_TABS.map(
  (t) => t.id,
);

/**
 * @param {unknown} v
 * @returns {string | null} normalized rail id or null
 */
export function parseDepositScannerExplorerRailParam(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return DEPOSIT_SCANNER_EXPLORER_RAIL_IDS.includes(s) ? s : null;
}
