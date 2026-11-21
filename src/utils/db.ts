// ============================================================================
// db.ts — IndexedDB checkpoint persistence (Innovation: crash-safe resume)
// ============================================================================
// Every completed paragraph is auto-saved to IndexedDB after Agent 5 finishes.
// If the user refreshes or closes the tab mid-thesis, they can resume from the
// exact paragraph without losing WebGPU work. No cross-origin network — purely
// local IndexedDB.

const DB_NAME = "proseforge-checkpoints";
const DB_VERSION = 1;
const STORE = "paragraphs";
const META_STORE = "meta";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("byFilename", "filename", { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "filename" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

interface CheckpointRow {
  key: string; // `${filename}::${index}`
  filename: string;
  index: number;
  paragraph: unknown; // ExtractedParagraph (kept as unknown for struct freedom)
  savedAt: number;
}

interface MetaRow {
  filename: string;
  docxBlob: ArrayBuffer;
  totalParagraphs: number;
  intensity: string;
  modelId: string;
  createdAt: number;
}

export async function saveParagraphCheckpoint(
  filename: string,
  index: number,
  paragraph: unknown
): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({
        key: `${filename}::${index}`,
        filename,
        index,
        paragraph,
        savedAt: Date.now(),
      } satisfies CheckpointRow);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Best-effort: never break the pipeline over a checkpoint write failure.
  }
}

export async function loadCheckpoint(
  filename: string
): Promise<{ index: number; paragraph: unknown } | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const idx = tx.objectStore(STORE).index("byFilename");
      const req = idx.getAll(IDBKeyRange.only(filename));
      req.onsuccess = () => {
        const rows = (req.result as CheckpointRow[]) ?? [];
        if (rows.length === 0) {
          resolve(null);
          return;
        }
        rows.sort((a, b) => a.index - b.index);
        const last = rows[rows.length - 1];
        resolve({ index: last.index, paragraph: last.paragraph });
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function listAllCheckpoints(): Promise<
  { filename: string; count: number; savedAt: number }[]
> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const rows = (req.result as CheckpointRow[]) ?? [];
        const byFile = new Map<string, { count: number; savedAt: number }>();
        for (const r of rows) {
          const cur = byFile.get(r.filename);
          if (!cur || r.savedAt > cur.savedAt) {
            byFile.set(r.filename, {
              count: (cur?.count ?? 0) + 1,
              savedAt: r.savedAt,
            });
          } else {
            cur.count += 1;
          }
        }
        resolve(
          [...byFile.entries()].map(([filename, v]) => ({
            filename,
            count: v.count,
            savedAt: v.savedAt,
          }))
        );
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveMeta(row: MetaRow): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      tx.objectStore(META_STORE).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* best-effort */
  }
}

export async function loadMeta(
  filename: string
): Promise<MetaRow | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const req = tx.objectStore(META_STORE).get(filename);
      req.onsuccess = () => resolve((req.result as MetaRow) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearCheckpoint(filename: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, META_STORE], "readwrite");
      tx.objectStore(STORE).delete(IDBKeyRange.only(filename));
      tx.objectStore(META_STORE).delete(filename);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* best-effort */
  }
}

export async function clearAllCheckpoints(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, META_STORE], "readwrite");
      tx.objectStore(STORE).clear();
      tx.objectStore(META_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* best-effort */
  }
}
