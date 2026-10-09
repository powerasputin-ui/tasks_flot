"""Обзор данных дирекции для составления вопросов экзамена (только чтение). Пишет data/overview.txt."""
import json
import sys
from collections import Counter
from db import DATA, sql

DIR = sys.argv[1] if len(sys.argv) > 1 else "dir_fleet"
out: list[str] = []
p = out.append

users = {u["id"]: u for u in sql("SELECT id, name, role FROM users")}
segs = {s["id"]: s["name"] for s in sql('SELECT id, name FROM segments WHERE "directorateId" = $1', [DIR])}
tracks = {t["id"]: t["name"] for t in sql('SELECT id, name FROM tracks WHERE "directorateId" = $1', [DIR])}
statuses = {s["id"]: s["name"] for s in sql("SELECT id, name FROM statuses")}
items = sql(
    'SELECT id, title, comment, "segmentId", "trackId", "responsibleId", "createdById", "updatedById", deadline, "statusId", "operFlag", '
    '"archivedAt", "createdAt", "updatedAt", files::text AS files, cost FROM operational_items WHERE "directorateId" = $1 ORDER BY "createdAt"',
    [DIR],
)
p(f"Дирекция {DIR}: позиций {len(items)} (удалённых {sum(1 for i in items if i['archivedAt'])})")
p(f"Сегменты: {list(segs.values())}")
p(f"Треки: {list(tracks.values())}")
nm = lambda uid: users.get(uid, {}).get("name") if uid else None
p("Ответственные: " + str(Counter(nm(i["responsibleId"]) for i in items)))
p("Авторы: " + str(Counter(nm(i["createdById"]) for i in items)))
p("Статусы: " + str(Counter(statuses.get(i["statusId"]) for i in items)))
p("")
for i in items:
    files = json.loads(i["files"] or "[]")
    p(
        f"- {i['id']} | {'УДАЛЕНА ' if i['archivedAt'] else ''}{'подана ' if i['operFlag'] else ''}| сегм: {segs.get(i['segmentId'])} | трек: {tracks.get(i['trackId'])} | "
        f"«{i['title']}» | отв: {nm(i['responsibleId'])} | автор: {nm(i['createdById'])} | менял: {nm(i['updatedById'])} | "
        f"статус: {statuses.get(i['statusId'])} | срок: {(i['deadline'] or '')[:10]} | созд: {i['createdAt'][:10]} | изм: {i['updatedAt'][:10]} | "
        f"файлов: {len(files)} | комм: {(i['comment'] or '')[:120]!r}"
    )
p("")
cycles = sql('SELECT id, number, status, "meetingDate", deadline, "memoDraft"::text AS draft FROM cycles WHERE "directorateId" = $1 ORDER BY "createdAt" DESC', [DIR])
for c in cycles:
    d = json.loads(c["draft"]) if c["draft"] else None
    p(f"Цикл №{c['number']} {c['status']} совещание {c['meetingDate']} срок подачи {c['deadline']}; заголовок: {d.get('title') if d else None}")
    if d:
        for s in d["sections"]:
            vis = [b for b in s["bullets"] if not b.get("hidden")]
            p(f"   Раздел «{s['title']}»: {len(vis)} пунктов")
            for b in vis:
                p(f"      • {b['text'][:150]!r} items={b['itemIds']} fresh={b.get('fresh')} changedBy={b.get('changedBy')}")
versions = sql('SELECT id, "cycleId", revision, title, "meetingDate", "sentAt" FROM memo_versions WHERE "directorateId" = $1 ORDER BY "sentAt"', [DIR])
p(f"\nОтправленные справки: {len(versions)}")
for v in versions:
    p(f"   {v['id']} ред.{v['revision']} «{v['title']}» совещание {v['meetingDate']} отправлена {v['sentAt']}")
audit = sql(
    'SELECT a."entityId", a.action, a."fieldName", a.before, a.after, a.timestamp, u.name FROM audit_events a LEFT JOIN users u ON u.id = a."actorId" '
    "WHERE a.\"entityType\" = 'OperationalItem' AND a.timestamp > now() - interval '7 days' AND a.\"entityId\" IN (SELECT id FROM operational_items WHERE \"directorateId\" = $1) ORDER BY a.timestamp",
    [DIR],
)
p(f"\nЖурнал правок за 7 дней: {len(audit)} записей")
for a in audit[:200]:
    p(f"   {a['timestamp'][:16]} {a['name']} {a['action']} {a['fieldName']}: {str(a['before'])[:40]!r} → {str(a['after'])[:40]!r} [{a['entityId']}]")

DATA.mkdir(exist_ok=True)
(DATA / "overview.txt").write_text("\n".join(out), encoding="utf-8")
print("\n".join(out[:8]))
print(f"... всего строк: {len(out)} → {DATA / 'overview.txt'}")
