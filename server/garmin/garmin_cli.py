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
CACHE_DIR = ROOT / "data" / "garmin_cache"


def die(msg, code=1):
    print(msg, file=sys.stderr)
    sys.exit(code)


def emit(obj):
    print(json.dumps(obj, default=str, ensure_ascii=False))
    sys.exit(0)


def has_session():
    # garminconnect grava oauth1_token.json e oauth2_token.json no diretorio
    return any(SESSION_DIR.iterdir()) if SESSION_DIR.exists() else False


def make_cache():
    """DiskCache persistente entre spawns (TTL por prefixo: intra-day 5min,
    historico 24h, perfil 7d). Persistir em disco e o que da ganho real:
    cada chamada do CLI e um processo novo, entao InMemoryCache nao serviria.
    Falha de cache nunca deve derrubar o comando -> retorna None no erro."""
    try:
        from garminconnect.cache import DiskCache
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        return DiskCache(str(CACHE_DIR))
    except Exception:
        return None


# Setado por main() a partir de --no-cache: quando True, o cliente e criado
# sem DiskCache, forcando fetch fresco na Garmin (usado no sync manual).
NO_CACHE = False


def make_client():
    from garminconnect import Garmin
    email = os.environ.get("GARMIN_EMAIL", "")
    password = os.environ.get("GARMIN_PASSWORD", "")
    if not email or not password:
        die("GARMIN_EMAIL/GARMIN_PASSWORD ausentes no ambiente")
    cache = None if NO_CACHE else make_cache()
    if cache is not None:
        return Garmin(email, password, cache=cache), email
    return Garmin(email, password), email


def dump_session(client):
    # Em garminconnect 0.3.5 o atributo correto e .client (nao .garth)
    backend = getattr(client, "client", None) or getattr(client, "garth", None)
    if backend and hasattr(backend, "dump"):
        backend.dump(str(SESSION_DIR))


def authenticate(client, mfa_code=None):
    """Restaura sessao salva ou faz login novo. Retorna True/False.

    Fluxo MFA do garminconnect 0.3.x: client.login() retorna
    (client_state, None) quando o backend exige MFA — nesse caso,
    chamamos resume_login(client_state, mfa_code) para finalizar."""
    if has_session():
        try:
            client.login(tokenstore=str(SESSION_DIR))
            return True
        except Exception:
            pass  # sessao invalida -> tenta login limpo
    try:
        result = client.login()
        # result == (client_state, None) -> precisa MFA
        needs_mfa = isinstance(result, tuple) and result[0] is not None
        if needs_mfa:
            if not mfa_code:
                die("MFA_REQUIRED: passe --mfa <codigo> para finalizar o login")
            client.resume_login(result[0], str(mfa_code))
        dump_session(client)
        return True
    except SystemExit:
        raise
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
    authenticate(client, mfa_code=getattr(args, "mfa", None))
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
    days = max(1, min(int(args.days or 90), 1095))
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


def cmd_daily_health(args):
    """Busca dados diarios de saude: steps, sleep, stress, body battery, HRV, FC repouso, SpO2."""
    client, _ = make_client()
    authenticate(client)
    days = max(1, min(int(args.days or 30), 365))
    results = []
    for i in range(days - 1, -1, -1):
        cdate = (date.today() - timedelta(days=i)).isoformat()
        row = {"data": cdate}
        # Stats diarios (steps, calorias, distancia)
        try:
            s = client.get_stats(cdate) or {}
            row["passos"]        = s.get("totalSteps")
            row["kcal_total"]    = s.get("totalKilocalories")
            row["kcal_ativa"]    = s.get("activeKilocalories")
            row["distancia_m"]   = s.get("totalDistanceMeters")
        except Exception: pass
        # FC repouso
        try:
            hr = client.get_heart_rates(cdate) or {}
            row["fc_repouso"]    = hr.get("restingHeartRate")
            row["fc_min"]        = hr.get("minHeartRate")
            row["fc_max"]        = hr.get("maxHeartRate")
        except Exception: pass
        # Sono
        try:
            sl = (client.get_sleep_data(cdate) or {}).get("dailySleepDTO") or {}
            row["sono_total_s"]  = sl.get("sleepTimeSeconds")
            row["sono_deep_s"]   = sl.get("deepSleepSeconds")
            row["sono_light_s"]  = sl.get("lightSleepSeconds")
            row["sono_rem_s"]    = sl.get("remSleepSeconds")
        except Exception: pass
        # Stress
        try:
            st = client.get_stress_data(cdate) or {}
            row["stress_avg"]    = st.get("avgStressLevel")
            row["stress_max"]    = st.get("maxStressLevel")
        except Exception: pass
        # Body Battery
        try:
            bb = client.get_body_battery(cdate, cdate)
            if bb and len(bb) > 0:
                row["body_battery_max"]   = bb[0].get("charged")
                row["body_battery_drain"] = bb[0].get("drained")
        except Exception: pass
        # HRV
        try:
            hrv = (client.get_hrv_data(cdate) or {}).get("hrvSummary") or {}
            row["hrv_semanal_avg"] = hrv.get("weeklyAvg")
            row["hrv_noite_avg"]   = hrv.get("lastNightAvg")
            row["hrv_status"]      = hrv.get("status")
        except Exception: pass
        results.append(row)
    emit({"days": days, "count": len(results), "items": results})


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


