/** Site name shown in alt text and metadata. */
export const SITE_NAME = "CryptoVapay";

/**
 * Brand images from `client/public`: `favicon.png` (mark), `logo.png` (full wordmark).
 * @param {{ variant?: "icon" | "full"; className?: string; alt?: string }} props
 */
export function BrandMark({ variant = "full", className = "", alt = SITE_NAME }) {
  const src = variant === "icon" ? "/favicon.png" : "/logo.png";
  const base =
    variant === "icon"
      ? "h-[4.5rem] w-[4.5rem] shrink-0 object-contain"
      : "h-[4.5rem] max-h-[5.5rem] w-auto max-w-[min(520px,90vw)] shrink-0 object-contain object-left";
  return (
    <img
      src={src}
      alt={alt}
      className={`${base} ${className}`.trim()}
      width={variant === "icon" ? 72 : undefined}
      height={variant === "icon" ? 72 : undefined}
      decoding="async"
    />
  );
}
