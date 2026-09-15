export type FsmQueueStatus = "PENDING" | "SYNCING" | "COMMITTED" | "CONFLICT" | "FORBIDDEN" | "FAILED";

export type FsmOfflineOperation = {
  client_operation_id: string;
  tenant_id: string;
  user_id: string;
  type: "VISIT_TRANSITION" | "REPORT_SAVE" | "VISIT_CREATE" | "COLLECTION_PROMISE";
  payload: Record<string, unknown>;
  status: FsmQueueStatus;
  created_at: string;
  updated_at: string;
  attempts: number;
  error?: string;
};

const DB_NAME = "mizantra-fsm-v1";
const STORE = "operations";

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Offline storage is not supported by this browser."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE)
        ? request.transaction!.objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: "client_operation_id" });
      if (!store.indexNames.contains("identity")) store.createIndex("identity", ["tenant_id", "user_id"], { unique: false });
      if (!store.indexNames.contains("identity_status")) store.createIndex("identity_status", ["tenant_id", "user_id", "status"], { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Offline storage could not be opened."));
  });
}

function transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, done: (value: T) => void) => void) {
  return openDatabase().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result: T;
    let completedWork = false;
    tx.onerror = () => reject(tx.error || new Error("Offline save failed."));
    tx.onabort = () => reject(tx.error || new Error("Offline save was cancelled."));
    work(tx.objectStore(STORE), (value) => { result = value; completedWork = true; });
    tx.oncomplete = () => { db.close(); if (completedWork) resolve(result); else reject(new Error("Offline operation did not complete.")); };
  }));
}

export async function queueFsmOperation(identity: { tenantId: string; userId: string }, type: FsmOfflineOperation["type"], payload: Record<string, unknown>) {
  if (!identity.tenantId || !identity.userId) throw new Error("Sign in again before saving offline work.");
  const now = new Date().toISOString();
  const operation: FsmOfflineOperation = {
    client_operation_id: crypto.randomUUID(), tenant_id: identity.tenantId, user_id: identity.userId,
    type, payload, status: "PENDING", created_at: now, updated_at: now, attempts: 0,
  };
  await transaction<void>("readwrite", (store, done) => {
    const request = store.add(operation);
    request.onsuccess = () => done();
    request.onerror = () => store.transaction.abort();
  });
  return operation;
}

export async function listFsmOperations(identity: { tenantId: string; userId: string }) {
  return transaction<FsmOfflineOperation[]>("readonly", (store, done) => {
    const request = store.index("identity").getAll([identity.tenantId, identity.userId]);
    request.onsuccess = () => done((request.result || []).sort((a, b) => a.created_at.localeCompare(b.created_at)));
  });
}

export async function updateFsmOperation(id: string, patch: Partial<FsmOfflineOperation>) {
  return transaction<void>("readwrite", (store, done) => {
    const read = store.get(id);
    read.onsuccess = () => {
      if (!read.result) return done();
      const write = store.put({ ...read.result, ...patch, updated_at: new Date().toISOString() });
      write.onsuccess = () => done();
    };
  });
}

export async function purgeFsmOfflineIdentity(tenantId?: string, userId?: string) {
  if (!tenantId || !userId || typeof indexedDB === "undefined") return;
  const rows = await listFsmOperations({ tenantId, userId });
  await transaction<void>("readwrite", (store, done) => {
    rows.forEach((row) => store.delete(row.client_operation_id));
    done();
  });
}

export function fsmIdentityFromStorage() {
  if (typeof window === "undefined") return { tenantId: "", userId: "" };
  let user: any = {};
  try { user = JSON.parse(localStorage.getItem("user") || "{}"); } catch { /* invalid legacy value */ }
  return {
    tenantId: String(user.tenantId || localStorage.getItem("tenantId") || ""),
    userId: String(user.id || user.userId || localStorage.getItem("userId") || ""),
  };
}
