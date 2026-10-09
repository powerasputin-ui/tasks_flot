"""Экзамен ИИ-помощников на боевом сайте: вопросы → ответы облачной модели → сверка с эталоном из базы → отчёт.

Запуск: python run.py [только_id,через,запятую]
Временные учётки (директор дирекции, ЗГД) создаются и удаляются в конце. Пишет data/report-<время>.md и .json.
"""
import json
import re
import statistics
import sys
import time
from datetime import datetime
from db import DATA, create_temp_user, drop_temp_user, sql
from reference import Data, expected

QS = json.loads((DATA / "questions.json").read_text(encoding="utf-8"))
ONLY = set(sys.argv[1].split(",")) if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else None


def norm(s: str) -> str:
    # любые пробелы (неразрывные, узкие) — обычные; регистр и «ё» не важны
    return re.sub(r"\s+", " ", (s or "").lower().replace("ё", "е"))


WORD = re.compile(r"[a-zа-я0-9]{3,}")


def stems(text: str) -> set[str]:
    return {w[:6] for w in WORD.findall(norm(text)) if len(w) >= 5 or re.match(r"[a-z0-9]", w)}


def item_keys(item: dict, all_items: list[dict]) -> list[str]:
    """Слова, по которым позицию можно узнать в ответе: есть в её названии и почти нет в других."""
    mine = stems(item["title"])
    others = [stems(o["title"]) for o in all_items if o["id"] != item["id"]]
    rare = sorted(mine, key=lambda w: sum(w in o for o in others))
    return [w for w in rare if sum(w in o for o in others) <= 1][:6]


def line_owner(line: str, all_items: list[dict]):
    """К какой позиции относится строка ответа: у какой больше всего общих слов (модель пересказывает своими словами)."""
    ls = stems(line)
    best, best_score, second = None, 0.0, 0.0
    for it in all_items:
        st = list(stems(it["title"]))[:30]
        if not st:
            continue
        sc = len(ls & set(st)) / len(st)
        if sc > best_score:
            best, second, best_score = it, best_score, sc
        elif sc > second:
            second = sc
    return best if best_score >= 0.22 and best_score - second >= 0.05 else None


LABELS: dict[str, str] = {}  # метка [Т7] → id позиции (из заголовка X-AI-Items текущего ответа)


def mentioned(item: dict, answer: str, all_items: list[dict]) -> bool:
    # метка позиции в ответе ([Т7]) — тоже упоминание: чат показывает её ссылкой на позицию
    if any(f"[{l}]" in answer for l, i in LABELS.items() if i == item["id"]):
        return True
    a = norm(answer)
    keys = item_keys(item, all_items)
    if not keys:  # короткое название («ыы», «тест») — ищем целиком в кавычках
        return f"«{norm(item['title'])}»" in a or f'"{norm(item["title"])}"' in a
    if sum(1 for k in keys if k in a) >= min(2, len(keys)):
        return True
    lines = [x for x in re.split(r"\n+", answer) if x.strip()]
    return any(line_owner(x, all_items) is item for x in lines)


HONEST = re.compile(r"(^\s*нет[.,!]|задач нет|позиций нет|таких позиций нет|нет данных|не указан|нет информации|не нашел|не найден|не найдено|отсутству|нет в справке|в справке нет|нет такого|нет сведений|не содерж|не удалось найти|нет позиций|не значится|нет ответственного|нет задач|не имеет|нет ни одной)")


