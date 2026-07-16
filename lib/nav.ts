import {
  LayoutGrid,
  Sparkles,
  BrainCircuit,
  Share2,
  Plug,
  KeyRound,
  ScrollText,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/", icon: LayoutGrid },
  { label: "Skills", href: "/skills", icon: Sparkles },
  { label: "Brain", href: "/brain", icon: BrainCircuit },
  { label: "MCP Gateway", href: "/mcp-gateway", icon: Share2 },
  { label: "Connections", href: "/connections", icon: Plug },
  { label: "Vault", href: "/vault", icon: KeyRound },
  { label: "Audit", href: "/audit", icon: ScrollText },
];
