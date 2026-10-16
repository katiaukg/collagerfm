'use strict';

window.CollagerLocalStore = (() => {
  let database;
  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('Local storage unavailable'));
      const request = indexedDB.open('collager-local-workspace', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('covers', { keyPath: 'key' });
        request.result.createObjectStore('workspace');
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); database = null; };
        resolve(request.result);
      };
      request.onerror = () => { database = null; reject(request.error); };
      request.onblocked = () => { database = null; reject(new Error('Local storage blocked')); };
    });
    return database;
  }
  async function transact(store, mode, operation) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const request = operation(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Local write aborted'));
    });
  }
  return {
    covers: () => transact('covers', 'readonly', store => store.getAll()),
    putCover: cover => transact('covers', 'readwrite', store => store.put(cover)),
    deleteCover: key => transact('covers', 'readwrite', store => store.delete(key)),
    session: () => transact('workspace', 'readonly', store => store.get('last-session')),
    putSession: session => transact('workspace', 'readwrite', store => store.put(session, 'last-session')),
    deleteSession: () => transact('workspace', 'readwrite', store => store.delete('last-session')),
  };
})();
