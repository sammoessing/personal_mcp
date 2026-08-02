"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  setDocReviewStateAction,
  setDocMcpExposedAction,
  deleteDocAction,
} from "@/lib/actions/brain";
import { DOC_REVIEW_STATES, type DocReviewState } from "@/lib/brain/types";

export function DocReviewSelect({
  slug,
  reviewState,
}: {
  slug: string;
  reviewState: DocReviewState;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Select
      value={reviewState}
      disabled={isPending}
      onValueChange={(value) =>
        startTransition(() => setDocReviewStateAction(slug, value as DocReviewState))
      }
    >
      <SelectTrigger size="sm" className="w-32 capitalize">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DOC_REVIEW_STATES.map((state) => (
          <SelectItem key={state} value={state} className="capitalize">
            {state}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DocExposureToggle({ slug, exposed }: { slug: string; exposed: boolean }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Switch
      checked={exposed}
      disabled={isPending}
      onCheckedChange={(checked) => startTransition(() => setDocMcpExposedAction(slug, checked))}
    />
  );
}

export function DeleteDocButton({ slug }: { slug: string }) {
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm("Delete this doc? This can't be undone.")) return;
    startTransition(() => deleteDocAction(slug));
  }

  return (
    <Button variant="outline" size="sm" onClick={handleDelete} disabled={isPending}>
      <Trash2 className="size-3.5" />
      Delete
    </Button>
  );
}
