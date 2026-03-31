import { useLocation } from "react-router-dom";
import Breadcrumbs from "./Breadcrumbs.js";
import { useBreadcrumbExtras } from "../contexts/BreadcrumbExtrasContext.js";
import {
  buildAdminBreadcrumbs,
  buildMerchantBreadcrumbs,
} from "../lib/shellBreadcrumbs.js";

/**
 * Auto trail from pathname + optional merchant detail label (admin).
 *
 * @param {object} props
 * @param {"admin" | "merchant"} props.variant Which app routes to map (admin vs merchant paths).
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
      : buildMerchantBreadcrumbs(pathname);

  return (
    <Breadcrumbs
      items={items}
      variant={uiVariant ?? variant}
      className={className}
    />
  );
}