def score(q: dict, exp: dict, answer: str, items: list[dict]) -> dict:
    res: dict = {"checks": []}
    ok = True

    def add(name, passed, detail=""):
        nonlocal ok
        res["checks"].append({"name": name, "ok": passed, "detail": detail})
        ok = ok and passed

    if exp.get("manual"):
        res["verdict"] = "ручная оценка"
        return res
    if "items" in exp and exp["items"] and q["check"].get("list", True):
        exp["items"] = list({i["id"]: i for i in exp["items"]}.values())  # одна позиция могла попасть дважды (две подачи)
        exp_ids = {i["id"] for i in exp["items"]}
        hit = [i for i in exp["items"] if mentioned(i, answer, items)]
        extra = [i for i in items if i["id"] not in exp_ids and mentioned(i, answer, items)]
        res["recall"] = f"{len(hit)}/{len(exp_ids)}"
        add("полнота", len(hit) == len(exp_ids), "не названы: " + "; ".join(f"«{i['title'][:50]}»" for i in exp["items"] if i not in hit) if len(hit) < len(exp_ids) else "")
        add("лишнее", not extra, "лишние: " + "; ".join(f"«{i['title'][:50]}»" for i in extra) if extra else "")
    if exp.get("no_data"):
        add("честно «нет данных»", bool(HONEST.search(norm(answer))))
    if "count" in exp:
        nums = {int(n) for n in re.findall(r"(?<![\d.,])\d{1,3}(?!\d|[.,]\d)", answer)}
        add("число", exp["count"] in nums, f"ожидалось {exp['count']}")
    if "count_pair" in exp:
        nums = {int(n) for n in re.findall(r"(?<![\d.,])\d{1,3}(?!\d|[.,]\d)", answer)}
        a, b = exp["count_pair"]
        add("числа", a in nums and b in nums, f"ожидалось {a} и {b}")
    for n in exp.get("names", []):
        add("имя", norm(n.split()[0]) in norm(answer), n)
    for s in exp.get("strings", []):
        key = norm(s)[:28]
        if key.startswith("№"):  # «№3» ~ «оперативка 3» / «№ 3»
            # «№3», «оперативка №3», «номер текущей оперативки — 3»
            add("номер", bool(re.search(r"(№\s*|оперативк\w*\D{0,6})" + key[1:] + r"(?!\d)", norm(answer))), s)
            continue
        add("фраза", key in norm(answer), s)
    if "date" in exp:
        if exp["date"]:
            y, m, d_ = exp["date"].split("-")
            add("дата", f"{d_}.{m}.{y}" in answer, f"{d_}.{m}.{y}")
        else:
            add("дата не заполнена", bool(re.search(r"(не заполн|не указан|отсутств|нет дат)", norm(answer))))
    for f in exp.get("forbidden_items", []):
        add("скрыто от ЗГД", not mentioned(f, answer, items), f"«{f['title']}»")
    if "paths" in exp:
        for p_ in exp["paths"]:
            add("путь", p_.replace("\\\\", "\\")[:30].lower() in answer.replace("\\\\", "\\").lower(), p_)
    res["verdict"] = "верно" if ok else "ошибка"
    return res


def main():
    d = Data(QS["directorate"], QS["cycle_number"])
    cycle_id = d.cycle["id"]
    users = {}
    rows = []
    try:
        users["director"] = create_temp_user("DIRECTOR", QS["directorate"], "dir")
        users["zgd"] = create_temp_user("MANAGEMENT", None, "zgd")
        for q in QS["questions"]:
            if ONLY and q["id"] not in ONLY:
                continue
            exp = expected(q, d)
            role = q.get("role", "director")
            s = users[role][1]
            msgs = [{"role": "user", "content": q["q"]}]
            if q["ask"] == "assist":
                st, body, h, sec = s.post("/api/ai/memo-assist", {"cycleId": cycle_id, "mode": "chat", "messages": msgs})
            else:
                st, body, h, sec = s.post("/api/ai/chat", {"messages": msgs})
            answer = body if st == 200 else f"[HTTP {st}] {body[:300]}"
            import urllib.parse
            LABELS.clear()
            if h.get("x-ai-items"):
                LABELS.update({x["l"]: x["i"] for x in json.loads(urllib.parse.unquote(h["x-ai-items"]))})
            sc = score(q, exp, answer, d.items) if st == 200 else {"verdict": "ошибка", "checks": [{"name": "HTTP", "ok": False, "detail": str(st)}]}
            rows.append({"id": q["id"], "group": q["group"], "q": q["q"], "answer": answer, "sec": sec, "model": h.get("x-ai-model", ""), "labels": dict(LABELS),
                         "expected": {k: ([f"«{i['title'][:70]}» ({i['responsible']}, {i['status']}, срок {i['deadline']})" for i in v] if k in ("items", "forbidden_items") else v) for k, v in exp.items()},
                         **sc})
            print(f"{q['id']:4} {sc['verdict']:14} {sec:5}с  {q['q'][:60]}")
            time.sleep(1.5)  # не упираться в лимит запросов
    finally:
        for role, (uid, _) in users.items():
            left = drop_temp_user(uid)
            print(f"временная учётка {role} удалена" if left == 0 else f"!!! учётка {role} НЕ удалена")
    write_report(rows)


