import { BrainCircuit } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function BrainPage() {
  return (
    <>
      <PageHeader title="Brain" description="Persistent context and memory for your skills." />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-secondary">
            <BrainCircuit className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Coming soon</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Long-term memory that skills and MCP tools can read from and write to across sessions.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
