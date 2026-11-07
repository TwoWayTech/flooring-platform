import type { SellUnit } from "../units";
import type { Address } from "./company";

/** An installation crew (W-2) or subcontractor (1099). */
export interface Crew {
  id: string;
  name: string;
  kind: "crew" | "subcontractor";
  lead: string;
  members: string[];
  phone: string;
}

/** Job lifecycle. */
export type JobStatus = "scheduled" | "in_progress" | "completed" | "signed_off";

/** An installation job with its costing. Margin is sensitive (installation.job.view_sensitive). */
export interface Job {
  id: string;
  number: string;
  customerId: string;
  invoiceId: string | null;
  crewId: string;
  date: string;
  startHour: number;
  durationHours: number;
  status: JobStatus;
  address: Address;
  scope: string;
  materials: { description: string; quantity: string; unit: SellUnit; cost: string }[];
  laborHours: string;
  laborCost: string;
  revenue: string;
  photos: { id: string; caption: string; tone: string }[];
  signedOffAt: string | null;
  signedBy: string | null;
  notes: string;
}
