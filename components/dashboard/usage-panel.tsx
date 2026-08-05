import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type DayBar = { label: string; value: number };
export type UsageRow = { name: string; uses: number };

function Delta({ value }: { value: number }) {
  const sign = value > 0 ? "+" : "";
  return (
    <span className={cn("text-xs", value > 0 ? "text-success" : "text-muted-foreground")}>
      {sign}
      {value.toLocaleString()} vs prior week
    </span>
  );
}

/**
 * Bars are sized against the busiest day rather than a fixed scale, so a quiet
 * week still shows shape instead of a flat line.
 */
function Bars({ bars }: { bars: DayBar[] }) {
  const peak = Math.max(1, ...bars.map((bar) => bar.value));
  return (
    <div className="flex items-end gap-2 border-b pb-2">
      {bars.map((bar, index) => (
        <div key={index} className="flex flex-1 flex-col items-center gap-1.5">
          <div
            className="w-full rounded-sm bg-secondary"
            style={{ height: `${Math.max(6, Math.round((bar.value / peak) * 56))}px` }}
            title={`${bar.value} on ${bar.label}`}
          />
          <span className="text-[10px] text-muted-foreground">{bar.label}</span>
        </div>
      ))}
    </div>
  );
}

export function UsagePanel({
  icon,
  title,
  primary,
  secondary,
  bars,
  listTitle,
  rows,
  emptyText,
}: {
  icon: React.ReactNode;
  title: string;
  primary: { label: string; value: number; delta: number };
  secondary: { label: string; value: number; delta: number };
  bars: DayBar[];
  listTitle: string;
  rows: UsageRow[];
  emptyText: string;
}) {
  return (
    <Card className="p-0">
      <CardContent className="flex flex-col gap-5 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {icon}
            <span className="text-sm font-medium">{title}</span>
          </div>
          <span className="text-xs text-muted-foreground">last 7 days</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {[primary, secondary].map((metric) => (
            <div key={metric.label} className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {metric.label}
              </span>
              <span className="text-2xl font-semibold text-success">
                {metric.value.toLocaleString()}
              </span>
              <Delta value={metric.delta} />
            </div>
          ))}
        </div>

        <Bars bars={bars} />

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {listTitle}
          </span>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            rows.map((row) => (
              <div key={row.name} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{row.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {row.uses.toLocaleString()} uses
                </span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
