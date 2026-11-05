import { describe, expect, it } from "vitest";
import {
  BACKUP_VERSION,
  emptyBackupData,
  encodeValue,
  mergeBackupData,
  parseBackup,
} from "./format";
import type { BackupData, BackupFile, BackupRecord } from "./format";

const first = "2026-11-01T00:00:00.000Z";
const later = "2026-11-02T00:00:00.000Z";
const meta = (id: string, updatedAt = first) => ({
  id,
  createdAt: first,
  updatedAt,
});
const borrower = (
  id: string,
  numericId: number,
  updatedAt = first,
): BackupRecord => ({
  ...meta(id, updatedAt),
  numericId,
  fullName: `Borrower ${id}`,
  address: "Purok 1",
  monthlyIncome: 100_000,
  status: "active",
});
const counter = (maximum = 0): BackupRecord => ({
  ...meta("counters"),
  borrower: maximum,
  txnByDay: {},
  loanByBorrower: {},
});
const transaction = (id: string, txnNo: string): BackupRecord => ({
  ...meta(id),
  txnNo,
  type: "PAYMENT",
  loanId: "loan-1",
  borrowerId: "b1",
  borrowerSnapshot: { numericId: 1, fullName: "Borrower b1" },
  amount: 50_000,
  receivedBy: "Admin",
  balanceBefore: 300_000,
  balanceAfter: 250_000,
  allocation: [{ installmentNo: 1, amount: 50_000 }],
  date: "2026-11-01",
});
const envelope = (tables = emptyBackupData()): BackupFile => ({
  app: "OweMe",
  schemaVersion: BACKUP_VERSION,
  exportedAt: first,
  lite: false,
  tables,
});

describe("versioned backups", () => {
  it("round-trips nested images and signatures, including empty blobs", async () => {
    const tables = emptyBackupData();
    tables.borrowers = [
      {
        ...borrower("b1", 1),
        photo: new Blob(["photo evidence"], { type: "image/jpeg" }),
      },
    ];
    tables.signerProfiles = [
      {
        ...meta("signer"),
        name: "Admin",
        defaultSignature: {
          signerName: "Admin",
          capturedAt: first,
          original: new Blob([], { type: "image/png" }),
          processed: new Blob(["signature"], { type: "image/png" }),
        },
      },
    ];
    const parsed = parseBackup(
      JSON.stringify(await encodeValue(envelope(tables))),
    );
    expect(await (parsed.tables.borrowers[0].photo as Blob).text()).toBe(
      "photo evidence",
    );
    const signature = parsed.tables.signerProfiles[0].defaultSignature as {
      original: Blob;
      processed: Blob;
    };
    expect(signature.original.size).toBe(0);
    expect(await signature.processed.text()).toBe("signature");
  });

  it("Lite backups omit images while retaining textual records", async () => {
    const tables = emptyBackupData();
    tables.borrowers = [
      {
        ...borrower("b1", 1),
        photo: new Blob(["photo"], { type: "image/jpeg" }),
      },
    ];
    const result = parseBackup(
      JSON.stringify(
        await encodeValue({ ...envelope(tables), lite: true }, true),
      ),
    );
    expect(result.lite).toBe(true);
    expect(result.tables.borrowers[0].photo).toBeUndefined();
    expect(result.tables.borrowers[0].fullName).toBe("Borrower b1");
  });

  it.each(["not json", "{}", '{"app":"OweMe","schemaVersion":99}'])(
    "rejects corrupt or incompatible file %s",
    (input) => {
      expect(() => parseBackup(input)).toThrow();
    },
  );

  it("rejects fractional centavos and invalid dates before any mutation", () => {
    const tables = emptyBackupData();
    tables.transactions = [
      { ...transaction("t1", "OM-20261101-0001"), amount: 1.25 },
    ];
    expect(() => parseBackup(JSON.stringify(envelope(tables)))).toThrow(
      "transaction fields",
    );
    tables.transactions[0].amount = 100;
    tables.transactions[0].date = "2026-02-31";
    expect(() => parseBackup(JSON.stringify(envelope(tables)))).toThrow();
  });

  it("rejects duplicate record IDs and malformed embedded images", () => {
    const tables = emptyBackupData();
    tables.borrowers = [borrower("b1", 1), borrower("b1", 2)];
    expect(() => parseBackup(JSON.stringify(envelope(tables)))).toThrow(
      "duplicate record id",
    );
    tables.borrowers = [
      {
        ...borrower("b1", 1),
        photo: { $blob: "not base64!", type: "image/png" },
      },
    ];
    expect(() => parseBackup(JSON.stringify(envelope(tables)))).toThrow(
      "encoding",
    );
  });
});

