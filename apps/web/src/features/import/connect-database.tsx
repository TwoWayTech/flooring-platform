"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Info, LoaderCircle, PlugZap } from "lucide-react";
import { toast } from "sonner";
import { importKind, type CompanyId, type ImportKind } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Panel } from "@workspace/ui/components/panel";
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Switch } from "@workspace/ui/components/switch";
import { Field } from "@/components/field";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import type { DatabaseEngine, DatabaseSample } from "@/lib/api/contract";
import { SampleTables } from "./sample-tables";

const ENGINES: Record<DatabaseEngine, { label: string; port: number }> = {
  sqlserver: { label: "SQL Server", port: 1433 },
  mysql: { label: "MySQL", port: 3306 },
  postgres: { label: "PostgreSQL", port: 5432 },
};

type Schedule = "once" | "nightly";

/** The table-to-kind choices a test starts with: each table's likely kind if the company has it, or left out. */
const suggestions = (sample: DatabaseSample, kinds: readonly ImportKind[]) =>
  Object.fromEntries(
    sample.tables.map((t) => [t.key, t.suggested && kinds.includes(t.suggested) ? t.suggested : null]),
  ) as Record<string, ImportKind | null>;

/**
 * Connect a database (spec G2): engine, server, database, a read-only user and SSL, then which
 * tables become which records, a preview of their rows, and a schedule. In the demo the test is
 * simulated with a sample dataset and nothing typed here is stored: the password stays in this
 * form and is cleared after the test.
 */
export function ConnectDatabase({ companyId, importHref }: { companyId: CompanyId; importHref: string }) {
  const [engine, setEngine] = useState<DatabaseEngine>("sqlserver");
  const [form, setForm] = useState({
    host: "",
    port: String(ENGINES.sqlserver.port),
    database: "",
    user: "",
    password: "",
  });
  const [ssl, setSsl] = useState(true);
  const [testing, setTesting] = useState(false);
  const [sample, setSample] = useState<DatabaseSample | null>(null);
  const [targets, setTargets] = useState<Record<string, ImportKind | null>>({});
  const [schedule, setSchedule] = useState<Schedule>("once");
  const overview = useApiQuery((client) => client.importOverview(companyId), [companyId]);
  const kinds = overview.data?.kinds ?? [];
  const field = (key: keyof typeof form) => ({
    id: `db-${key}`,
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });

  async function test(event: FormEvent) {
    event.preventDefault();
    setTesting(true);
    try {
      const found = await api.testDatabaseConnection(companyId, { engine, ssl, ...form, port: Number(form.port) });
      setSample(found);
      setTargets(suggestions(found, kinds));
      toast.success(`Connected to ${form.database}: ${found.tables.length} tables found`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The connection test did not work.");
    } finally {
      setTesting(false);
      setForm((f) => ({ ...f, password: "" }));
    }
  }

  return (
    <>
      <p
        role="note"
        className="border-hairline bg-brand-soft/40 flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm"
      >
        <Info aria-hidden="true" className="text-brand-ink mt-0.5 size-4 shrink-0" />
        <span>
          Live database connections run on the server in the full product. Here the test answers with a sample dataset,
          and nothing you type is stored in this browser.
        </span>
      </p>
      <Panel title="Connection">
        <form onSubmit={(e) => void test(e)} className="flex flex-col gap-4" aria-label="Database connection">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field id="db-engine" label="Engine">
              <Select
                value={engine}
                onValueChange={(v) => {
                  setEngine(v as DatabaseEngine);
                  setForm({ ...form, port: String(ENGINES[v as DatabaseEngine].port) });
                }}
              >
                <SelectTrigger id="db-engine" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ENGINES) as DatabaseEngine[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {ENGINES[key].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="db-host" label="Host">
              <Input {...field("host")} placeholder="db.example.internal" autoComplete="off" />
            </Field>
            <Field id="db-port" label="Port">
              <Input {...field("port")} inputMode="numeric" />
            </Field>
            <Field id="db-database" label="Database">
              <Input {...field("database")} autoComplete="off" />
            </Field>
            <Field id="db-user" label="Read-only user" hint="A user that can read, never write.">
              <Input {...field("user")} autoComplete="off" aria-describedby="db-user-hint" />
            </Field>
            <Field id="db-password" label="Password" hint="Used for this test only, never saved.">
              <Input
                {...field("password")}
                type="password"
                autoComplete="new-password"
                aria-describedby="db-password-hint"
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={ssl} onCheckedChange={setSsl} />
              Require SSL
            </label>
            <Button type="submit" disabled={testing}>
              {testing ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <PlugZap />}
              Test connection
            </Button>
          </div>
        </form>
      </Panel>
      {sample ? (
        <>
          <Panel title={`Tables in ${form.database || "the database"}`}>
            <p className="text-muted-foreground mb-3 text-sm">
              {sample.server}. Choose what each table becomes; preview its rows to check.
            </p>
            <SampleTables
              tables={sample.tables}
              kinds={kinds}
              targets={targets}
              onTarget={(key, kind) => setTargets({ ...targets, [key]: kind })}
            />
          </Panel>
          <Panel title="Schedule" bodyClassName="flex flex-col gap-4">
            <RadioGroup value={schedule} onValueChange={(v) => setSchedule(v as Schedule)} aria-label="Schedule">
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="once" className="mt-0.5" />
                <span>
                  <span className="font-medium">One-time migration</span>
                  <span className="text-muted-foreground block text-xs">Copy everything once, when you move over.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="nightly" className="mt-0.5" />
                <span>
                  <span className="font-medium">Nightly sync</span>
                  <span className="text-muted-foreground block text-xs">
                    Every night at 2:00 AM, copy the rows changed since the last run, by their updated-at column.
                  </span>
                </span>
              </label>
            </RadioGroup>
            <ul className="flex flex-col gap-1 text-sm">
              {sample.tables
                .filter((t) => targets[t.key])
                .map((t) => (
                  <li key={t.key}>
                    {t.name} becomes {importKind(targets[t.key]!).label.toLowerCase()},{" "}
                    {schedule === "once" ? "copied once" : "kept in step every night"}.
                  </li>
                ))}
            </ul>
            <p className="text-muted-foreground text-sm">
              The simplest path today: export these tables to CSV or Excel and bring them in with{" "}
              <Link href={importHref} className="text-brand-ink underline underline-offset-4">
                Data import
              </Link>
              .
            </p>
          </Panel>
        </>
      ) : null}
    </>
  );
}
