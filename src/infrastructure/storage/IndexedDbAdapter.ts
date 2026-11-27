import type { DocumentIR } from '../../domain/document/DocumentIR';
import type { ProcessingTask } from '../../domain/task/TaskTypes';
import type { TerminologyEntry } from '../../domain/translation/TranslationTypes';

const DB_NAME = 'globalcodetrans_v2_db';
const DB_VERSION = 1;

const STORE_DOCUMENTS = 'documents';
const STORE_TASKS = 'tasks';
const STORE_FILES = 'files';
const STORE_TERMINOLOGY = 'terminology';

export interface StoredFileBlob {
  documentId: string;
  fileName: string;
  mimeType: string;
  buffer: ArrayBuffer;
  savedAt: string;
}

export interface SavedTaskSummary {
  task: ProcessingTask;
  fileName: string;
  pageCount: number;
  status: DocumentIR['status'];
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
        db.createObjectStore(STORE_DOCUMENTS, { keyPath: 'documentId' });
      }
      if (!db.objectStoreNames.contains(STORE_TASKS)) {
        db.createObjectStore(STORE_TASKS, { keyPath: 'taskId' });
      }
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: 'documentId' });
      }
      if (!db.objectStoreNames.contains(STORE_TERMINOLOGY)) {
        db.createObjectStore(STORE_TERMINOLOGY, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

async function putRecord<T>(storeName: string, value: T): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error(`IndexedDB write failed on ${storeName}`));
    };
  });
}

async function getRecord<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => {
      db.close();
      resolve(req.result as T | undefined);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error(`IndexedDB read failed on ${storeName}`));
    };
  });
}

async function getAllRecords<T>(storeName: string): Promise<T[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => {
      db.close();
      resolve((req.result as T[]) || []);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error(`IndexedDB getAll failed on ${storeName}`));
    };
  });
}

async function deleteRecord(storeName: string, key: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error(`IndexedDB delete failed on ${storeName}`));
    };
  });
}

export const storageAdapter = {
  async saveSnapshot(
    document: DocumentIR,
    task: ProcessingTask,
    fileBuffer?: ArrayBuffer
  ): Promise<void> {
    await putRecord(STORE_DOCUMENTS, document);
    await putRecord(STORE_TASKS, task);
    if (fileBuffer) {
      const fileBlob: StoredFileBlob = {
        documentId: document.documentId,
        fileName: document.sourceFileName,
        mimeType: document.mimeType,
        buffer: fileBuffer,
        savedAt: new Date().toISOString(),
      };
      await putRecord(STORE_FILES, fileBlob);
    }
  },

  async loadTaskBundle(taskId: string): Promise<{
    task: ProcessingTask;
    document: DocumentIR;
    file?: StoredFileBlob;
  } | null> {
    const task = await getRecord<ProcessingTask>(STORE_TASKS, taskId);
    if (!task) return null;
    const document = await getRecord<DocumentIR>(STORE_DOCUMENTS, task.documentId);
    if (!document) return null;
    const file = await getRecord<StoredFileBlob>(STORE_FILES, task.documentId);
    return { task, document, file };
  },

  async listSavedTasks(): Promise<SavedTaskSummary[]> {
    const tasks = await getAllRecords<ProcessingTask>(STORE_TASKS);
    const docs = await getAllRecords<DocumentIR>(STORE_DOCUMENTS);
    const docMap = new Map(docs.map((d) => [d.documentId, d]));
    return tasks
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((task) => {
        const doc = docMap.get(task.documentId);
        return {
          task,
          fileName: doc?.sourceFileName ?? task.fileName,
          pageCount: doc?.pageCount ?? task.totalPages,
          status: doc?.status ?? 'IMPORTED',
        };
      });
  },

  async deleteTaskBundle(taskId: string, documentId: string): Promise<void> {
    await deleteRecord(STORE_TASKS, taskId);
    await deleteRecord(STORE_DOCUMENTS, documentId);
    await deleteRecord(STORE_FILES, documentId);
  },

  async saveTerminology(entries: TerminologyEntry[]): Promise<void> {
    const existing = await getAllRecords<TerminologyEntry>(STORE_TERMINOLOGY);
    for (const item of existing) {
      await deleteRecord(STORE_TERMINOLOGY, item.id);
    }
    for (const entry of entries) {
      await putRecord(STORE_TERMINOLOGY, entry);
    }
  },

  async loadTerminology(): Promise<TerminologyEntry[]> {
    return getAllRecords<TerminologyEntry>(STORE_TERMINOLOGY);
  },
};
