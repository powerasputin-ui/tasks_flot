"""Эталонные ответы экзамена — своим кодом прямо из боевой базы (только чтение), без функций приложения.

expected(question) → {"items": [позиции], "count": число?, "names": [имена], "strings": [обязательные фразы],
"forbidden_items": [...], "manual": пояснение?, "no_data": bool}
"""
import json
from datetime import datetime, timedelta, timezone
from db import sql

CLOSED = {"Завершено", "Не актуально"}
MSK = timezone(timedelta(hours=3))


def today_msk():
    return datetime.now(MSK).date()


class Data:
    def __init__(self, directorate: str, cycle_number: int):
        self.dir = directorate
        self.users = {u["id"]: u["name"] for u in sql("SELECT id, name FROM users")}
        self.segments = {s["id"]: s["name"] for s in sql('SELECT id, name FROM segments WHERE "directorateId" = $1', [directorate])}
        self.tracks = {t["id"]: t["name"] for t in sql('SELECT id, name FROM tracks WHERE "directorateId" = $1', [directorate])}
        self.statuses = {s["id"]: s["name"] for s in sql("SELECT id, name FROM statuses")}
        rows = sql(
            'SELECT id, title, comment, "segmentId", "trackId", "responsibleId", "createdById", "updatedById", deadline, "statusId", "operFlag", '
            '"archivedAt", "createdAt", "updatedAt", files::text AS files, cost FROM operational_items WHERE "directorateId" = $1',
            [directorate],
        )
        self.items = []
        for r in rows:
            self.items.append({
                "id": r["id"],
                "title": r["title"],
                "comment": r["comment"] or "",
                "segment": self.segments.get(r["segmentId"]),
                "track": self.tracks.get(r["trackId"]),
                "responsible": self.users.get(r["responsibleId"]) if r["responsibleId"] else None,
                "author": self.users.get(r["createdById"]),
                "updated_by": self.users.get(r["updatedById"]) if r["updatedById"] else None,
                "deadline": datetime.fromisoformat(r["deadline"][:10]).date() if r["deadline"] else None,
                "status": self.statuses.get(r["statusId"]),
                "submitted": r["operFlag"],
                "archived": bool(r["archivedAt"]),
                "files": json.loads(r["files"] or "[]"),
                "cost": r["cost"],
            })
        self.by_id = {i["id"]: i for i in self.items}
        cyc = sql('SELECT id, number, "meetingDate", deadline, "memoDraft"::text AS draft FROM cycles WHERE "directorateId" = $1 AND number = $2', [directorate, cycle_number])[0]
        self.cycle = cyc
        self.draft = json.loads(cyc["draft"]) if cyc["draft"] else {"sections": []}
        self.bullets = [
            {"section": s["title"], **b}
            for s in self.draft["sections"]
            for b in s["bullets"]
            if not b.get("hidden") and b.get("text", "").strip()
        ]
        v = sql('SELECT id, title, doc::text AS doc FROM memo_versions WHERE "directorateId" = $1 ORDER BY "sentAt" DESC LIMIT 1', [directorate])
        self.last_version = {"id": v[0]["id"], "title": v[0]["title"], "doc": json.loads(v[0]["doc"])} if v else None


def _match(i: dict, c: dict, today) -> bool:
    if c.get("archived_only"):
        return i["archived"]
    if i["archived"]:
        return False
    if "responsible" in c and not (i["responsible"] or "").startswith(c["responsible"]):
        return False
    if "segment" in c and i["segment"] != c["segment"]:
        return False
    if "track" in c and i["track"] != c["track"]:
        return False
    if "status" in c and i["status"] != c["status"]:
        return False
    if c.get("status_none") and i["status"] is not None:
        return False
    if c.get("no_deadline") and i["deadline"] is not None:
        return False
    if c.get("no_responsible") and i["responsible"] is not None:
        return False
    if c.get("not_submitted") and i["submitted"]:
        return False
    if c.get("overdue") and not (i["deadline"] and i["deadline"] < today and i["status"] not in CLOSED):
        return False
    if "due_within_days" in c and not (i["deadline"] and today <= i["deadline"] <= today + timedelta(days=c["due_within_days"]) and i["status"] not in CLOSED):
        return False
    return True


