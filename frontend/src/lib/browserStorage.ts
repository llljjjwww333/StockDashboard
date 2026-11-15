export type StorageIssue = 'read' | 'write' | null;
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function createBrowserStorage(storage: () => StoragePort, onIssue: (issue: StorageIssue) => void) {
  return {
    getItem(name: string) {
      try { return storage().getItem(name); } catch { onIssue('read'); return null; }
    },
    setItem(name: string, value: string) {
      try { storage().setItem(name, value); onIssue(null); } catch { onIssue('write'); }
    },
    removeItem(name: string) {
      try { storage().removeItem(name); onIssue(null); } catch { onIssue('write'); }
    },
  };
}
