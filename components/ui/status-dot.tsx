import { cn } from "@/lib/utils";

const statusColor = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  neutral: "bg-muted-foreground/40",
} as const;

function StatusDot({
  status = "neutral",
  className,
}: {
  status?: keyof typeof statusColor;
  className?: string;
}) {
  return (
    <span
      data-slot="status-dot"
      className={cn("inline-block size-2 shrink-0 rounded-full", statusColor[status], className)}
    />
  );
}

export { StatusDot };