def expected(q: dict, d: Data) -> dict:
    c = q["check"]
    t = c["type"]
    today = today_msk()
    if t == "memo_meta":
        md = d.cycle["meetingDate"]
        return {"strings": [f"№{d.cycle['number']}" if True else ""], "date": md[:10] if md else None, "note": "дата совещания " + (md[:10] if md else "не заполнена")}
    if t == "memo_sections":
        secs = [(s["title"], len([b for b in s["bullets"] if not b.get("hidden") and b.get("text", "").strip()])) for s in d.draft["sections"]]
        secs = [s for s in secs if s[1] > 0]
        return {"count": sum(n for _, n in secs), "strings": [s for s, _ in secs], "note": "; ".join(f"{s}: {n}" for s, n in secs)}
    if t == "memo_bullets":
        bs = d.bullets
        if "section" in c:
            bs = [b for b in bs if c["section"].lower() in b["section"].lower()]
        if c.get("changed_by"):
            bs = [b for b in bs if b.get("changedBy")]
        if c.get("fresh"):
            bs = [b for b in bs if b.get("fresh")]
        items = [d.by_id[x] for b in bs for x in b["itemIds"] if x in d.by_id]
        out = {"items": items, "note": "; ".join(f"«{b['text'][:60]}…»" + (f" (правил {b['changedBy']})" if b.get("changedBy") else "") for b in bs)}
        if c.get("count"):
            out["count"] = len(bs)
        if c.get("changed_by"):
            out["names"] = sorted({b["changedBy"] for b in bs})
        return out
    if t == "items":
        its = [i for i in d.items if _match(i, c, today)]
        if c.get("in_memo"):
            memo_ids = {x for b in d.bullets for x in b["itemIds"]}
            its = [i for i in its if i["id"] in memo_ids]
        out = {"items": its}
        if c.get("count"):
            out["count"] = len(its)
        if c.get("names") == "responsible":
            out["names"] = sorted({i["responsible"] for i in its if i["responsible"]})
        if not its:
            out["no_data"] = True
        return out
    if t == "counts_status":
        act = [i for i in d.items if not i["archived"]]
        done = [i for i in act if i["status"] == "Завершено"]
        return {"count_pair": (len(act), len(done)), "note": f"активных {len(act)}, завершено {len(done)}"}
    if t == "who":
        its = [i for i in d.items if c["contains"].lower() in i["title"].lower() and not i["archived"]]
        i = its[0]
        if c.get("field") == "responsible":
            return {"items": its, "names": [i["responsible"]]}
        return {"items": its, "names": sorted({i["author"], i["updated_by"]} - {None}), "note": f"автор {i['author']}, последним менял {i['updated_by']}"}
    if t in ("audit_week", "audit_today_submit"):
        ids = [i["id"] for i in d.items]
        rows = sql(
            'SELECT a."entityId", a.action, a."fieldName", a.after, a.timestamp, u.name FROM audit_events a LEFT JOIN users u ON u.id = a."actorId" '
            "WHERE a.\"entityType\" = 'OperationalItem' AND a.timestamp > now() - interval '7 days' AND a.\"entityId\" = ANY($1) ORDER BY a.timestamp",
            [ids],
        )
        if t == "audit_today_submit":
            today_s = today.isoformat()
            subs = [r for r in rows if r["action"] == "OPER_FLAG_CHANGE" and r["after"] == "true" and (datetime.fromisoformat(r["timestamp"]).replace(tzinfo=timezone.utc).astimezone(MSK).date().isoformat() == today_s)]
            return {"names": sorted({r["name"] for r in subs}), "items": [d.by_id[r["entityId"]] for r in subs if r["entityId"] in d.by_id], "note": f"подач сегодня: {len(subs)}"}
        created = [r for r in rows if r["action"] == "CREATE"]
        return {"manual": True, "note": f"за 7 дней: событий {len(rows)}, создано позиций {len(created)}, подач {sum(1 for r in rows if r['action'] == 'OPER_FLAG_CHANGE' and r['after'] == 'true')}, правок текста {sum(1 for r in rows if r['fieldName'] == 'title')}, правок файлов {sum(1 for r in rows if r['fieldName'] == 'files')}"}
    if t == "docs":
        its = [i for i in d.items if not i["archived"] and any(c["contains"].lower() in (f["name"] + i["title"]).lower() for f in i["files"])]
        files = [f for i in its for f in i["files"] if c["contains"].lower() in (f["name"] + i["title"]).lower()]
        return {"strings": [f["name"] for f in files], "paths": [f["path"] for f in files]}
    if t == "docs_memo":
        memo_ids = {x for b in d.bullets for x in b["itemIds"]}
        files = [f for i in d.items if i["id"] in memo_ids for f in i["files"]]
        return {"strings": [f["name"] for f in files], "count": len(files)}
    if t == "no_data":
        return {"no_data": True}
    if t == "rights_hidden":
        return {"forbidden_items": [i for i in d.items if i["archived"]]}
    if t == "version_bullets":
        v = d.last_version
        bs = [b for s in v["doc"]["sections"] for b in s["bullets"] if not b.get("hidden") and c["contains"].lower() in (s["title"] + b["text"]).lower()]
        return {"items": [d.by_id[x] for b in bs for x in b["itemIds"] if x in d.by_id], "note": f"справка «{v['title']}»: " + "; ".join(b["text"][:80] for b in bs)}
    if t == "manual":
        return {"manual": True, "note": c.get("note") or c.get("rule", "")}
    raise ValueError(t)
