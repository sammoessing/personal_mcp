import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DOC_KINDS, DOC_SCOPES, KIND_DESCRIPTION, type BrainDoc } from "@/lib/brain/types";

/**
 * Shared field set for creating and editing a brain doc. Native selects keep
 * this a server component so it can be dropped straight into a form action.
 */
export function DocFormFields({
  doc,
  folderPath,
  folderOptions,
}: {
  doc?: Pick<BrainDoc, "title" | "kind" | "scope" | "content">;
  folderPath?: string | null;
  folderOptions: string[];
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          required
          defaultValue={doc?.title}
          placeholder="How we run client kickoffs"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="kind">Kind</Label>
          <select
            id="kind"
            name="kind"
            defaultValue={doc?.kind ?? "knowledge"}
            className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            {DOC_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {KIND_DESCRIPTION[doc?.kind ?? "knowledge"]}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="scope">Scope</Label>
          <select
            id="scope"
            name="scope"
            defaultValue={doc?.scope ?? "user"}
            className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            {DOC_SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {scope}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="folder">Folder</Label>
        <Input
          id="folder"
          name="folder"
          list="brain-folder-options"
          defaultValue={folderPath ?? ""}
          placeholder="Clients/Acme — leave blank to keep unfiled"
        />
        <datalist id="brain-folder-options">
          {folderOptions.map((path) => (
            <option key={path} value={path} />
          ))}
        </datalist>
        <p className="text-xs text-muted-foreground">
          Slash-separated path. A new path creates the folder.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="content">Content (markdown)</Label>
        <Textarea
          id="content"
          name="content"
          rows={16}
          className="font-mono text-xs"
          defaultValue={doc?.content}
          placeholder={"# Overview\n\nLink other docs with [[doc-slug]]."}
        />
      </div>
    </>
  );
}
