import { useLocation } from "react-router-dom";
import Breadcrumbs from "./Breadcrumbs.js";
import { useBreadcrumbExtras } from "../contexts/BreadcrumbExtrasContext.js";
import {
  buildAdminBreadcrumbs,
  buildMerchantBreadcrumbs,
  buildRpBreadcrumbs,
} from "../lib/shellBreadcrumbs.js";

/**
 * Auto trail from pathname + optional merchant detail label (admin).
 *
 * @param {object} props
 * @param {"admin" | "merchant" | "rp"} props.variant Which app routes to map (admin vs merchant vs RP paths).
 * @param {"admin" | "merchant"} [props.uiVariant] Breadcrumb colors; defaults to `variant`. Use `"admin"` for theme-aware shell top bar on merchant.
 * @param {string} [props.className]
 */
export default function ShellBreadcrumbs({
  variant,
  uiVariant,
  className = "",
}) {
  const { pathname } = useLocation();
  const { merchantCrumb } = useBreadcrumbExtras();

  const items =
    variant === "admin"
      ? buildAdminBreadcrumbs(pathname, { merchantCrumb })
      : variant === "rp"
        ? buildRpBreadcrumbs(pathname, { merchantCrumb })
        : buildMerchantBreadcrumbs(pathname);

  const breadcrumbVariant =
    uiVariant ?? (variant === "rp" ? "admin" : variant);

  return (
    <Breadcrumbs
      items={items}
      variant={breadcrumbVariant}
      className={className}
    />
  );
}
