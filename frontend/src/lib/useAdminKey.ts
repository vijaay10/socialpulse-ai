import { useCallback, useState } from "react";

const STORAGE_KEY = "socialpulse.adminKey";

function read(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** The admin key is kept only for this browser tab session, never in the bundle. */
export function useAdminKey() {
  const [key, setKeyState] = useState(read);
  const setKey = useCallback((value: string) => {
    setKeyState(value);
    try {
      if (value) sessionStorage.setItem(STORAGE_KEY, value);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable: keep in memory only */
    }
  }, []);
  return [key, setKey] as const;
}
