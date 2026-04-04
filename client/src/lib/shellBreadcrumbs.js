/**
 * @typedef {{ label: string, to?: string }} BreadcrumbItem
 */

/**
 * @param {string} pathname
 * @param {{ merchantCrumb: { id: string, label: string } | null }} extras
 * @returns {BreadcrumbItem[]}
 */
export function buildAdminBreadcrumbs(pathname, extras) {
  const norm = pathname.replace(/\/$/, "") || "/control";
  const items = /** @type {BreadcrumbItem[]} */ ([
    { label: "Admin", to: "/control" },
  ]);

  if (norm === "/control") {
    items.push({ label: "Dashboard" });
    return items;
  }

  const rest = norm.replace(/^\/control\/?/, "").split("/").filter(Boolean);

  if (rest[0] === "merchants") {
    if (!rest[1]) {
      items.push({ label: "Merchants" });
      return items;
    }
    items.push({ label: "Merchants", to: "/control/merchants" });
    if (rest[1] === "new") {
      items.push({ label: "New merchant" });
      return items;
    }
    const id = rest[1];
    const label =
      extras.merchantCrumb?.id === id && extras.merchantCrumb.label
        ? extras.merchantCrumb.label
        : "Merchant";
    if (rest[2] === "edit") {
      items.push({ label, to: `/control/merchants/${id}` });
      items.push({ label: "Edit" });
    } else {
      items.push({ label });
    }
    return items;
  }

  const tailMap = {
    users: { label: "Users", to: "/control/users" },
    wallets: { label: "All wallets", to: "/control/wallets" },
    "wallet-details": { label: "Wallet details", to: "/control/wallet-details" },
    transactions: { label: "Transactions", to: "/control/transactions" },
    settlements: { label: "Settlements", to: "/control/settlements" },
    sweep: { label: "Sweep", to: "/control/sweep" },
    activity: { label: "Activity log", to: "/control/activity" },
    settings: { label: "System settings", to: "/control/settings" },
    profile: { label: "Profile", to: "/control/profile" },
    "decode-gateway-data": { label: "Decode gateway data", to: "/control/decode-gateway-data" },
  };

  const key = rest[0];
  const mapped = tailMap[/** @type {keyof typeof tailMap} */ (key)];
  if (mapped) {
    items.push({ label: mapped.label });
    return items;
  }

  items.push({ label: "Page" });
  return items;
}

/**
 * @param {string} pathname
 * @returns {BreadcrumbItem[]}
 */
export function buildMerchantBreadcrumbs(pathname) {
  const norm = pathname.replace(/\/$/, "") || "/";
  const items = /** @type {BreadcrumbItem[]} */ ([
    { label: "Merchant", to: "/" },
  ]);

  if (norm === "/") {
    items.push({ label: "Dashboard" });
    return items;
  }

  const rest = norm.replace(/^\//, "").split("/").filter(Boolean);
  const key = rest[0];

  const map = {
    users: "Users",
    wallets: "Wallets",
    transactions: "Transactions",
    settlements: "Settlements",
    settings: "Gateway & webhooks",
    "api-key": "API key",
    docs: "Doc",
    profile: "Profile",
  };

  const label = map[/** @type {keyof typeof map} */ (key)];
  if (label) {
    items.push({ label });
    return items;
  }

  items.push({ label: "Page" });
  return items;
}
