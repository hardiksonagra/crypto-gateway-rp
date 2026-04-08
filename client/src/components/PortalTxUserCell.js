/**
 * End-user column for transaction / wallet lists: optional display name + external id.
 *
 * @param {object} props
 * @param {string | null | undefined} props.external_user_display_name
 * @param {string | null | undefined} props.external_user_id
 * @param {number | null | undefined} props.end_user_id
 * @param {string} [props.className]
 */
export function PortalTxUserCell({
  external_user_display_name,
  external_user_id,
  end_user_id,
  className = "",
}) {
  const name =
    typeof external_user_display_name === "string"
      ? external_user_display_name.trim()
      : "";
  const id =
    external_user_id != null && String(external_user_id).trim() !== ""
      ? String(external_user_id).trim()
      : "";
  const internal = end_user_id != null ? `#${end_user_id}` : "";
  const wrap = `max-w-[200px] ${className}`.trim();

  if (name && id) {
    return (
      <div className={wrap}>
        <span className="block truncate text-xs text-white/90">{name}</span>
        <span
          className="mt-0.5 block truncate font-mono text-[10px] text-white/35"
          title={id}
        >
          {id}
        </span>
      </div>
    );
  }
  if (name) {
    return (
      <span className={`block truncate text-xs text-white/90 ${className}`.trim()}>{name}</span>
    );
  }
  if (id) {
    return (
      <span
        className={`block max-w-[140px] truncate font-mono text-xs text-white/75 ${className}`.trim()}
        title={id}
      >
        {id}
      </span>
    );
  }
  if (internal) {
    return (
      <span
        className={`font-mono text-[10px] text-white/45 ${className}`.trim()}
        title="Internal user id"
      >
        {internal}
      </span>
    );
  }
  return <span className={`text-white/35 ${className}`.trim()}>—</span>;
}
