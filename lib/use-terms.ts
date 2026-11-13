"use client";

import { useEffect, useState } from "react";
import { loadBootstrap } from "@/lib/client-bootstrap";
import { DEFAULT_TERMS, normalizeTerms, type Terms } from "@/lib/terms";

/** Названия разделов таблицы в дирекции человека (lib/terms.ts); до загрузки — по умолчанию. */
export function useTerms(): Terms {
  const [terms, setTerms] = useState<Terms>(DEFAULT_TERMS);
  useEffect(() => {
    let alive = true;
    loadBootstrap().then((b) => alive && setTerms(normalizeTerms(b?.terms)));
    return () => {
      alive = false;
    };
  }, []);
  return terms;
}
