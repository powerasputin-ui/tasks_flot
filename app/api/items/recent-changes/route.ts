import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canViewItems } from "@/lib/permissions";
import { clipText, describeAuditAction, FIELD_LABEL, formatAuditValue, type NameMaps } from "@/lib/audit-format";
import { CUSTOM_FIELD_PREFIX } from "@/lib/custom-columns";
import { getDicts } from "@/lib/dictionaries";

// Предохранитель для очень старых записей: лимиты ввода (2000/300) держат обычные значения намного короче.
const FEED_VALUE_MAX = 4000;

const names = <V extends { name: string }>(m: Map<string, V>) => new Map([...m].map(([id, v]) => [id, v.name]));

// Лента последних изменений по видимым пользователю позициям (сегмент — необязательный фильтр).
// Быстрый путь: события читаются одним запросом, названия позиций — вторым только для тех, что попали в ленту;
// имена справочников и людей берутся из кэша (lib/dictionaries), а не отдельными запросами.
export async function GET(request: NextRequest) {
  const actor = await requireActor();
  if (!canViewItems(actor.role)) return NextResponse.json({ events: [] });

  const sp = new URL(request.url).searchParams;
  const segmentIds = (sp.get("segmentIds") ?? "").split(",").filter(Boolean);
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 30, 1), 100);

  // Фильтр по сегменту требует списка позиций сегмента; без фильтра этот запрос не нужен.
  let entityFilter: { entityId?: { in: string[] } } = {};
  if (segmentIds.length) {
    const inSegments = await prisma.operationalItem.findMany({
      where: { OR: [{ segmentId: { in: segmentIds.filter((s) => s !== "none") } }, ...(segmentIds.includes("none") ? [{ segmentId: null }] : [])] },
      select: { id: true },
    });
    if (inSegments.length === 0) return NextResponse.json({ events: [] });
    entityFilter = { entityId: { in: inSegments.map((i) => i.id) } };
  }

  const [events, dicts] = await Promise.all([
    prisma.auditEvent.findMany({
      where: { entityType: "OperationalItem", ...entityFilter },
      orderBy: { timestamp: "desc" },
      take: limit,
    }),
    getDicts(),
  ]);

  const ids = [...new Set(events.map((e) => e.entityId))];
  const titles = ids.length ? await prisma.operationalItem.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } }) : [];
  const titleById = new Map(titles.map((i) => [i.id, i.title]));

  const maps: NameMaps = {
    segmentId: names(dicts.segments),
    trackId: names(dicts.tracks),
    attractivenessId: names(dicts.attractiveness),
    statusId: names(dicts.statuses),
    responsibleId: names(dicts.users),
  };
  const customById = new Map(dicts.customColumns.map((c) => [`${CUSTOM_FIELD_PREFIX}${c.id}`, c]));

  const labelOf = (field: string) => FIELD_LABEL[field] ?? customById.get(field)?.name ?? (field.startsWith(CUSTOM_FIELD_PREFIX) ? "Доп. поле" : field);
  const valueOf = (field: string, v: string | null) => {
    const custom = customById.get(field);
    const text = custom ? (v && custom.type === "DATE" ? new Date(v).toLocaleDateString("ru-RU") : v || "—") : formatAuditValue(field, v, maps);
    return clipText(text, FEED_VALUE_MAX);
  };

  return NextResponse.json({
    events: events
      .filter((e) => titleById.has(e.entityId)) // событие удалённой позиции в ленту не берём
      .map((e) => ({
        id: e.id,
        timestamp: e.timestamp.toISOString(),
        actorName: (e.actorId && dicts.users.get(e.actorId)?.name) || "Система",
        itemId: e.entityId,
        itemTitle: titleById.get(e.entityId) ?? "—",
        action: e.action,
        what: describeAuditAction(e.action, e.fieldName),
        field: e.fieldName,
        label: e.fieldName ? labelOf(e.fieldName) : null,
        before: e.fieldName ? valueOf(e.fieldName, e.before) : null,
        after: e.fieldName ? valueOf(e.fieldName, e.after) : null,
      })),
  });
}
