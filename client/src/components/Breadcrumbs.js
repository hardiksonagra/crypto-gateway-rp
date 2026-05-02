import { Link } from "react-router-dom";

/**
 * @typedef {{ label: string, to?: string }} BreadcrumbItem
 */

/**
 * @param {object} props
 * @param {BreadcrumbItem[]} props.items
 * @param {"admin" | "merchant"} [props.variant] RP shell uses `"admin"` styling via `ShellBreadcrumbs`.
 * @param {string} [props.className]
 */
export default function Breadcrumbs({ items, variant = "admin", className = "" }) {
  if (!items?.length) return null;

  const isMerchant = variant === "merchant";
  const sepClass = isMerchant ? "text-white/30" : "";
  const sepStyle = !isMerchant ? { color: "var(--text-3)" } : undefined;
  const currentClass = isMerchant ? "text-white/75" : "";
  const currentStyle = !isMerchant ? { color: "var(--text-2)" } : undefined;
  const linkClass = isMerchant
    ? "text-sky-300/90 underline-offset-2 transition hover:text-sky-200 hover:underline"
    : "underline-offset-2 transition hover:underline";
  const linkStyle = !isMerchant
    ? { color: "var(--link-active-color, #818cf8)" }
    : undefined;

  return (
    <nav
      aria-label="Breadcrumb"
      className={`text-xs font-medium sm:text-sm ${className}`.trim()}
    >
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          const showSep = i > 0;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {showSep ? (
                <span
                  className={`select-none ${sepClass}`.trim()}
                  style={sepStyle}
                  aria-hidden
                >
                  /
                </span>
              ) : null}
              {isLast || !item.to ? (
                <span
                  className={`max-w-[min(100vw-8rem,28rem)] truncate ${currentClass}`.trim()}
                  style={currentStyle}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  to={item.to}
                  className={`max-w-[min(100vw-8rem,28rem)] truncate ${linkClass}`.trim()}
                  style={linkStyle}
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
