/**
 * Last path segment for BIP44 `m/44'/{coin}'/0'/0/{i}` style derivation.
 *
 * PostgreSQL `users.account_index` SERIAL starts at 1; Trust Wallet’s first account uses `i = 0`.
 * So **new** users (no wallets yet) use `accountIndex - 1`.
 * Users created before this mapping already have `wallets.derivation_index` matching on-chain keys — reuse it.
 *
 * @param {number} accountIndex — `users.account_index`
 * @param {Array<{ derivationIndex: number }>} existingWallets
 * @returns {number}
 */
export function resolveBip44AddressIndex(accountIndex, existingWallets) {
  if (existingWallets?.length) {
    return existingWallets[0].derivationIndex;
  }
  const i = accountIndex - 1;
  if (i < 0) throw new Error("INVALID_ACCOUNT_INDEX");
  return i;
}
