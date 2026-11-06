import { useMemo, useState } from "react";
import { CalendarPlus, Copy, MessageCircle, Phone, Share2 } from "lucide-react";
import type { AppData, Actions } from "./types";
import { dueRows } from "./HomePage";
import { addDays, daysBetween, formatMoney, today } from "../core/logic";
import { calendarFile, copyText, downloadFile, reminderText } from "../exports";
import { Avatar, Empty, Help, Money } from "./primitives";
import { Status } from "./forms";
export default function RemindersPage({
  data,
  actions,
}: {
  data: AppData;
  actions: Actions;
}) {
  const date = today(),
    rows = useMemo(() => dueRows(data), [data]);
  const [limit, setLimit] = useState(40);
  const groups = [
    { title: "Due today", rows: rows.filter((r) => r.item.dueDate === date) },
    {
      title: "Due in the next 7 days",
      rows: rows.filter(
        (r) => r.item.dueDate > date && r.item.dueDate <= addDays(date, 7),
      ),
    },
    {
      title: "Courtesy · late",
      rows: rows.filter((r) => r.status === "Mercy"),
    },
    { title: "Overdue", rows: rows.filter((r) => r.item.dueDate < date) },
  ];
  async function share(text: string) {
    try {
      if (navigator.share)
        await navigator.share({ text, title: "Payment reminder" });
      else {
        await copyText(text);
        actions.toast("Reminder copied. Paste it in your messaging app.");
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        actions.toast(String(e));
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Reminders</h1>
          <p>
            A personal nudge, always at the right time.{" "}
            <Help topic="reminder" />
          </p>
        </div>
        <button
          className="button"
          onClick={() =>
            downloadFile(
              calendarFile(data.loans, data.settings, data.borrowers, date),
            )
          }
        >
          <CalendarPlus size={14} />
          Export calendar
        </button>
      </div>
      <div className="alert" style={{ marginBottom: 25 }}>
        Reminders are checked when OweMe opens. Add official due dates to your
        calendar for device reminders. Courtesy is an internal reminder window;
        every payment after its contractual due date is late.
      </div>
      {groups[0].rows.length > 0 && (
        <div
          className="alert amber"
          role="status"
          style={{
            marginBottom: 24,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span>
            <strong>{groups[0].rows.length} installments due today</strong> ·{" "}
            {formatMoney(
              groups[0].rows.reduce(
                (sum, row) => sum + row.item.amountDue - row.item.amountPaid,
                0,
              ),
            )}{" "}
            remaining
          </span>
          <button
            className="button small"
            onClick={() => actions.payment(groups[0].rows[0].loan.id)}
          >
            Record payment
          </button>
        </div>
      )}
      <p className="caption" style={{ marginBottom: 20 }}>
        Advance indicators: 7, 3, and 1 day before the agreed due date. Courtesy
        items are also included in Overdue totals.
      </p>
      {groups.map((g) => (
        <section className="reminder-group" key={g.title}>
          <div className="section-title">
            <h2>
              {g.title}{" "}
              {g.title.startsWith("Courtesy") && <Help topic="mercy" />}
            </h2>
            <span className="caption">
              {g.rows.length} installments ·{" "}
              {formatMoney(
                g.rows.reduce(
                  (s, r) => s + r.item.amountDue - r.item.amountPaid,
                  0,
                ),
              )}
            </span>
          </div>
          <div className="panel">
            {g.rows.length ? (
              g.rows.slice(0, limit).map((r) => {
                const text = reminderText(
                  r.borrower,
                  { ...r.loan, installments: [r.item] },
                  data.settings,
                );
                return (
                  <div
                    key={r.loan.id + "-" + r.item.no}
                    style={{
                      padding: 18,
                      borderBottom: "1px solid var(--line)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <div className="person">
                        <Avatar borrower={r.borrower} />
                        <div>
                          <b>{r.borrower.fullName}</b>
                          <p>
                            {r.loan.loanNo} · Due {r.item.dueDate}
                            {r.item.dueDate < date
                              ? ` · ${daysBetween(r.item.dueDate, date)} days past due`
                              : ""}
                          </p>
                          {r.item.dueDate > date && (
                            <span
                              className={`status ${[7, 3, 1].includes(daysBetween(date, r.item.dueDate)) ? "upcoming" : "purple"}`}
                              style={{ marginTop: 7 }}
                            >
                              {daysBetween(date, r.item.dueDate) === 1
                                ? "1-day reminder · tomorrow"
                                : `${daysBetween(date, r.item.dueDate)}-day reminder`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <Money amount={r.item.amountDue - r.item.amountPaid} />
                        <div style={{ marginTop: 8 }}>
                          <Status status={r.status} />
                        </div>
                      </div>
                    </div>
                    <p
                      className="caption"
                      style={{
                        margin: "15px 0",
                        padding: 12,
                        background: "#fafafd",
                        borderRadius: 8,
                      }}
                    >
                      {text}
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
                      <button
                        className="button primary small"
                        onClick={() => actions.payment(r.loan.id)}
                      >
                        Receive payment
                      </button>
                      {r.borrower.contact && (
                        <>
                          <a
                            className="button small"
                            href={`tel:${r.borrower.contact}`}
                          >
                            <Phone size={12} />
                            Call
                          </a>
                          <a
                            className="button small"
                            href={`sms:${r.borrower.contact}?body=${encodeURIComponent(text)}`}
                          >
                            <MessageCircle size={12} />
                            Text
                          </a>
                        </>
                      )}
                      <button
                        className="button small"
                        onClick={async () => {
                          try {
                            await copyText(text);
                            actions.toast("Polite reminder copied.");
                          } catch (e) {
                            actions.toast(String(e));
                          }
                        }}
                      >
                        <Copy size={12} />
                        Copy
                      </button>
                      <button
                        className="button small"
                        onClick={() => void share(text)}
                      >
                        <Share2 size={12} />
                        Share
                      </button>
                      <button
                        className="button small"
                        onClick={() =>
                          downloadFile(
                            calendarFile(
                              [r.loan],
                              data.settings,
                              [r.borrower],
                              date,
                            ),
                          )
                        }
                      >
                        <CalendarPlus size={12} />
                        Calendar
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <Empty
                icon={<CalendarPlus />}
                title="All clear here"
                body="No installments in this group right now."
              />
            )}
            {g.rows.length > limit && (
              <div className="load-more">
                <button
                  className="text-button"
                  onClick={() => setLimit((l) => l + 40)}
                >
                  Show more reminders
                </button>
              </div>
            )}
          </div>
        </section>
      ))}
    </>
  );
}
