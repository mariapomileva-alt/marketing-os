import {
  Activity, AtSign, BarChart3, BookOpen, CalendarDays, CheckSquare, Cog, FlaskConical, Image as ImageIcon, Layers, Sun,
  Clapperboard, Lightbulb, MessagesSquare, PenLine, Plug, Radar, Send, Swords, Users, Workflow,
} from "lucide-react";

/**
 * Left navigation. Ordered by how often the owner needs a place: today, daily work, creating, results, what we know, setup.
 * `mvp` marks sections with v0.1 functionality; the others render an honest "planned" state.
 */
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  slug: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
}

export const NAV: ReadonlyArray<{ group: string; items: ReadonlyArray<NavItem> }> = [
  {
    group: "",
    items: [{ slug: "overview", label: "Today", icon: Sun, hint: "Morning brief: what worked, what to do today" }],
  },
  {
    group: "Every day",
    items: [
      { slug: "approvals", label: "Approve", icon: CheckSquare, hint: "Everything waiting for your yes before it goes out" },
      { slug: "threads", label: "Threads", icon: AtSign, hint: "Our own Threads posts: approve today's, see what works" },
      { slug: "conversations", label: "Conversations", icon: MessagesSquare, hint: "Comments and replies on YouTube, Threads, Instagram" },
      { slug: "calm", label: "Calm Videos", icon: Clapperboard, hint: "Long calm videos, shorts and reels" },
    ],
  },
  {
    group: "Create",
    items: [
      { slug: "studio", label: "Posts", icon: PenLine, hint: "Write and edit posts (Content Studio)" },
      { slug: "ideas", label: "Ideas & hooks", icon: Lightbulb, hint: "Topics and first lines to try" },
      { slug: "creatives", label: "Media library", icon: ImageIcon, hint: "Videos, music and images we can use" },
      { slug: "calendar", label: "Calendar", icon: CalendarDays, hint: "What goes out when" },
    ],
  },
  {
    group: "Results",
    items: [
      { slug: "analytics", label: "Analytics", icon: BarChart3, hint: "Site visitors, sources, articles, AI assistants" },
      { slug: "publications", label: "Published", icon: Send, hint: "Everything that went out, with its numbers" },
      { slug: "experiments", label: "Experiments", icon: FlaskConical, hint: "Tests: which version works better" },
    ],
  },
  {
    group: "What we know",
    items: [
      { slug: "knowledge", label: "Knowledge", icon: BookOpen, hint: "Our articles and methodology the AI writes from" },
      { slug: "products", label: "Product & rules", icon: Layers, hint: "Facts about the product, its brief and the safety rules" },
      { slug: "audience", label: "Audience", icon: Users, hint: "Who our people are and what they need" },
      { slug: "competitors", label: "Competitors", icon: Swords, hint: "Who else helps with panic, and what they do" },
      { slug: "signals", label: "Research", icon: Radar, hint: "Saved posts and observations from the market" },
    ],
  },
  {
    group: "Setup",
    items: [
      { slug: "connections", label: "Connections", icon: Plug, hint: "YouTube, Threads, Instagram, AI keys" },
      { slug: "automations", label: "Automations", icon: Workflow, hint: "What runs by itself and when" },
      { slug: "activity", label: "Activity log", icon: Activity, hint: "Every action, who did it and when" },
      { slug: "settings", label: "Settings", icon: Cog, hint: "Workspace settings" },
    ],
  },
];
