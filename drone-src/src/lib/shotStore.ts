import type { InteriorShot, InteriorShotType, InteriorShotView } from "../types";
import { DEFAULT_ESTATE_SHOTS } from "../data/house";

const DB_NAME = "property-drone-view";
const DB_VERSION = 1;
const STORE_NAME = "interior-shots";

interface ShotRecord {
  id: string;
  name: string;
  roomKey: string;
  waypointId: string;
  type: InteriorShotType;
  blob?: Blob;
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
  });
}

export async function saveShot(shot: InteriorShot): Promise<void> {
  const db = await openDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(shot as ShotRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}

export async function listShots(): Promise<InteriorShotView[]> {
  const defaultShots: InteriorShotView[] = DEFAULT_ESTATE_SHOTS.map((s, idx) => ({
    id: s.id,
    name: s.name,
    roomKey: s.roomKey,
    waypointId: s.waypointId,
    type: s.type,
    createdAt: 1000 + idx,
    objectUrl: s.imageUrl,
    isDefault: true,
    tag: s.tag,
  }));

  try {
    const db = await openDb();

    const userRecords = await new Promise<ShotRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as ShotRecord[]);
    });

    db.close();

    const userShots: InteriorShotView[] = userRecords.map((r) => ({
      id: r.id,
      name: r.name,
      roomKey: r.roomKey,
      waypointId: r.waypointId,
      type: r.type,
      createdAt: r.createdAt,
      objectUrl: r.blob ? URL.createObjectURL(r.blob) : "",
      isDefault: false,
    }));

    return [...defaultShots, ...userShots].sort((a, b) => a.createdAt - b.createdAt);
  } catch (err) {
    console.warn("IndexedDB unavailable, using default estate shots:", err);
    return defaultShots;
  }
}

export async function deleteShot(id: string): Promise<void> {
  try {
    const db = await openDb();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();
  } catch (_) {}
}