def cmd_activity_polyline(args):
    """Busca polyline encoded da atividade via get_activity_details."""
    client, _ = make_client()
    authenticate(client)
    try:
        det = client.get_activity_details(args.id, maxchart=50, maxpoly=4000)
    except Exception as e:
        die(f"FETCH_ERROR: {e}")
    geo = det.get("geoPolylineDTO") if isinstance(det, dict) else None
    polyline = (geo or {}).get("polyline") if geo else None
    # polyline às vezes vem como string Google encoded, às vezes como lista de pontos
    encoded = None
    if isinstance(polyline, str):
        encoded = polyline
    elif isinstance(polyline, list) and polyline:
        # Lista de {"lat","lon","altitude",...} → codifica como Google polyline
        encoded = encode_polyline([(p.get("lat"), p.get("lon")) for p in polyline if p.get("lat") is not None])
    emit({"id": args.id, "polyline": encoded, "hasGeo": geo is not None})


def cmd_hr_zones(args):
    """Distribuição de tempo por zona de FC de uma atividade."""
    client, _ = make_client()
    authenticate(client)
    try:
        zones = client.get_activity_hr_in_timezones(args.id)
    except Exception as e:
        die(f"FETCH_ERROR: {e}")
    out = []
    for z in (zones or []):
        if not isinstance(z, dict):
            continue
        out.append({
            "zona": z.get("zoneNumber"),
            "segundos": round(z.get("secsInZone") or 0),
            "limiteInferior": z.get("zoneLowBoundary"),
        })
    emit({"id": args.id, "zones": out})


def encode_polyline(points):
    """Google polyline encoder (algoritmo padrão)."""
    if not points:
        return None
    def _enc(v):
        v = v << 1 if v >= 0 else ~(v << 1)
        chunks = []
        while v >= 0x20:
            chunks.append((0x20 | (v & 0x1f)) + 63)
            v >>= 5
        chunks.append(v + 63)
        return ''.join(chr(c) for c in chunks)
    out = []
    plat = plng = 0
    for lat, lng in points:
        if lat is None or lng is None: continue
        ilat = int(round(lat * 1e5))
        ilng = int(round(lng * 1e5))
        out.append(_enc(ilat - plat))
        out.append(_enc(ilng - plng))
        plat, plng = ilat, ilng
    return ''.join(out)


def cmd_training_readiness(args):
    """Score matinal de prontidão para treinar (0..100) por dia."""
    client, _ = make_client()
    authenticate(client)
    days = max(1, min(int(args.days or 7), 90))
    out = []
    for i in range(days - 1, -1, -1):
        cdate = (date.today() - timedelta(days=i)).isoformat()
        try:
            data = client.get_training_readiness(cdate)
        except Exception:
            data = None
        if not data:
            continue
        item = data[0] if isinstance(data, list) and data else data
        if not item:
            continue
        out.append({
            "data":             item.get("calendarDate", cdate),
            "score":            item.get("score"),
            "level":            item.get("level"),
            "feedbackShort":    item.get("feedbackShort"),
            "feedbackLong":     item.get("feedbackLong"),
            "sleepScore":       item.get("sleepScore"),
            "sleepScoreFactorPercent": item.get("sleepScoreFactorPercent"),
            "recoveryTime":     item.get("recoveryTime"),
            "recoveryTimeFactorPercent": item.get("recoveryTimeFactorPercent"),
            "acwrFactorPercent":item.get("acwrFactorPercent"),
            "hrvFactorPercent": item.get("hrvFactorPercent"),
            "hrvWeeklyAverage": item.get("hrvWeeklyAverage"),
            "stressHistoryFactorPercent": item.get("stressHistoryFactorPercent"),
        })
    emit({"days": days, "count": len(out), "items": out})


def cmd_training_status(args):
    """Estado adaptativo (PRODUCTIVE/MAINTAINING/RECOVERY/etc.)."""
    client, _ = make_client()
    authenticate(client)
    days = max(1, min(int(args.days or 1), 30))
    out = []
    for i in range(days - 1, -1, -1):
        cdate = (date.today() - timedelta(days=i)).isoformat()
        try:
            data = client.get_training_status(cdate)
        except Exception:
            data = None
        if not data:
            continue
        # Estrutura: { mostRecentVO2Max: {...}, mostRecentTrainingStatus: {...} }
        ts = (data.get("mostRecentTrainingStatus") or {}).get("latestTrainingStatusData") or {}
        # latestTrainingStatusData é dict por deviceId — pega o primeiro
        first = next(iter(ts.values()), {}) if isinstance(ts, dict) else {}
        vo2  = data.get("mostRecentVO2Max") or {}
        cycling = vo2.get("cycling") or {}
        out.append({
            "data":            cdate,
            "status":          first.get("trainingStatus"),
            "statusFeedback":  first.get("trainingStatusFeedbackPhrase"),
            "loadRatio":       first.get("loadRatio"),
            "loadBalance":     first.get("trainingBalanceFeedbackPhrase"),
            "fitnessTrend":    first.get("fitnessTrend"),
            "fitnessTrendSport":first.get("fitnessTrendSport"),
            "vo2MaxCycling":   cycling.get("vo2MaxValue"),
            "vo2MaxGeneric":   (vo2.get("generic") or {}).get("vo2MaxValue"),
            "weeklyTrainingLoad": first.get("weeklyTrainingLoad"),
        })
    emit({"days": days, "count": len(out), "items": out})


