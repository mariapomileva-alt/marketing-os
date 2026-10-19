"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/form";
import { CSV_TARGETS, type CsvPreviewResult } from "@/lib/csv-preview";
import type { ActionResult } from "@/lib/action-result";

/** Two steps: upload → confirm the column mapping (with a sample) → import. Nothing is imported before you confirm. */
export function CsvImport({
  kind, preview, commit, extraFields,
}: {
  kind: "metrics" | "conversions" | "ads";
  preview: (prev: CsvPreviewResult | null, data: FormData) => Promise<CsvPreviewResult>;
  commit: (prev: ActionResult | null, data: FormData) => Promise<ActionResult>;
  extraFields?: React.ReactNode;
}) {
  const [p, previewAction, previewing] = useActionState(preview, null);
  const [c, commitAction, committing] = useActionState(commit, null);
  const pv = p?.preview;
  return (
    <div className="flex flex-col gap-3">
      <form action={previewAction} className="flex flex-wrap items-end gap-3">
        <Field label="CSV file" htmlFor={`${kind}-file`}><Input id={`${kind}-file`} name="file" type="file" accept=".csv,text/csv" required className="h-auto py-1.5" /></Field>
        {extraFields}
        <Button type="submit" disabled={previewing}>{previewing ? "Reading…" : "Check columns"}</Button>
      </form>
      {p && !p.ok ? <FormMessage state={p} /> : null}
      {pv && !c?.ok ? (
        <form action={commitAction} className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-line bg-paper/50 p-3">
          <p className="text-[13px]">{pv.rows} rows found. Check what each column means, then import.</p>
          <input type="hidden" name="csv" value={pv.csv} />
          {Object.entries(pv.extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <div className="overflow-x-auto">
            <table className="text-left text-[12.5px]">
              <thead>
                <tr>{pv.header.map((h) => (
                  <th key={h} className="min-w-[140px] p-1.5 align-bottom font-normal">
                    <span className="block truncate text-muted" title={h}>{h}</span>
                    <Select name={`map:${h}`} defaultValue={pv.mapping[h] ?? ""} aria-label={`Meaning of column ${h}`} className="mt-1 h-7 text-[12.5px]">
                      <option value="">Ignore</option>
                      {CSV_TARGETS[kind].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                  </th>
                ))}</tr>
              </thead>
              <tbody>{pv.sample.map((r, i) => <tr key={i}>{pv.header.map((_, j) => <td key={j} className="max-w-[200px] truncate border-t border-line p-1.5">{r[j]}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div><Button type="submit" variant="primary" disabled={committing}>{committing ? "Importing…" : `Import ${pv.rows} rows`}</Button></div>
        </form>
      ) : null}
      <FormMessage state={c} />
    </div>
  );
}
