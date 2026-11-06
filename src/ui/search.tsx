import MiniSearch from "minisearch";
import type { Borrower, Loan, Note, Transaction } from "../core/model";
export function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
export function buildSearch(
  borrowers: Borrower[],
  loans: Loan[],
  transactions: Transaction[],
  notes: Note[] = [],
) {
  const borrowerIds = new Set(borrowers.map((borrower) => borrower.id));
  const numericIds = new Map(
    borrowers.map((borrower) => [borrower.numericId, borrower.id]),
  );
  const exactIdentifiers = new Map<string, Set<string>>();
  const exactContacts = new Map<string, Set<string>>();
  const addExact = (
    map: Map<string, Set<string>>,
    key: string,
    borrowerId: string,
  ) => {
    if (!key || !borrowerIds.has(borrowerId)) return;
    const matches = map.get(key) || new Set<string>();
    matches.add(borrowerId);
    map.set(key, matches);
  };
  for (const borrower of borrowers) {
    if (borrower.contact)
      addExact(exactContacts, borrower.contact.replace(/\D/g, ""), borrower.id);
  }
  const byBorrower = new Map<string, string[]>();
  for (const item of [...loans, ...transactions]) {
    const values = byBorrower.get(item.borrowerId) || [];
    const identifier = "loanNo" in item ? item.loanNo : item.txnNo;
    addExact(exactIdentifiers, normalize(identifier), item.borrowerId);
    values.push(
      identifier,
      item.notes || "",
      "referenceNo" in item ? item.referenceNo || "" : "",
      "documents" in item
        ? (item.documents ?? []).map((document) => document.name).join(" ")
        : "",
    );
    byBorrower.set(item.borrowerId, values);
  }
  for (const note of notes) {
    const values = byBorrower.get(note.borrowerId) || [];
    values.push(note.text);
    byBorrower.set(note.borrowerId, values);
  }
  const index = new MiniSearch({
    fields: ["text"],
    storeFields: ["id"],
    processTerm: normalize,
    searchOptions: { prefix: true, fuzzy: 0.22, combineWith: "AND" },
  });
  index.addAll(
    borrowers.map((b) => ({
      id: b.id,
      text: [
        b.fullName,
        b.alias,
        b.address,
        b.barangay,
        b.contact,
        b.contact?.replace(/\D/g, ""),
        b.notes,
        String(b.numericId),
        String(b.numericId).padStart(3, "0"),
        `#${String(b.numericId).padStart(3, "0")}`,
        ...(byBorrower.get(b.id) || []),
      ].join(" "),
    })),
  );
  return (query: string) => {
    if (!query.trim()) return null;
    const q = query.trim().replace(/^#/, "");
    if (/^\d+$/.test(q)) {
      const exactBorrower = numericIds.get(Number(q));
      if (exactBorrower) return new Set([exactBorrower]);
    }
    const identifierMatches = exactIdentifiers.get(normalize(q));
    if (identifierMatches) return new Set(identifierMatches);
    if (/^[+\d\s().-]+$/.test(q)) {
      const contactMatches = exactContacts.get(q.replace(/\D/g, ""));
      if (contactMatches) return new Set(contactMatches);
    }
    const matches = new Set(index.search(q).map((r) => r.id as string));
    // Prefix/fuzzy ranking comes first; substring matching also finds the
    // middle of names, document names and external payment references.
    const words = normalize(q).split(/\s+/).filter(Boolean);
    for (const b of borrowers) {
      if (matches.has(b.id)) continue;
      const text = normalize(
        [
          b.fullName,
          b.alias,
          b.address,
          b.barangay,
          b.contact,
          b.notes,
          ...(byBorrower.get(b.id) ?? []),
        ].join(" "),
      );
      if (words.every((word) => text.includes(word))) matches.add(b.id);
    }
    return matches;
  };
}
export function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return text;
  const start = normalize(text).indexOf(normalize(query.trim()));
  return start < 0 ? (
    text
  ) : (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, start + query.trim().length)}</mark>
      {text.slice(start + query.trim().length)}
    </>
  );
}
