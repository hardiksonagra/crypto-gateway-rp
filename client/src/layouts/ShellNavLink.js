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
        `sidebar-nav-link flex items-center gap-3 rounded-xl border-l-2 py-2.5 text-sm font-medium ${
          collapsed
            ? "justify-start pl-3 pr-3 md:justify-center md:gap-0 md:px-0"
            : "pl-3 pr-3"
        } ${isActive ? "active" : "border-transparent"}`
      }
    >
      <Icon />
      {!collapsed && <span>{label}</span>}
      {collapsed && <span className="sr-only">{label}</span>}
    </NavLink>
  );
}
