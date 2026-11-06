import { assertSafeFinancialMerge } from "./consistency";
import type { AccountingTotals } from "./consistency";
/** Versioned, self-contained JSON. No credentials or access tokens are serialized. */
export const BACKUP_VERSION = 1;
export const BACKUP_TABLES = [
  "borrowers",
  "loans",
  "transactions",
  "settings",
  "counters",
  "auditLogs",
  "tombstones",
  "signerProfiles",
  "notes",
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];
export type BackupRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};
export type BackupData = Record<BackupTable, BackupRecord[]>;
export interface BackupFile {
  app: "OweMe";
  schemaVersion: 1;
  exportedAt: string;
  lite: boolean;
  tables: BackupData;
  counts?: Record<BackupTable, number>;
  checksum?: { algorithm: "CRC32"; value: string };
}
export interface ImportSummary {
  added: number;
  updated: number;
  deleted: number;
  conflicts: string[];
}
export interface ImportPreview {
  backup: BackupFile;
  counts: Record<BackupTable, number>;
  conflicts: string[];
  from?: string;
  to?: string;
  exportedAt: string;
  lite: boolean;
  integrity?: "verified" | "legacy";
  mergeBlocked?: string;
  accounting?: {
    local: AccountingTotals;
    incoming: AccountingTotals;
    merged?: AccountingTotals;
  };
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const date = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const timestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT/.test(value) &&
  Number.isFinite(Date.parse(value));
const snapshot = (value: unknown): boolean =>
  object(value) &&
  integer(value.numericId) &&
  Number(value.numericId) > 0 &&
  nonempty(value.fullName);
function requireValue(valid: boolean, message: string): asserts valid {
  if (!valid) throw new Error(`Invalid backup: ${message}`);
}

function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** CRC32 detects accidental corruption. It is not encryption or an authenticity signature. */
export function backupChecksum(encoded: unknown): string {
  requireValue(object(encoded), "backup envelope");
  const payload = { ...encoded };
  delete payload.checksum;
  let crc = 0xffffffff;
  for (const byte of new TextEncoder().encode(canonicalJSON(payload))) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

/** Add counts and integrity after all portable attachments have been encoded. */
export function sealBackup(encoded: unknown): unknown {
  requireValue(object(encoded) && object(encoded.tables), "backup tables");
  const tables = encoded.tables;
  const payload = {
    ...encoded,
    counts: Object.fromEntries(
      BACKUP_TABLES.map((table) => [
        table,
        Array.isArray(tables[table]) ? tables[table].length : 0,
      ]),
    ),
  };
  return {
    ...payload,
    checksum: { algorithm: "CRC32", value: backupChecksum(payload) },
  };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  requireValue(
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    ),
    "invalid image encoding",
  );
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export async function encodeValue(
  value: unknown,
  lite = false,
): Promise<unknown> {
  if (value instanceof Blob) {
    if (lite) return undefined;
    return {
      $blob: bytesToBase64(new Uint8Array(await value.arrayBuffer())),
      type: value.type,
    };
  }
  if (Array.isArray(value))
    return Promise.all(value.map((item) => encodeValue(item, lite)));
  if (object(value)) {
    const entries = await Promise.all(
      Object.entries(value).map(
        async ([key, item]) => [key, await encodeValue(item, lite)] as const,
      ),
    );
    return Object.fromEntries(entries.filter(([, item]) => item !== undefined));
  }
  return value;
}

function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (!object(value)) return value;
  if ("$blob" in value) {
    requireValue(
      typeof value.$blob === "string" && typeof value.type === "string",
      "invalid embedded image",
    );
    requireValue(
      value.type.startsWith("image/") ||
        value.type === "application/pdf" ||
        value.type === "",
      "unsupported embedded file type",
    );
    return new Blob([base64ToBytes(value.$blob)], { type: value.type });
  }
  requireValue(
    !Object.keys(value).some((key) =>
      ["__proto__", "prototype", "constructor"].includes(key),
    ),
    "unsafe object key",
  );
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, decodeValue(item)]),
  );
}

