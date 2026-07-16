import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardContent className="flex flex-col gap-1">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <span className="text-2xl font-semibold">{value}</span>
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </CardContent>
    </Card>
  );
}
