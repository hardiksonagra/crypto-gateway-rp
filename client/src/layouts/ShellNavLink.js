import { NavLink } from "react-router-dom";

/**
 * @param {{ to: string; end?: boolean; label: string; Icon: import("react").ComponentType<{ className?: string }>; collapsed: boolean; onPick?: () => void }} p
 */
export function ShellNavLink({ to, end, label, Icon, collapsed, onPick }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      onClick={onPick}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg border-l-2 py-2.5 text-sm font-medium transition ${
          collapsed
            ? "justify-start pl-3 pr-3 md:justify-center md:gap-0 md:px-0"
            : "justify-start pl-3 pr-3"
        } ${
          isActive
            ? "border-zinc-400 bg-white/8 text-white"
            : "border-transparent text-white/45 hover:bg-white/5 hover:text-white/90"
        }`
      }
    >
      <Icon />
      <span className={collapsed ? "md:sr-only" : ""}>{label}</span>
    </NavLink>
  );
}