describe("merge and conflict resolution", () => {
  it("last-write-wins by record ID and leaves both inputs untouched", () => {
    const local = emptyBackupData(),
      incoming = emptyBackupData();
    local.borrowers = [borrower("b1", 1)];
    incoming.borrowers = [{ ...borrower("b1", 1, later), address: "Purok 2" }];
    const result = mergeBackupData(local, incoming);
    expect(result.tables.borrowers).toHaveLength(1);
    expect(result.tables.borrowers[0].address).toBe("Purok 2");
    expect(local.borrowers[0].address).toBe("Purok 1");
    expect(incoming.borrowers[0].numericId).toBe(1);
    expect(result.summary.updated).toBe(1);
  });

  it("renumbers incoming borrowers, updates their snapshots, and never reuses deleted IDs", () => {
    const local = emptyBackupData(),
      incoming = emptyBackupData();
    local.borrowers = [borrower("b1", 1)];
    local.counters = [counter(25)];
    incoming.counters = [counter(1)];
    incoming.borrowers = [borrower("b2", 1)];
    incoming.loans = [
      {
        ...meta("loan-2"),
        borrowerId: "b2",
        loanNo: "L-001-01",
        borrowerSnapshot: { numericId: 1, fullName: "Borrower b2" },
      },
    ];
    const result = mergeBackupData(local, incoming);
    expect(result.tables.borrowers.map((row) => row.numericId)).toEqual([
      1, 26,
    ]);
    expect(result.tables.loans[0].borrowerSnapshot).toEqual({
      numericId: 26,
      fullName: "Borrower b2",
    });
    expect(result.tables.loans[0].loanNo).toBe("L-026-01");
    expect(result.tables.counters[0].borrower).toBe(26);
    expect(result.summary.conflicts).toHaveLength(1);
  });

  it("preserves duplicate transaction numbers with growing -B suffixes", () => {
    const local = emptyBackupData(),
      incoming = emptyBackupData();
    local.transactions = [
      transaction("t1", "OM-20261101-0001"),
      transaction("t2", "OM-20261101-0001-B"),
    ];
    incoming.transactions = [transaction("t3", "OM-20261101-0001")];
    const result = mergeBackupData(local, incoming);
    expect(result.tables.transactions.map((row) => row.txnNo)).toEqual([
      "OM-20261101-0001",
      "OM-20261101-0001-B",
      "OM-20261101-0001-B2",
    ]);
    expect(result.summary.conflicts).toHaveLength(1);
  });

  it("merges counter maxima and reconstructs sequences from permanent history", () => {
    const local = emptyBackupData(),
      incoming = emptyBackupData();
    local.counters = [
      {
        ...counter(1000),
        txnByDay: { "2026-11-01": 8 },
        loanByBorrower: { b1: 2 },
      },
    ];
    incoming.counters = [
      {
        ...counter(3),
        txnByDay: { "2026-11-02": 1 },
        loanByBorrower: { b2: 9 },
      },
    ];
    incoming.transactions = [transaction("t1", "OM-20261101-10000")];
    incoming.loans = [
      {
        ...meta("loan"),
        borrowerId: "b1",
        loanNo: "L-001-07",
        borrowerSnapshot: { numericId: 1, fullName: "Borrower b1" },
      },
    ];
    const result = mergeBackupData(local, incoming);
    expect(result.tables.counters[0].borrower).toBe(1000);
    expect(result.tables.counters[0].txnByDay).toEqual({
      "2026-11-01": 10000,
      "2026-11-02": 1,
    });
    expect(result.tables.counters[0].loanByBorrower).toEqual({ b1: 7, b2: 9 });
  });

  it("applies newer deletion markers but keeps all financial history", () => {
    const local = emptyBackupData(),
      incoming = emptyBackupData();
    local.borrowers = [borrower("b1", 1)];
    local.transactions = [transaction("t1", "OM-20261101-0001")];
    incoming.tombstones = [
      {
        ...meta("delete", later),
        entity: "borrower",
        entityId: "b1",
        deletedAt: later,
      },
      {
        ...meta("bad-delete", later),
        entity: "transactions",
        entityId: "t1",
        deletedAt: later,
      },
    ];
    const result = mergeBackupData(local, incoming);
    expect(result.tables.borrowers).toHaveLength(0);
    expect(result.tables.transactions).toHaveLength(1);
    expect(result.summary.deleted).toBe(1);
  });

  it("does not resurrect an older version over a newer deletion or newer edit", () => {
    const local = emptyBackupData(),
      incoming = emptyBackupData();
    local.tombstones = [
      {
        ...meta("delete", later),
        entity: "borrower",
        entityId: "b1",
        deletedAt: later,
      },
    ];
    incoming.borrowers = [borrower("b1", 1)];
    expect(mergeBackupData(local, incoming).tables.borrowers).toHaveLength(0);
    local.borrowers = [borrower("b2", 2, later)];
    incoming.borrowers = [borrower("b2", 2)];
    expect(mergeBackupData(local, incoming).tables.borrowers[0].updatedAt).toBe(
      later,
    );
  });

  it("replace restores incoming data while retaining the highest historic counter", () => {
    const local: BackupData = emptyBackupData(),
      incoming: BackupData = emptyBackupData();
    local.borrowers = [borrower("b1", 1)];
    local.counters = [counter(50)];
    incoming.borrowers = [borrower("b2", 2)];
    incoming.counters = [counter(2)];
    const result = mergeBackupData(local, incoming, true);
    expect(result.tables.borrowers.map((row) => row.id)).toEqual(["b2"]);
    expect(result.tables.counters[0].borrower).toBe(50);
  });

  it("does not copy an old signature image onto a different signer in a Lite merge", () => {
    const local = emptyBackupData(),
      incoming = emptyBackupData();
    local.signerProfiles = [
      {
        ...meta("signer"),
        name: "Admin",
        defaultSignature: {
          signerName: "Admin",
          capturedAt: first,
          original: new Blob(["original"]),
          processed: new Blob(["ink"]),
        },
      },
    ];
    incoming.signerProfiles = [
      {
        ...meta("signer", later),
        name: "New admin",
        defaultSignature: { signerName: "New admin", capturedAt: later },
      },
    ];
    const result = mergeBackupData(local, incoming, false, true);
    expect(
      (
        result.tables.signerProfiles[0].defaultSignature as Record<
          string,
          unknown
        >
      ).processed,
    ).toBeUndefined();
  });

  it("keeps a supplied incoming image intact when preserving missing Lite media", async () => {
    const local = emptyBackupData(),
      incoming = emptyBackupData();
    local.borrowers = [
      {
        ...borrower("b1", 1),
        photo: new Blob(["old photo"], { type: "image/jpeg" }),
      },
    ];
    incoming.borrowers = [
      {
        ...borrower("b1", 1, later),
        photo: new Blob(["new photo"], { type: "image/jpeg" }),
      },
    ];
    const result = mergeBackupData(local, incoming, false, true);
    expect(await (result.tables.borrowers[0].photo as Blob).text()).toBe(
      "new photo",
    );
  });
});
