"""Экзамен ИИ-помощников: доступ к боевой базе (Neon HTTP SQL) и сайту.

Базу читаем напрямую — эталоны считаются своим кодом, независимо от кода приложения (lib/*), чтобы общая ошибка
не «совпала» сама с собой. Строка подключения — из .env.neon (в git не попадает), запросы — через прокси.
Писать в базу можно только временные учётки экзамена (create_temp_user / drop_temp_user).
"""
import json
import re
import secrets
import subprocess
import time
import http.cookiejar
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(__file__).resolve().parent / "data"  # реальные данные — в .gitignore
SITE = "https://tasks-flot.vercel.app"
PROXY = urllib.request.ProxyHandler({"http": "http://127.0.0.1:10809", "https": "http://127.0.0.1:10809"})

_env = (ROOT / ".env.neon").read_text(encoding="utf-8")
_CS = re.search(r'^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?', _env, re.M).group(1).strip()
_HOST = re.search(r"@([^/:?]+)", _CS).group(1)


def sql(query: str, params=None) -> list[dict]:
    body = json.dumps({"query": query, "params": params or []}).encode()
    req = urllib.request.Request(f"https://{_HOST}/sql", data=body, headers={"Neon-Connection-String": _CS, "Content-Type": "application/json"})
    with urllib.request.build_opener(PROXY).open(req, timeout=60) as r:
        d = json.loads(r.read())
    if "rows" not in d:
        raise RuntimeError(d)
    return d["rows"]


class Session:
    """Сессия на сайте от имени временной учётки."""

    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.web = urllib.request.build_opener(PROXY, urllib.request.HTTPCookieProcessor(self.jar))

    def post(self, path: str, payload: dict, timeout=180):
        req = urllib.request.Request(SITE + path, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
        t = time.time()
        try:
            with self.web.open(req, timeout=timeout) as r:
                return r.status, r.read().decode("utf-8", "replace"), {k.lower(): v for k, v in r.headers.items()}, round(time.time() - t, 2)
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace"), {k.lower(): v for k, v in e.headers.items()}, round(time.time() - t, 2)


def create_temp_user(role: str, directorate_id: str | None, tag: str) -> tuple[str, Session]:
    """Временная учётка экзамена (роль в базе: DIRECTOR / MANAGEMENT=ЗГД / CURATOR=админ); удалять — drop_temp_user."""
    pw = "Ex-" + secrets.token_urlsafe(14)
    hsh = subprocess.run(["node", "-e", 'require("bcryptjs").hash(process.argv[1],10).then(h=>process.stdout.write(h))', pw], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    uid = f"aiexam{tag}{int(time.time())}"
    email = f"ai-exam-{tag}@local.test"
    sql('DELETE FROM users WHERE email = $1', [email])  # хвост прошлого прерванного прогона
    sql('INSERT INTO users (id, name, email, "passwordHash", role, "directorateId", "isActive", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, true, now())', [uid, f"Экзамен ИИ ({tag})", email, hsh, role, directorate_id])
    s = Session()
    st = s.post("/api/auth/login", {"email": email, "password": pw})[0]
    if st != 200:
        raise RuntimeError(f"вход временной учётки: HTTP {st}")
    return uid, s


def drop_temp_user(uid: str) -> int:
    sql("DELETE FROM rate_limits WHERE key LIKE $1", [f"%{uid}%"])
    sql('DELETE FROM audit_events WHERE "actorId" = $1', [uid])
    sql('DELETE FROM notifications WHERE "userId" = $1', [uid])
    sql("DELETE FROM users WHERE id = $1", [uid])
    return len(sql("SELECT id FROM users WHERE id = $1", [uid]))
