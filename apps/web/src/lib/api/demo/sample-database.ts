import type { DatabaseEngine, DatabaseSample, DatabaseTestInput, SampleTable } from "../contract";
import { DemoRuleError } from "./admin-rules";

const SCHEMA: Record<DatabaseEngine, (table: string) => string> = {
  sqlserver: (t) => `dbo.${t.replace(/(^|_)(\w)/g, (_, __, c: string) => c.toUpperCase())}`,
  mysql: (t) => `shop.${t}`,
  postgres: (t) => `public.${t}`,
};

const VERSION: Record<DatabaseEngine, string> = {
  sqlserver: "SQL Server 2022",
  mysql: "MySQL 8.4",
  postgres: "PostgreSQL 17",
};

/** An invented legacy database: the tables a flooring business typically keeps, with a few rows each. */
const TABLES: Omit<SampleTable, "name">[] = [
  {
    key: "customers",
    rows: 1284,
    suggested: "customers",
    columns: ["cust_no", "name", "email", "phone", "terms", "updated_at"],
    sample: [
      ["C10041", "Maple Row Builders", "orders@maplerow.example", "(303) 555-0142", "NET30", "2026-10-28 16:02"],
      ["C10042", "Avery Collins", "avery.collins@mail.example", "(720) 555-0188", "COD", "2026-10-30 09:41"],
      ["C10043", "Granite Peak Homes", "ap@granitepeak.example", "(719) 555-0107", "NET30", "2026-11-02 11:15"],
    ],
  },
  {
    key: "items",
    rows: 612,
    suggested: "products",
    columns: ["item_code", "description", "category", "uom", "price", "cost"],
    sample: [
      ["RW-5001", "Harbor Oak Wide Plank", "LVP", "CTN", "89.95", "54.10"],
      ["BL-3100", "Meadow Twist Broadloom", "CARPET", "SY", "32.50", "18.40"],
      ["CT-2210", "Brushed Nickel Reducer", "TRIM", "EA", "24.50", "11.20"],
    ],
  },
  {
    key: "vendors",
    rows: 41,
    suggested: "suppliers",
    columns: ["vendor_id", "vendor_name", "email", "terms"],
    sample: [
      ["V201", "Ridgeway Flooring Supply", "orders@ridgeway.example", "NET30"],
      ["V202", "Cobalt Trim Works", "sales@cobalttrim.example", "NET60"],
      ["V203", "Prairie Pad and Underlay", "hello@prairiepad.example", "MONTHLY"],
    ],
  },
  {
    key: "open_invoices",
    rows: 148,
    suggested: "invoices",
    columns: ["invoice_no", "cust_no", "invoice_date", "due_date", "balance"],
    sample: [
      ["40871", "C10041", "2026-09-12", "2026-10-12", "4820.00"],
      ["40902", "C10043", "2026-10-03", "2026-11-02", "1275.50"],
      ["40915", "C10042", "2026-10-21", "2026-10-21", "389.00"],
    ],
  },
  {
    key: "audit_trail",
    rows: 210448,
    suggested: null,
    columns: ["id", "table_name", "action", "changed_at"],
    sample: [
      ["991201", "customers", "UPDATE", "2026-11-02 11:15"],
      ["991202", "items", "INSERT", "2026-11-02 11:20"],
      ["991203", "open_invoices", "UPDATE", "2026-11-02 11:22"],
    ],
  },
];

/**
 * The simulated connection test (spec G2): checks the fields a real test needs, then answers
 * with the sample tables, named the way the chosen engine names them. Nothing connects and
 * nothing is stored; the password never reaches this call.
 */
export function sampleDatabase(input: DatabaseTestInput): DatabaseSample {
  if (!input.host.trim()) throw new DemoRuleError("Give the server's host name or address.");
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new DemoRuleError("The port is a number from 1 to 65535.");
  }
  if (!input.database.trim()) throw new DemoRuleError("Give the database name.");
  if (!input.user.trim()) throw new DemoRuleError("Give the read-only user name.");
  return {
    server: `${VERSION[input.engine]}, sample data`,
    tables: TABLES.map((t) => ({ ...t, name: SCHEMA[input.engine](t.key) })),
  };
}
