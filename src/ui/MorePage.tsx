import { Link } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  Bell,
  ChartNoAxesCombined,
  FileText,
  HardDriveDownload,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import type { AppData } from "./types";

const destinations = [
  {
    to: "/reports",
    title: "Reports",
    detail: "Collections, cash flow & loan performance",
    icon: ChartNoAxesCombined,
    tone: "purple",
  },
  {
    to: "/documents",
    title: "Agreements & receipts",
    detail: "Paperwork, signatures & account statements",
    icon: FileText,
    tone: "amber",
  },
  {
    to: "/activity",
    title: "Activity",
    detail: "Your notebook’s permanent audit trail",
    icon: Activity,
    tone: "green",
  },
  {
    to: "/settings?section=backup",
    title: "Backups & recovery",
    detail: "Export, restore & optional Google Drive",
    icon: HardDriveDownload,
    tone: "purple",
  },
  {
    to: "/reminders",
    title: "Payment reminders",
    detail: "Upcoming dues & courtesy period",
    icon: Bell,
    tone: "amber",
  },
  {
    to: "/settings",
    title: "Settings",
    detail: "Business details, loan defaults & preferences",
    icon: Settings2,
    tone: "green",
  },
];

export default function MorePage({ data }: { data: AppData }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h1>A little more control.</h1>
          <p>Everything you need to keep a thoughtful lending notebook.</p>
        </div>
      </div>
      <div className="more-grid">
        {destinations.map(({ to, title, detail, icon: Icon, tone }) => (
          <Link key={to} to={to} className="panel more-card">
            <span className={`more-icon ${tone}`}>
              <Icon size={23} />
            </span>
            <div>
              <h2>{title}</h2>
              <p>{detail}</p>
            </div>
            <ArrowUpRight size={18} />
          </Link>
        ))}
      </div>
      <section className="panel more-privacy">
        <ShieldCheck size={23} />
        <div>
          <h2>Your records stay with you.</h2>
          <p>
            {data.borrowers.length} borrower
            {data.borrowers.length === 1 ? "" : "s"} · {data.loans.length} loan
            {data.loans.length === 1 ? "" : "s"} · Saved on this browser. Keep
            an independent backup before moving devices or clearing browser
            data.
          </p>
        </div>
        <Link className="button" to="/settings?section=backup">
          Manage backups
          <ArrowUpRight size={15} />
        </Link>
      </section>
    </>
  );
}