function validateRecord(
  table: BackupTable,
  value: unknown,
): asserts value is BackupRecord {
  requireValue(object(value), `${table} record is not an object`);
  requireValue(
    nonempty(value.id) &&
      timestamp(value.createdAt) &&
      timestamp(value.updatedAt),
    `${table} record metadata is missing`,
  );
  if (table === "borrowers") {
    requireValue(
      integer(value.numericId) &&
        Number(value.numericId) > 0 &&
        nonempty(value.fullName) &&
        typeof value.address === "string" &&
        integer(value.monthlyIncome) &&
        ["active", "archived"].includes(String(value.status)),
      "borrower fields",
    );
    if (value.rateOverride !== undefined)
      requireValue(
        typeof value.rateOverride === "number" &&
          value.rateOverride >= 0 &&
          value.rateOverride < 1,
        "borrower rate override",
      );
    if (value.maxTermOverride !== undefined)
      requireValue(
        integer(value.maxTermOverride) && Number(value.maxTermOverride) > 0,
        "borrower term override",
      );
    if (value.graceDaysOverride !== undefined)
      requireValue(integer(value.graceDaysOverride), "borrower grace override");
  }
  if (table === "loans") {
    if (value.documents !== undefined) {
      requireValue(Array.isArray(value.documents), "loan documents");
      for (const document of value.documents)
        requireValue(
          object(document) &&
            nonempty(document.id) &&
            nonempty(document.name) &&
            timestamp(document.addedAt) &&
            (document.file === undefined || document.file instanceof Blob),
          "loan document evidence",
        );
    }
    requireValue(
      nonempty(value.borrowerId) &&
        nonempty(value.loanNo) &&
        snapshot(value.borrowerSnapshot) &&
        typeof value.releasedBy === "string" &&
        object(value.signatures),
      "loan identity",
    );
    requireValue(
      integer(value.faceAmount) &&
        integer(value.netRelease) &&
        integer(value.interestAmount) &&
        integer(value.monthlyAmount) &&
        integer(value.incomeAtLoan),
      "loan amounts must be integer centavos",
    );
    requireValue(
      integer(value.termMonths) &&
        Number(value.termMonths) > 0 &&
        typeof value.rate === "number" &&
        value.rate >= 0 &&
        value.rate < 1 &&
        ["upfront", "added"].includes(String(value.interestMode)),
      "loan terms",
    );
    requireValue(
      ["active", "completed", "merged", "voided"].includes(
        String(value.status),
      ) &&
        ["new", "advance"].includes(String(value.kind)) &&
        date(value.releaseDate) &&
        Array.isArray(value.installments),
      "loan schedule",
    );
    let total = 0;
    const installmentNumbers = new Set<number>();
    for (const installment of value.installments) {
      requireValue(
        object(installment) &&
          integer(installment.no) &&
          Number(installment.no) > 0 &&
          date(installment.dueDate) &&
          date(installment.graceUntil) &&
          integer(installment.amountDue) &&
          integer(installment.amountPaid),
        "installment fields",
      );
      requireValue(
        Number(installment.amountPaid) <= Number(installment.amountDue) &&
          !installmentNumbers.has(Number(installment.no)) &&
          [
            "Upcoming",
            "Due soon",
            "Due today",
            "Mercy",
            "Overdue",
            "Partial",
            "Paid",
            "rolled_over",
          ].includes(String(installment.status)),
        "installment payment or numbering",
      );
      installmentNumbers.add(Number(installment.no));
      total += Number(installment.amountDue);
      if (installment.paidDate !== undefined)
        requireValue(date(installment.paidDate), "installment paid date");
    }
    requireValue(
      total === value.faceAmount &&
        value.installments.length === value.termMonths,
      "installments do not sum to the face amount",
    );
  }
  if (table === "transactions") {
    requireValue(
      nonempty(value.txnNo) &&
        nonempty(value.loanId) &&
        nonempty(value.borrowerId) &&
        snapshot(value.borrowerSnapshot) &&
        typeof value.receivedBy === "string",
      "transaction identity",
    );
    requireValue(
      ["RELEASE", "ADVANCE", "PAYMENT", "VOID", "ADJUSTMENT"].includes(
        String(value.type),
      ) &&
        integer(value.amount) &&
        integer(value.balanceBefore) &&
        integer(value.balanceAfter) &&
        date(value.date) &&
        Array.isArray(value.allocation),
      "transaction fields",
    );
    for (const allocation of value.allocation)
      requireValue(
        object(allocation) &&
          integer(allocation.installmentNo) &&
          integer(allocation.amount),
        "transaction allocation",
      );
    requireValue(
      value.allocation.reduce(
        (total: number, item: unknown) =>
          total + Number((item as Record<string, unknown>).amount),
        0,
      ) <= Number(value.amount),
      "allocations exceed the transaction amount",
    );
    if (value.method !== undefined)
      requireValue(
        ["cash", "bank", "gcash", "maya", "other"].includes(
          String(value.method),
        ),
        "payment method",
      );
  }
  if (table === "settings") {
    requireValue(
      value.id === "settings" &&
        object(value.business) &&
        typeof value.business.name === "string" &&
        object(value.defaults) &&
        object(value.scoring) &&
        object(value.backup),
      "settings fields",
    );
    if (value.loanDrafts !== undefined) {
      requireValue(Array.isArray(value.loanDrafts), "saved loan drafts");
      const draftIds = new Set<string>();
      for (const draft of value.loanDrafts) {
        requireValue(
          object(draft) &&
            nonempty(draft.id) &&
            !draftIds.has(draft.id) &&
            timestamp(draft.createdAt) &&
            timestamp(draft.updatedAt) &&
            nonempty(draft.borrowerId) &&
            typeof draft.advance === "boolean" &&
            ["merge", "separate"].includes(String(draft.advanceMode)) &&
            ["upfront", "added"].includes(String(draft.interestMode)) &&
            ["face", "cash"].includes(String(draft.inputMode)) &&
            typeof draft.term === "number" &&
            Number.isFinite(draft.term) &&
            typeof draft.overrideCap === "boolean" &&
            object(draft.signatures) &&
            [
              "income",
              "affordabilityPercent",
              "maximumTerm",
              "rate",
              "amount",
              "releaseDate",
              "releasedBy",
              "notes",
              "overrideReason",
              "witness",
            ].every((key) => typeof draft[key] === "string"),
          "saved loan draft fields",
        );
        draftIds.add(draft.id);
      }
    }
    requireValue(
      typeof value.defaults.rate === "number" &&
        value.defaults.rate >= 0 &&
        value.defaults.rate < 1 &&
        integer(value.defaults.maxTerm) &&
        Number(value.defaults.maxTerm) > 0 &&
        Number(value.defaults.maxTerm) <= 120 &&
        integer(value.defaults.graceDays) &&
        Number(value.defaults.graceDays) <= 365 &&
        ["upfront", "added"].includes(String(value.defaults.interestMode)),
      "default loan settings",
    );
    if (value.defaults.affordabilityPercent !== undefined)
      requireValue(
        typeof value.defaults.affordabilityPercent === "number" &&
          value.defaults.affordabilityPercent > 0 &&
          value.defaults.affordabilityPercent <= 100,
        "affordability percentage",
      );
    if (value.scoring.thresholds !== undefined)
      requireValue(
        Array.isArray(value.scoring.thresholds) &&
          value.scoring.thresholds.length === 4 &&
          value.scoring.thresholds.every(
            (threshold, index, all) =>
              typeof threshold === "number" &&
              threshold >= 0 &&
              threshold <= 100 &&
              (index === 0 || threshold <= all[index - 1]),
          ),
        "rating thresholds",
      );
    requireValue(
      [
        "onTime",
        "withinGrace",
        "lateBase",
        "latePerDay",
        "minimum",
        "recency",
      ].every(
        (key) =>
          typeof value.scoring === "object" &&
          value.scoring !== null &&
          typeof (value.scoring as Record<string, unknown>)[key] === "number" &&
          Number.isFinite((value.scoring as Record<string, number>)[key]),
      ),
      "rating settings",
    );
    requireValue(
      Number(value.scoring.recency) > 0 &&
        Number(value.scoring.recency) <= 1 &&
        [
          "receiptFooter",
          "agreementText",
          "reminderTemplate",
          "adminEmail",
          "defaultReceivedBy",
          "borrowerPrefix",
        ].every((key) => typeof value[key] === "string") &&
        typeof value.haptics === "boolean",
      "app settings",
    );
    for (const key of [
      "onTime",
      "withinGrace",
      "lateBase",
      "latePerDay",
      "minimum",
    ])
      requireValue(
        Number(value.scoring[key]) >= 0 && Number(value.scoring[key]) <= 100,
        "rating range",
      );
    for (const key of [
      "lastSuccess",
      "lastSync",
      "lastEmailSuccess",
      "lastDriveSuccess",
      "lastLocalExport",
      "lastLocalVerified",
    ])
      if (value.backup[key] !== undefined)
        requireValue(timestamp(value.backup[key]), `backup ${key}`);
    for (const key of ["googleClientId", "driveFileId", "email", "lastError"])
      if (value.backup[key] !== undefined)
        requireValue(typeof value.backup[key] === "string", `backup ${key}`);
    for (const key of ["autoDrive", "emailEnabled", "pendingDrive"])
      if (value.backup[key] !== undefined)
        requireValue(typeof value.backup[key] === "boolean", `backup ${key}`);
  }
  if (table === "counters") {
    requireValue(
      value.id === "counters" &&
        integer(value.borrower) &&
        object(value.txnByDay) &&
        object(value.loanByBorrower),
      "counters",
    );
    requireValue(
      Object.values(value.txnByDay).every(integer) &&
        Object.values(value.loanByBorrower).every(integer),
      "counter values",
    );
  }
  if (table === "tombstones")
    requireValue(
      nonempty(value.entity) &&
        nonempty(value.entityId) &&
        timestamp(value.deletedAt),
      "deletion marker",
    );
  if (table === "notes")
    requireValue(
      nonempty(value.borrowerId) && typeof value.text === "string",
      "borrower note",
    );
  if (table === "signerProfiles")
    requireValue(nonempty(value.name), "signer profile");
  if (table === "auditLogs")
    requireValue(
      timestamp(value.at) &&
        nonempty(value.action) &&
        nonempty(value.entity) &&
        typeof value.detail === "string",
      "audit record",
    );
}

