"use client";

import { useEffect } from "react";

/**
 * Reloads the page on an interval — used while a fact-check is pending so
 * the result appears without a manual refresh. A full reload (rather than
 * router.refresh()) guarantees fresh server HTML regardless of the client
 * router cache; it unmounts (and stops) once the pending state resolves.
 */
export default function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  useEffect(() => {
    const id = setInterval(() => window.location.reload(), seconds * 1000);
    return () => clearInterval(id);
  }, [seconds]);
  return null;
}
