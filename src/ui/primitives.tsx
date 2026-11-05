import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Info, X, ArrowUpRight, Check, LoaderCircle } from "lucide-react";
import { info } from "./info";
import type { InfoKey } from "./info";
import type { Borrower } from "../core/model";
import { formatMoney } from "../core/logic";
export function Help({ topic }: { topic: InfoKey }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="help">
      <button
        type="button"
        aria-label={`About ${topic}`}
        onClick={() => setOpen(!open)}
      >
        <Info size={14} />
      </button>
      {open && (
        <span role="tooltip" className="popover">
          {info[topic]}
          <button
            type="button"
            aria-label="Close explanation"
            onClick={() => setOpen(false)}
          >
            <X size={14} />
          </button>
        </span>
      )}
    </span>
  );
}
export function Money({
  amount,
  className = "",
}: {
  amount: number;
  className?: string;
}) {
  return <span className={`money ${className}`}>{formatMoney(amount)}</span>;
}
export function Avatar({
  borrower,
  size = "",
}: {
  borrower: Pick<Borrower, "fullName" | "photo" | "numericId">;
  size?: string;
}) {
  const [url, setURL] = useState("");
  useEffect(() => {
    if (!borrower.photo) {
      setURL("");
      return;
    }
    const u = URL.createObjectURL(borrower.photo);
    setURL(u);
    return () => URL.revokeObjectURL(u);
  }, [borrower.photo]);
  return (
    <span className={`avatar ${size} tone-${borrower.numericId % 5}`}>
      {url ? (
        <img src={url} alt="" />
      ) : (
        borrower.fullName
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()
      )}
    </span>
  );
}
export function Stars({ stars }: { stars: number | null }) {
  return stars === null ? (
    <span className="new-rating">New borrower</span>
  ) : (
    <span className="stars" aria-label={`${stars} out of 5 stars`}>
      ★ <b>{stars.toFixed(1)}</b>
      <span>/ 5</span>
    </span>
  );
}
export function Empty({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select,textarea,a[href],[tabindex="0"]',
          ) || [],
        );
        if (!nodes.length) return;
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes[nodes.length - 1].focus();
        } else if (
          !e.shiftKey &&
          document.activeElement === nodes[nodes.length - 1]
        ) {
          e.preventDefault();
          nodes[0].focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = "";
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
        ref={ref}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">OWEME NOTEBOOK</span>
            <h2 id="dialog-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function ErrorBox({ error }: { error: string }) {
  return error ? (
    <div role="alert" className="alert error">
      {error}
    </div>
  ) : null;
}
export function Submit({
  busy,
  children,
}: {
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <button type="submit" className="button primary" disabled={busy}>
      {busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{" "}
      {children}
    </button>
  );
}
export function SectionTitle({
  title,
  action,
  onClick,
}: {
  title: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {action && (
        <button className="text-button" onClick={onClick}>
          {action}
          <ArrowUpRight size={15} />
        </button>
      )}
    </div>
  );
}