def previous_verdicts() -> dict:
    """Вердикты прошлого прогона — чтобы в отчёте было видно, что исправилось и что сломалось."""
    import glob
    files = sorted(glob.glob(str(DATA / "report-*.json")))
    if not files:
        return {}
    return {r["id"]: r["verdict"] for r in json.loads(open(files[-1], encoding="utf-8").read())}


def write_report(rows):
    prev = previous_verdicts()
    for r in rows:
        r["prev"] = prev.get(r["id"])
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    (DATA / f"report-{stamp}.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    groups: dict = {}
    for r in rows:
        g = groups.setdefault(r["group"], {"верно": 0, "ошибка": 0, "ручная оценка": 0})
        g[r["verdict"]] += 1
    secs = [r["sec"] for r in rows]
    lines = [f"# Экзамен ИИ-помощника — {datetime.now():%d.%m.%Y %H:%M}", "",
             f"Вопросов: {len(rows)}; верно {sum(r['verdict'] == 'верно' for r in rows)}, ошибок {sum(r['verdict'] == 'ошибка' for r in rows)}, на ручную оценку {sum(r['verdict'] == 'ручная оценка' for r in rows)}.",
             f"Время ответа: медиана {statistics.median(secs):.1f} с, худшее {max(secs):.1f} с.", "", "| Группа | Верно | Ошибка | Ручная |", "|---|---|---|---|"]
    lines += [f"| {g} | {v['верно']} | {v['ошибка']} | {v['ручная оценка']} |" for g, v in groups.items()]
    fixed = [r["id"] for r in rows if r.get("prev") == "ошибка" and r["verdict"] == "верно"]
    broke = [r["id"] for r in rows if r.get("prev") == "верно" and r["verdict"] == "ошибка"]
    if fixed or broke:
        lines += ["", f"По сравнению с прошлым прогоном: исправлено {', '.join(fixed) or '—'}; сломалось {', '.join(broke) or '—'}."]
    for r in rows:
        lines += ["", f"## {r['id']} · {r['group']} · **{r['verdict']}** · {r['sec']} с", f"**Вопрос:** {r['q']}", "", "**Эталон:**"]
        for k, v in r["expected"].items():
            if isinstance(v, list):
                lines += [f"- {k}:"] + [f"  - {x}" for x in v]
            else:
                lines.append(f"- {k}: {v}")
        bad = [c for c in r.get("checks", []) if not c["ok"]]
        if bad:
            lines.append("**Не прошло:** " + "; ".join(f"{c['name']} — {c['detail']}" for c in bad))
        lines += ["", "**Ответ:**", "", "> " + r["answer"].replace("\n", "\n> ")]
    path = DATA / f"report-{stamp}.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nотчёт: {path}")


def rescore():
    """Пересчитать оценки по последнему сохранённому прогону (без новых вопросов к сайту)."""
    import glob
    d = Data(QS["directorate"], QS["cycle_number"])
    rows = json.loads(open(sorted(glob.glob(str(DATA / "report-*.json")))[-1], encoding="utf-8").read())
    byq = {q["id"]: q for q in QS["questions"]}
    for r in rows:
        LABELS.clear()
        LABELS.update(r.get("labels") or {})
        if not r["answer"].startswith("[HTTP"):
            r.update(score(byq[r["id"]], expected(byq[r["id"]], d), r["answer"], d.items))
        print(f"{r['id']:4} {r['verdict']:14} {r.get('recall') or ''}")
    write_report(rows)


if __name__ == "__main__":
    rescore() if "--rescore" in sys.argv else main()