/** Parsing/validation is pure: corrupt input can never change the local database. */
export function parseBackup(json: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(
      "This file is not valid JSON. Your current data is unchanged.",
    );
  }
  requireValue(
    object(parsed) &&
      parsed.app === "OweMe" &&
      parsed.schemaVersion === BACKUP_VERSION,
    "unsupported app or schema version",
  );
  requireValue(
    timestamp(parsed.exportedAt) &&
      typeof parsed.lite === "boolean" &&
      object(parsed.tables),
    "backup header",
  );
  if (parsed.checksum !== undefined) {
    requireValue(
      object(parsed.checksum) &&
        parsed.checksum.algorithm === "CRC32" &&
        typeof parsed.checksum.value === "string",
      "unsupported checksum",
    );
    requireValue(
      backupChecksum(parsed) === parsed.checksum.value,
      "checksum mismatch; the file may be incomplete or altered",
    );
  }
  if (parsed.counts !== undefined) {
    requireValue(object(parsed.counts), "record counts");
    for (const name of BACKUP_TABLES)
      requireValue(
        Array.isArray(parsed.tables[name]) &&
          parsed.counts[name] === parsed.tables[name].length,
        `${name} record count does not match`,
      );
  }
  const decoded = decodeValue(parsed) as Record<string, unknown>;
  const tables = decoded.tables as Record<string, unknown>;
  for (const name of BACKUP_TABLES) {
    const rows = tables[name];
    requireValue(Array.isArray(rows), `${name} table is missing`);
    const ids = new Set<string>();
    for (const row of rows) {
      validateRecord(name, row);
      requireValue(!ids.has(row.id), `duplicate record id in ${name}`);
      ids.add(row.id);
    }
  }
  requireValue(
    (tables.settings as unknown[]).length <= 1 &&
      (tables.counters as unknown[]).length <= 1,
    "multiple settings or counters",
  );
  const loanIds = new Set(
    (tables.loans as BackupRecord[]).map((row) => row.id),
  );
  const transactionIds = new Set(
    (tables.transactions as BackupRecord[]).map((row) => row.id),
  );
  for (const transaction of tables.transactions as BackupRecord[]) {
    requireValue(
      loanIds.has(String(transaction.loanId)),
      "transaction refers to a missing loan",
    );
    if (transaction.voidOf !== undefined)
      requireValue(
        transactionIds.has(String(transaction.voidOf)),
        "void refers to a missing transaction",
      );
  }
  for (const loan of tables.loans as BackupRecord[]) {
    for (const key of ["parentLoanId", "mergedIntoLoanId"])
      if (loan[key] !== undefined)
        requireValue(
          loanIds.has(String(loan[key])),
          "advance refers to a missing loan",
        );
  }
  return decoded as unknown as BackupFile;
}

