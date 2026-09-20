import type { ReactNode } from "react";
import { PersonAvatar, PersonName } from "@/components/ui/Person";

/** Время записи: «20.09, 11:04» (полная дата с секундами — в подсказке). */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * Одна запись истории (общая для ленты под таблицей и вкладки «История» в карточке):
 * слева аватар в цвете человека; справа — «Имя (цветом) + что сделал», время по правому краю,
 * а ниже — что именно изменилось (detail).
 */
export function HistoryEntry({
  actorName,
  timestamp,
  headline,
  detail,
  badge,
}: {
  actorName: string | null | undefined;
  timestamp: string;
  /** Фраза после имени: «изменил(а) поле «Статус» в задаче …». */
  headline: ReactNode;
  detail?: ReactNode;
  /** Небольшая нейтральная метка (например, «после отправки»). */
  badge?: string;
}) {
  return (
    <li className="flex gap-3 border-t border-outline-variant/50 py-3 first:border-t-0 first:pt-0">
      <PersonAvatar name={actorName} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 text-[13px] leading-5 text-on-surface [overflow-wrap:anywhere]">
            <PersonName name={actorName} /> {headline}
            {badge && <span className="ml-1.5 rounded-sm bg-surface-high px-1.5 py-px text-[10px] font-semibold text-on-surface-variant">{badge}</span>}
          </div>
          <time dateTime={timestamp} title={new Date(timestamp).toLocaleString("ru-RU")} className="shrink-0 pt-0.5 text-[11px] text-outline">
            {formatTime(timestamp)}
          </time>
        </div>
        {detail && <div className="text-[13px]">{detail}</div>}
      </div>
    </li>
  );
}
