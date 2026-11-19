// Remember downloaded map tiles in the browser (IndexedDB) so revisiting a place is instant
// and we stay polite to the free OpenStreetMap servers.
let dbp = null;
function db() {
  return (dbp ||= new Promise((resolve) => {
    try {
      const req = indexedDB.open('blockearth', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('tiles');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  }));
}

export async function cacheGet(key) {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    const r = d.transaction('tiles').objectStore('tiles').get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => resolve(null);
  });
}

export async function cachePut(key, value) {
  const d = await db();
  if (!d) return;
  try { d.transaction('tiles', 'readwrite').objectStore('tiles').put(value, key); } catch { /* storage full: ignore */ }
}
