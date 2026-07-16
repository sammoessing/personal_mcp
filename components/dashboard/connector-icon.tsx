import { Code2, Layers, Calendar, Mail, FileText, MessageSquare, Users, type LucideIcon } from "lucide-react";
import type { ConnectorProvider } from "@/lib/connectors/registry";

const ICONS: Record<ConnectorProvider, LucideIcon> = {
  github: Code2,
  linear: Layers,
  google_calendar: Calendar,
  gmail: Mail,
  notion: FileText,
  slack: MessageSquare,
  discord: Users,
};

export function ConnectorIcon({ provider, className }: { provider: ConnectorProvider; className?: string }) {
  const Icon = ICONS[provider];
  return <Icon className={className} />;
}
