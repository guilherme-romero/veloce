#!/usr/bin/env python3
"""
Garmin CLI — wrapper sobre python-garminconnect (single-user).
Comandos:
  status                        retorna { connected, full_name, ... }
  login [--mfa CODE]            faz login; usa --mfa se MFA estiver ativo
  logout                        remove sessao salva
  activities [--days N]         lista atividades dos ultimos N dias (default 90)
  activity <id>                 detalhe de uma atividade

Convencoes:
  - Le GARMIN_EMAIL e GARMIN_PASSWORD do ambiente (do .env do Node).
  - Sessao SSO persistida em data/garmin_session/ (proxima ao DB).
  - Toda saida e JSON no stdout. Erros vao para stderr + exit code != 0.
  - MFA: codigo de exit 2 + stderr "MFA_REQUIRED" quando precisa de codigo.
"""
import json
import os
import sys
import argparse
from pathlib import Path
from datetime import date, timedelta

# Diretorios
ROOT = Path(__file__).resolve().parents[2]
SESSION_DIR = ROOT / "data" / "garmin_session"
SESSION_DIR.mkdir(parents=True, exist_ok=True)


def die(msg, code=1):
    print(msg, file=sys.stderr)
    sys.exit(code)


def emit(obj):
    print(json.dumps(obj, default=str, ensure_ascii=False))
    sys.exit(0)


def has_session():
    # garminconnect grava oauth1_token.json e oauth2_token.json no diretorio
    return any(SESSION_DIR.iterdir()) if SESSION_DIR.exists() else False


def make_client():
    from garminconnect import Garmin
    email = os.environ.get("GARMIN_EMAIL", "")
    password = os.environ.get("GARMIN_PASSWORD", "")
    if not email or not password:
        die("GARMIN_EMAIL/GARMIN_PASSWORD ausentes no ambiente")
    return Garmin(email, password), email


def dump_session(client):
    # Em garminconnect 0.3.5 o atributo correto e .client (nao .garth)
    backend = getattr(client, "client", None) or getattr(client, "garth", None)
    if backend and hasattr(backend, "dump"):
        backend.dump(str(SESSION_DIR))


def authenticate(client):
    """Restaura sessao salva ou faz login novo. Retorna True/False."""
    if has_session():
        try:
            client.login(tokenstore=str(SESSION_DIR))
            return True
        except Exception:
            pass  # sessao invalida -> tenta login limpo
    try:
        client.login()
        dump_session(client)
        return True
    except Exception as e:
        die(f"AUTH_ERROR: {e}")


# ── comandos ─────────────────────────────────────────────────────────

def cmd_status(args):
    client, email = make_client()
    authenticate(client)
    try:
        full = client.get_full_name()
        emit({
            "configured": True,
            "connected": True,
            "email": email,
            "fullName": full,
        })
    except Exception as e:
        emit({"configured": True, "connected": False, "reason": str(e)})


def cmd_login(args):
    client, email = make_client()
    authenticate(client)
    try:
        full = client.get_full_name()
    except Exception:
        full = None
    emit({"ok": True, "fullName": full})


def cmd_logout(args):
    import shutil
    if SESSION_DIR.exists():
        for f in SESSION_DIR.iterdir():
            try:
                if f.is_file(): f.unlink()
                elif f.is_dir(): shutil.rmtree(f)
            except Exception:
                pass
    emit({"ok": True})


def cmd_activities(args):
    client, _ = make_client()
    authenticate(client)
    days = max(1, min(int(args.days or 90), 365))
    start = (date.today() - timedelta(days=days)).isoformat()
    end = date.today().isoformat()
    try:
        acts = client.get_activities_by_date(start, end)
    except Exception as e:
        die(f"FETCH_ERROR: {e}")
    # Devolve so campos relevantes pra reduzir payload
    slim = []
    for a in acts or []:
        slim.append({
            "activityId":        a.get("activityId"),
            "activityName":      a.get("activityName"),
            "activityType":      (a.get("activityType") or {}).get("typeKey"),
            "startTimeLocal":    a.get("startTimeLocal"),
            "startTimeGMT":      a.get("startTimeGMT"),
            "duration":          a.get("duration"),
            "movingDuration":    a.get("movingDuration"),
            "distance":          a.get("distance"),
            "elevationGain":     a.get("elevationGain"),
            "averageHR":         a.get("averageHR"),
            "maxHR":             a.get("maxHR"),
            "averageSpeed":      a.get("averageSpeed"),
            "maxSpeed":          a.get("maxSpeed"),
            "calories":          a.get("calories"),
            "averageBikingCadenceInRevPerMinute": a.get("averageBikingCadenceInRevPerMinute"),
            "averagePower":      a.get("averagePower"),
            "maxPower":          a.get("maxPower"),
            "deviceId":          a.get("deviceId"),
        })
    emit({"days": days, "count": len(slim), "items": slim})


def cmd_activity(args):
    client, _ = make_client()
    authenticate(client)
    try:
        det = client.get_activity_details(args.id)
    except Exception as e:
        die(f"FETCH_ERROR: {e}")
    emit(det)


def cmd_weighins(args):
    client, _ = make_client()
    authenticate(client)
    days = max(1, min(int(args.days or 365), 3650))
    start = (date.today() - timedelta(days=days)).isoformat()
    end   = date.today().isoformat()
    try:
        data = client.get_weigh_ins(start, end)
    except Exception as e:
        die(f"FETCH_ERROR: {e}")
    # API retorna { dailyWeightSummaries: [{ summaryDate, latestWeight: { weight, ... }, allWeightMetrics: [...] }] }
    summaries = (data or {}).get("dailyWeightSummaries") or []
    out = []
    for s in summaries:
        latest = s.get("latestWeight") or {}
        weight_g = latest.get("weight")  # gramas
        if weight_g is None:
            continue
        out.append({
            "data":      s.get("summaryDate"),                # YYYY-MM-DD
            "pesoKg":    round(weight_g / 1000.0, 2),
            "timestamp": latest.get("timestamp"),
            "sourceType": latest.get("sourceType"),           # "INDEX_SCALE", "MANUAL", ...
            "samplePk":  latest.get("samplePk"),
        })
    emit({"days": days, "count": len(out), "items": out})


# ── parser ───────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status")

    pl = sub.add_parser("login")
    pl.add_argument("--mfa", default=None, help="codigo MFA (necessario se 2FA ativo)")

    sub.add_parser("logout")

    pa = sub.add_parser("activities")
    pa.add_argument("--days", type=int, default=90)

    pd = sub.add_parser("activity")
    pd.add_argument("id", type=int)

    pw = sub.add_parser("weighins")
    pw.add_argument("--days", type=int, default=365)

    args = p.parse_args()
    handlers = {
        "status": cmd_status, "login": cmd_login, "logout": cmd_logout,
        "activities": cmd_activities, "activity": cmd_activity,
        "weighins": cmd_weighins,
    }
    handlers[args.cmd](args)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except KeyboardInterrupt:
        die("interrupted", code=130)
    except Exception as e:
        die(f"UNEXPECTED: {e}")
