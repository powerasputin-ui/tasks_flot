"use client";

import { useEffect, useState } from "react";

export const CHUNK = 150;

export type Chunk = { limit: number; more: () => void; all: () => void };

/** Порционный показ длинных таблиц: сначала CHUNK строк; смена фильтров (`resetOn`) возвращает первую порцию. */
export function useChunk(total: number, resetOn: unknown[], forceLimit?: number): Chunk {
  const [limit, setLimit] = useState(CHUNK);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setLimit(CHUNK), resetOn);
  return {
    limit: forceLimit ?? limit,
    more: () => setLimit((l) => l + CHUNK),
    all: () => setLimit(Math.max(total, CHUNK)),
  };
}

export function ShowMore({ chunk, total }: { chunk: Chunk; total: number }) {
  if (total <= chunk.limit) return total > CHUNK ? <p className="mt-2 text-center text-[12px] text-on-surface-variant">Показаны все {total}</p> : null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[13px]">
      <span className="text-on-surface-variant">
        Показано {chunk.limit} из {total}
      </span>
      <button onClick={chunk.more} className="btn-ghost h-8">
        Показать ещё {CHUNK}
      </button>
      <button onClick={chunk.all} className="btn-ghost h-8">
        Показать все ({total})
      </button>
    </div>
  );
}