export function emptyBackupData(): BackupData {
  return Object.fromEntries(
    BACKUP_TABLES.map((table) => [table, []]),
  ) as unknown as BackupData;
}

function maxByKey(a: unknown, b: unknown): Record<string, number> {
  const first = object(a) ? a : {},
    second = object(b) ? b : {};
  return Object.fromEntries(
    [...new Set([...Object.keys(first), ...Object.keys(second)])].map((key) => [
      key,
      Math.max(Number(first[key] || 0), Number(second[key] || 0)),
    ]),
  );
}

/** Resolve same-record versions and preserve both distinct records with colliding human IDs. */
function retainExistingMedia(existing: unknown, incoming: unknown): unknown {
  if (existing instanceof Blob)
    return incoming === undefined ? existing : incoming;
  if (incoming instanceof Blob) return incoming;
  if (Array.isArray(existing) && Array.isArray(incoming))
    return incoming.map((item, index) =>
      retainExistingMedia(
        object(item) && typeof item.id === "string"
          ? existing.find(
              (candidate) => object(candidate) && candidate.id === item.id,
            )
          : existing[index],
        item,
      ),
    );
  if (!object(existing) || !object(incoming)) return incoming;
  // Never attach an old signature to a different signer or a different capture.
  if (
    ("original" in existing || "processed" in existing) &&
    (existing.signerName !== incoming.signerName ||
      existing.capturedAt !== incoming.capturedAt)
  )
    return incoming;
  const result = { ...incoming };
  for (const [key, value] of Object.entries(existing)) {
    if (value instanceof Blob || key in result)
      result[key] = retainExistingMedia(value, result[key]);
  }
  return result;
}

