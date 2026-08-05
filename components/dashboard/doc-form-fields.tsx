"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DOC_KINDS, DOC_SCOPES, KIND_DESCRIPTION, type BrainDoc } from "@/lib/brain/types";
import { DocImport } from "./doc-import";

/**
 * Shared field set for creating and editing a brain doc. A client component
 * because title and content are controlled — importing a file rewrites them —
 * but it still submits through the parent's server action.
 */
export function DocFormFields({
  doc,
  folderPath,
  folderOptions,
}: {
  doc?: Pick<BrainDoc, "title" | "description" | "kind" | "scope" | "content">;
  folderPath?: string | null;
  folderOptions: string[];
}) {
  const [title, setTitle] = useState(doc?.title ?? "");
  const [description, setDescription] = useState(doc?.description ?? "");
  const [content, setContent] = useState(doc?.content ?? "");

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="How we run client kickoffs"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Use this when quoting a plumbing callout or explaining our pricing tiers."
        />
        <p className="text-xs text-muted-foreground">
          This is what an agent reads to decide whether to open the document, so describe the trigger — when to use it — not what it contains.
        </p>
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
        <DocImport
          onImported={(result) => {
            setContent(result.text);
            setTitle((current) => current || result.suggestedTitle);
          }}
        />
        <Textarea
          id="content"
          name="content"
          rows={16}
          className="font-mono text-xs"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={"# Overview\n\nLink other docs with [[doc-slug]]."}
        />
        <p className="text-xs text-muted-foreground">
          Importing replaces everything below with the file&apos;s text.
        </p>
      </div>
    </>
  );
}
