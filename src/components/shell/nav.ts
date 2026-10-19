import {
  Activity, BarChart3, BookOpen, CalendarDays, CheckSquare, Cog, FlaskConical, Gauge, Image as ImageIcon, Layers,
  Lightbulb, MessagesSquare, PenLine, Plug, Radar, Send, Swords, Users, Workflow,
} from "lucide-react";

/**
 * Left navigation (brief §5). Groups follow the flywheel: understand → make → ship and learn → system.
 * `mvp` marks sections with v0.1 functionality; the others render an honest "planned" state.
 */
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  slug: string;
  label: string;
  icon: LucideIcon;
}

export const NAV: ReadonlyArray<{ group: string; items: ReadonlyArray<NavItem> }> = [
  {
    group: "Understand",
    items: [
      { slug: "overview", label: "Overview", icon: Gauge },
      { slug: "products", label: "Products", icon: Layers },
      { slug: "knowledge", label: "Knowledge", icon: BookOpen },
      { slug: "audience", label: "Audience & AJTBD", icon: Users },
      { slug: "competitors", label: "Competitors", icon: Swords },
      { slug: "signals", label: "Signals & Research", icon: Radar },
    ],
  },
  {
    group: "Make",
    items: [
      { slug: "ideas", label: "Hooks & Ideas", icon: Lightbulb },
      { slug: "studio", label: "Content Studio", icon: PenLine },
      { slug: "creatives", label: "Creative Library", icon: ImageIcon },
      { slug: "calendar", label: "Calendar", icon: CalendarDays },
      { slug: "approvals", label: "Approval Queue", icon: CheckSquare },
    ],
  },
  {
    group: "Ship and learn",
    items: [
      { slug: "publications", label: "Publications", icon: Send },
      { slug: "conversations", label: "Conversations", icon: MessagesSquare },
      { slug: "experiments", label: "Experiments", icon: FlaskConical },
      { slug: "analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    group: "System",
    items: [
      { slug: "connections", label: "Connections", icon: Plug },
      { slug: "automations", label: "Automations", icon: Workflow },
      { slug: "activity", label: "Activity Log", icon: Activity },
      { slug: "settings", label: "Settings", icon: Cog },
    ],
  },
];