export function mergeBackupData(
  local: BackupData,
  incoming: BackupData,
  replace = false,
  preserveExistingImages = false,
): { tables: BackupData; summary: ImportSummary } {
  if (!replace) assertSafeFinancialMerge(local, incoming);
  const output = emptyBackupData();
  const summary: ImportSummary = {
    added: 0,
    updated: 0,
    deleted: 0,
    conflicts: [],
  };
  const cloned = structuredClone(incoming);
  const localBorrowers = new Map(local.borrowers.map((row) => [row.id, row]));
  const usedNumbers = new Map<number, string>();
  let nextBorrower = Math.max(
    0,
    ...local.borrowers.map((row) => Number(row.numericId)),
    ...incoming.borrowers.map((row) => Number(row.numericId)),
    Number(local.counters[0]?.borrower || 0),
    Number(incoming.counters[0]?.borrower || 0),
  );
  // Snapshots include deleted borrowers: their numeric IDs remain reserved forever.
  for (const row of [
    ...local.loans,
    ...local.transactions,
    ...incoming.loans,
    ...incoming.transactions,
  ])
    if (object(row.borrowerSnapshot))
      nextBorrower = Math.max(
        nextBorrower,
        Number(row.borrowerSnapshot.numericId || 0),
      );
  if (!replace)
    for (const borrower of local.borrowers)
      usedNumbers.set(Number(borrower.numericId), borrower.id);
  for (const borrower of cloned.borrowers) {
    const number = Number(borrower.numericId);
    const owner = usedNumbers.get(number);
    const existing = localBorrowers.get(borrower.id);
    if (
      !replace &&
      existing &&
      Date.parse(String(existing.updatedAt)) >=
        Date.parse(String(borrower.updatedAt))
    )
      continue;
    if (
      owner &&
      owner !== borrower.id &&
      (!existing || String(borrower.updatedAt) > String(existing.updatedAt))
    ) {
      const replacement = ++nextBorrower;
      borrower.numericId = replacement;
      summary.conflicts.push(
        `Borrower #${String(number).padStart(3, "0")} (${String(borrower.fullName)}) was renumbered to #${String(replacement).padStart(3, "0")}.`,
      );
      for (const row of [...cloned.loans, ...cloned.transactions]) {
        if (row.borrowerId === borrower.id && object(row.borrowerSnapshot)) {
          row.borrowerSnapshot.numericId = replacement;
          if (typeof row.loanNo === "string")
            row.loanNo = row.loanNo.replace(
              /^L-\d+-/,
              `L-${String(replacement).padStart(3, "0")}-`,
            );
        }
      }
    }
    usedNumbers.set(Number(borrower.numericId), borrower.id);
  }
  const txnOwners = new Map<string, string>();
  if (!replace)
    for (const row of local.transactions)
      txnOwners.set(String(row.txnNo), row.id);
  for (const row of cloned.transactions) {
    const original = String(row.txnNo);
    let candidate = original;
    let suffix = 0;
    while (txnOwners.has(candidate) && txnOwners.get(candidate) !== row.id) {
      suffix++;
      candidate = `${original}-B${suffix === 1 ? "" : suffix}`;
    }
    if (candidate !== original) {
      row.txnNo = candidate;
      summary.conflicts.push(
        `Transaction ${original} was preserved as ${candidate}.`,
      );
    }
    txnOwners.set(candidate, row.id);
  }
  const loanOwners = new Map<string, string>();
  const loanSequences = new Map<string, number>();
  for (const row of [...local.loans, ...cloned.loans]) {
    const match = /^(.*)-(\d+)$/.exec(String(row.loanNo));
    if (match)
      loanSequences.set(
        match[1],
        Math.max(loanSequences.get(match[1]) || 0, Number(match[2])),
      );
  }
  if (!replace)
    for (const row of local.loans) loanOwners.set(String(row.loanNo), row.id);
  for (const row of cloned.loans) {
    const original = String(row.loanNo);
    let candidate = original;
    const match = /^(.*)-(\d+)$/.exec(original);
    while (loanOwners.has(candidate) && loanOwners.get(candidate) !== row.id) {
      const prefix = match?.[1] || original;
      const next = (loanSequences.get(prefix) || 0) + 1;
      loanSequences.set(prefix, next);
      candidate = `${prefix}-${String(next).padStart(2, "0")}`;
    }
    if (candidate !== original) {
      row.loanNo = candidate;
      summary.conflicts.push(`Loan ${original} was preserved as ${candidate}.`);
    }
    loanOwners.set(candidate, row.id);
  }
  for (const table of BACKUP_TABLES) {
    const rows = new Map<string, BackupRecord>(
      (replace ? [] : local[table]).map((row) => [
        row.id,
        structuredClone(row),
      ]),
    );
    for (const row of cloned[table]) {
      const existing = rows.get(row.id);
      if (!existing) {
        rows.set(row.id, row);
        summary.added++;
      } else if (Date.parse(row.updatedAt) > Date.parse(existing.updatedAt)) {
        rows.set(
          row.id,
          preserveExistingImages && !replace
            ? (retainExistingMedia(existing, row) as BackupRecord)
            : row,
        );
        summary.updated++;
      }
    }
    output[table] = [...rows.values()];
  }
  // Tombstones are applied after LWW. Financial history is permanent and is never deleted.
  for (const marker of output.tombstones) {
    const entity = String(marker.entity);
    const table = (
      {
        borrower: "borrowers",
        borrowers: "borrowers",
        note: "notes",
        notes: "notes",
        signerProfile: "signerProfiles",
        signerProfiles: "signerProfiles",
      } as Record<string, BackupTable>
    )[entity];
    if (!table) continue;
    output[table] = output[table].filter((row) => {
      const remove =
        row.id === marker.entityId &&
        Date.parse(row.updatedAt) <= Date.parse(String(marker.deletedAt));
      if (remove) summary.deleted++;
      return !remove;
    });
    if (table === "borrowers")
      output.notes = output.notes.filter(
        (row) =>
          row.borrowerId !== marker.entityId ||
          Date.parse(row.updatedAt) > Date.parse(String(marker.deletedAt)),
      );
  }
  const localCounter = local.counters[0],
    incomingCounter = incoming.counters[0];
  const counter = output.counters[0];
  if (counter) {
    counter.borrower = Math.max(
      nextBorrower,
      Number(localCounter?.borrower || 0),
      Number(incomingCounter?.borrower || 0),
    );
    counter.txnByDay = maxByKey(
      localCounter?.txnByDay,
      incomingCounter?.txnByDay,
    );
    counter.loanByBorrower = maxByKey(
      localCounter?.loanByBorrower,
      incomingCounter?.loanByBorrower,
    );
    for (const transaction of output.transactions) {
      const modern = /^OWM-(PAY|DIS|REV|ADJ)-(\d{4})-(\d+)/.exec(
        String(transaction.txnNo),
      );
      if (modern) {
        const counts = counter.txnByDay as Record<string, number>;
        const key = `${modern[1]}-${modern[2]}`;
        counts[key] = Math.max(counts[key] || 0, Number(modern[3]));
      }
      const match = /^OM-(\d{8})-(\d+)/.exec(String(transaction.txnNo));
      if (match) {
        const day = `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}`;
        const counts = counter.txnByDay as Record<string, number>;
        counts[day] = Math.max(counts[day] || 0, Number(match[2]));
      }
    }
    for (const loan of output.loans) {
      const sequence = /-(\d+)$/.exec(String(loan.loanNo));
      if (sequence) {
        const counts = counter.loanByBorrower as Record<string, number>;
        counts[String(loan.borrowerId)] = Math.max(
          counts[String(loan.borrowerId)] || 0,
          Number(sequence[1]),
        );
      }
    }
  }
  return { tables: output, summary };
}