def cmd_personal_records(args):
    """Personal Records — snapshot da lista atual de PRs."""
    client, _ = make_client()
    authenticate(client)
    try:
        data = client.get_personal_record()
    except Exception as e:
        die(f"FETCH_ERROR: {e}")
    if not isinstance(data, list):
        data = []
    out = []
    for r in data:
        out.append({
            "id":            r.get("id"),
            "typeId":        r.get("typeId"),
            "status":        r.get("status"),
            "value":         r.get("value"),
            "activityId":    r.get("activityId"),
            "activityName":  r.get("activityName"),
            "activityType":  r.get("activityType"),
            "prDate":        r.get("prStartTimeLocalFormatted"),
            "activityDate":  r.get("activityStartDateTimeLocalFormatted"),
        })
    emit({"count": len(out), "items": out})


def cmd_hill_score(args):
    """Hill Score + Endurance Score por dia."""
    client, _ = make_client()
    authenticate(client)
    days = max(1, min(int(args.days or 7), 90))
    out = []
    for i in range(days - 1, -1, -1):
        cdate = (date.today() - timedelta(days=i)).isoformat()
        hill = endur = None
        vo2_max = None
        try:
            hill = client.get_hill_score(cdate)
        except Exception:
            pass
        try:
            endur = client.get_endurance_score(cdate)
        except Exception:
            pass
        # Pode haver VO2max via max_metrics tb. A Garmin separa em "cycling"
        # (baseado em potencia/FC no pedal) e "generic" (corrida). Preferimos
        # cycling; caindo para generic quando o de ciclismo nao existe.
        try:
            mm = client.get_max_metrics(cdate)
            if mm and isinstance(mm, list) and mm:
                vo2_max = ((mm[0].get("cycling") or {}).get("vo2MaxValue")
                           or (mm[0].get("generic") or {}).get("vo2MaxValue"))
        except Exception:
            pass
        if not (hill or endur or vo2_max):
            continue
        out.append({
            "data":              cdate,
            "hillScore":         (hill or {}).get("overallScore") if hill else None,
            "hillClassification":(hill or {}).get("hillScoreClassificationId") if hill else None,
            "enduranceScore":    (endur or {}).get("overallScore") if endur else None,
            "enduranceClassification": (endur or {}).get("classification") if endur else None,
            "enduranceGaugeLower":     (endur or {}).get("gaugeLowerLimit") if endur else None,
            "enduranceGaugeUpper":     (endur or {}).get("gaugeUpperLimit") if endur else None,
            "vo2Max":            vo2_max,
        })
    emit({"days": days, "count": len(out), "items": out})


# ── parser ───────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser()
    # Flag global (antes do subcomando): ignora o DiskCache e busca dados
    # frescos da Garmin. O auto-sync do scheduler nao usa; so o sync manual.
    p.add_argument("--no-cache", action="store_true",
                   help="ignora o cache em disco e busca dados frescos")
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

    pdh = sub.add_parser("daily-health")
    pdh.add_argument("--days", type=int, default=30)

    ptr = sub.add_parser("training-readiness")
    ptr.add_argument("--days", type=int, default=7)

    pts = sub.add_parser("training-status")
    pts.add_argument("--days", type=int, default=1)

    sub.add_parser("personal-records")

    phs = sub.add_parser("hill-score")
    phs.add_argument("--days", type=int, default=7)

    pap = sub.add_parser("activity-polyline")
    pap.add_argument("id", type=int)

    phz = sub.add_parser("hr-zones")
    phz.add_argument("id", type=int)

    args = p.parse_args()
    global NO_CACHE
    NO_CACHE = bool(getattr(args, "no_cache", False))
    handlers = {
        "status": cmd_status, "login": cmd_login, "logout": cmd_logout,
        "activities": cmd_activities, "activity": cmd_activity,
        "weighins": cmd_weighins, "daily-health": cmd_daily_health,
        "training-readiness": cmd_training_readiness,
        "training-status": cmd_training_status,
        "personal-records": cmd_personal_records,
        "hill-score": cmd_hill_score,
        "activity-polyline": cmd_activity_polyline,
        "hr-zones": cmd_hr_zones,
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
