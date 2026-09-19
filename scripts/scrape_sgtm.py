#!/usr/bin/env python3
"""
scrape_sgtm.py — Récupère le dernier cours SGTM (Société Générale des Travaux du Maroc,
code BVC « GTM ») et écrit data/sgtm_live.json.

Sources (HTTP simple, aucune dépendance navigateur ; la première qui répond gagne) :
  1. casablanca-bourse.com/live-market/actions — source OFFICIELLE. Depuis la refonte
     (Drupal, ~août 2026) l'ancienne page /fr/live-market/instruments/GTM redirige (301)
     vers l'accueil ; la cote complète est désormais embarquée server-side dans le
     `<script data-drupal-selector="drupal-settings-json">` → live_market.actions[] avec
     `dernierCours` + live_market.session.timestamp (date de séance).
  2. scanner.tradingview.com/symbol?symbol=CSEMA:GTM — JSON plat, sans auth (la même API
     que le runtime navigateur, js/api.js fetchMoroccanStockFromTradingView).

TLS : le serveur de la BVC n'envoie QUE le certificat feuille (chaîne incomplète : il manque
l'intermédiaire « Sectigo Public Server Authentication CA DV R36 »). Les navigateurs le
récupèrent via l'extension AIA ; OpenSSL/Python non → CERTIFICATE_VERIFY_FAILED. Correctif :
contexte TLS = racines certifi + intermédiaire téléchargé depuis l'URL AIA du certificat
feuille. La vérification reste STRICTE (chaîne jusqu'à une racine certifi auto-signée,
PARTIAL_CHAIN désactivé, hostname vérifié) — on ne désactive jamais la vérification.

Retirés le 19/09/2026 (tous morts) : casablanca-bourse Playwright (URL 301), idbourse.com
(réservé aux membres connectés), investing.com (sélecteur/Cloudflare) ; leboursier.ma
(DNS mort depuis 04/2026).

Modes :
  (défaut)                scrape + écrit le JSON (commit décidé par le workflow)
  --check-staleness [N]   exit 1 si data/sgtm_live.json a plus de N jours ouvrés (défaut 3)
  --backfill              reconstruit data/sgtm_history.json depuis le git log

Exit codes : 0 = succès (JSON écrit ou déjà à jour) ; 1 = aucune source / JSON périmé.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATTERN GÉNÉRIQUE — actions marocaines (Bourse de Casablanca)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pour un autre titre (CSR, LHM, IAM, ATW, …) : copier ce fichier, changer TICKER / BVC_CODE /
OUT_PATH / HISTORY_PATH / MIN_PRICE / MAX_PRICE. Les deux sources couvrent toute la cote.
Runbook : docs/ADD_MOROCCAN_STOCK.md.
"""
from __future__ import annotations

import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "data" / "sgtm_live.json"
HISTORY_PATH = REPO_ROOT / "data" / "sgtm_history.json"

TICKER = "SGTM"   # ticker broker (clé du JSON)
BVC_CODE = "GTM"  # code Bourse de Casablanca / TradingView

# Borne de sanity: SGTM oscille typiquement 400-1200 MAD. Toute valeur hors de ça = bug de parsing.
MIN_PRICE = 300.0
MAX_PRICE = 2000.0

# Une séance BVC plus vieille que ça = donnée figée côté source → rejetée (fériés inclus :
# l'Aïd peut fermer la bourse 2-3 jours ouvrés d'affilée).
MAX_SESSION_AGE_WEEKDAYS = 5

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36")

BVC_URL = "https://www.casablanca-bourse.com/live-market/actions"
TV_URL = (f"https://scanner.tradingview.com/symbol?symbol=CSEMA:{BVC_CODE}"
          "&fields=close,currency,open,change")


def _debug_dir() -> Path:
    d = Path(os.environ.get("DEBUG_DIR", "/tmp/scrape_debug"))
    d.mkdir(parents=True, exist_ok=True)
    return d


def parse_french_number(s: str) -> float | None:
    """'1 234,56' -> 1234.56 ; '1,234.56' -> 1234.56 ; '826' -> 826.0"""
    if not s:
        return None
    s = s.strip()
    # Enlever espaces insécables et unités
    s = re.sub(r"[\s\u00a0\u202f]", "", s)
    s = re.sub(r"(MAD|DH|dhs?|€|\$)$", "", s, flags=re.IGNORECASE)
    # Format français: '1.234,56' -> '1234.56'
    if re.match(r"^-?\d{1,3}(\.\d{3})+,\d+$", s):
        s = s.replace(".", "").replace(",", ".")
    # Format virgule seule: '826,00' -> '826.00'
    elif re.match(r"^-?\d+,\d+$", s):
        s = s.replace(",", ".")
    # Format anglais avec virgules milliers: '1,234.56' -> '1234.56'
    elif re.match(r"^-?\d{1,3}(,\d{3})+\.\d+$", s):
        s = s.replace(",", "")
    try:
        val = float(s)
        return val if MIN_PRICE <= val <= MAX_PRICE else None
    except ValueError:
        return None


def _in_bounds(val) -> float | None:
    try:
        v = float(val)
    except (TypeError, ValueError):
        return None
    return v if MIN_PRICE <= v <= MAX_PRICE else None


def weekdays_between(start: datetime, end: datetime) -> int:
    """Nombre de jours ouvrés (lun-ven) strictement après `start` et jusqu'à `end` inclus."""
    d, n = start.date(), 0
    while d < end.date():
        d += timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


# ── TLS : racines certifi + intermédiaires AIA ────────────────────────────────────────
def _base_ssl_context() -> ssl.SSLContext:
    """Contexte vérifiant (CERT_REQUIRED + hostname) sur les racines certifi si dispo,
    sinon le magasin système. PARTIAL_CHAIN explicitement désactivé : un intermédiaire
    ajouté plus bas ne peut jamais servir d'ancre de confiance à lui seul."""
    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        ctx = ssl.create_default_context()
    if hasattr(ssl, "VERIFY_X509_PARTIAL_CHAIN"):
        ctx.verify_flags &= ~ssl.VERIFY_X509_PARTIAL_CHAIN
    return ctx


def _aia_issuer_urls(host: str, port: int = 443) -> list[str]:
    """URLs « CA Issuers » (AIA) du certificat feuille présenté par `host`.

    `ssl.get_server_certificate` ne fait que LIRE le certificat (aucune donnée applicative
    n'est échangée) ; aucune requête n'est jamais envoyée sur une connexion non vérifiée.
    Décodage via `_ssl._test_decode_cert` (interne CPython, stable depuis 3.x)."""
    import tempfile
    pem = ssl.get_server_certificate((host, port), timeout=15)
    with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as f:
        f.write(pem)
        path = f.name
    try:
        decoded = ssl._ssl._test_decode_cert(path)  # noqa: SLF001
    finally:
        os.unlink(path)
    return [u for u in decoded.get("caIssuers", ()) if u.startswith(("http://", "https://"))]


_CTX_CACHE: dict[str, ssl.SSLContext] = {}


def ssl_context_for(host: str) -> ssl.SSLContext:
    """Contexte strict pour `host`, complété si besoin par l'intermédiaire AIA manquant.

    L'intermédiaire téléchargé est chargé comme maillon ; la chaîne doit toujours remonter
    à une racine certifi auto-signée, sinon la connexion échoue (PARTIAL_CHAIN off)."""
    if host in _CTX_CACHE:
        return _CTX_CACHE[host]
    ctx = _base_ssl_context()
    try:
        import socket
        with socket.create_connection((host, 443), timeout=15) as sock:
            with ctx.wrap_socket(sock, server_hostname=host):
                pass
    except ssl.SSLCertVerificationError as e:
        print(f"[tls] {host}: chaîne incomplète ({e.verify_message}) → complétion AIA")
        for url in _aia_issuer_urls(host):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=15, context=_base_ssl_context()) as r:
                    blob = r.read()
                pem = (blob.decode("ascii") if blob.lstrip().startswith(b"-----BEGIN")
                       else ssl.DER_cert_to_PEM_cert(blob))
                ctx.load_verify_locations(cadata=pem)
                print(f"[tls] intermédiaire chargé depuis {url}")
            except Exception as ex:  # noqa: BLE001
                print(f"[tls] AIA {url} KO: {ex}")
    except OSError:
        pass  # erreur réseau : laissée à l'appel réel, qui la journalisera
    _CTX_CACHE[host] = ctx
    return ctx


def http_get(url: str, accept: str = "*/*") -> tuple[int, str]:
    host = urllib.parse.urlsplit(url).hostname
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": accept,
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
    })
    with urllib.request.urlopen(req, timeout=25, context=ssl_context_for(host)) as resp:
        return resp.status, resp.read().decode("utf-8", errors="replace")


# ── Sources ───────────────────────────────────────────────────────────────────────────
def scrape_casablanca_bourse() -> dict | None:
    """Cote officielle BVC : JSON Drupal embarqué dans /live-market/actions."""
    print(f"[casablanca-bourse] GET {BVC_URL} ...")
    try:
        status, html = http_get(BVC_URL, "text/html,application/xhtml+xml")
    except (urllib.error.URLError, OSError) as e:
        print(f"[casablanca-bourse] ✗ erreur réseau/TLS: {e}")
        return None
    print(f"[casablanca-bourse] HTTP {status}, {len(html)} caractères")
    m = re.search(r'<script[^>]*data-drupal-selector="drupal-settings-json"[^>]*>(.*?)</script>',
                  html, re.S)
    try:
        lm = json.loads(m.group(1))["live_market"] if m else None
    except (ValueError, KeyError):
        lm = None
    if not lm:
        print("[casablanca-bourse] ✗ bloc drupal-settings-json/live_market introuvable")
        (_debug_dir() / "casablanca_bourse.html").write_text(html, encoding="utf-8")
        return None

    # Date de séance (epoch = minuit Casablanca du jour de séance) → rejet si figée.
    session_ts = (lm.get("session") or {}).get("timestamp")
    session_day = None
    if session_ts:
        # +1h (UTC+1 Maroc) pour retomber sur le jour calendaire local de la séance.
        session_dt = datetime.fromtimestamp(int(session_ts) + 3600, timezone.utc)
        session_day = session_dt.strftime("%Y-%m-%d")
        age = weekdays_between(session_dt, datetime.now(timezone.utc))
        if age > MAX_SESSION_AGE_WEEKDAYS:
            print(f"[casablanca-bourse] ✗ séance {session_day} vieille de {age} jours ouvrés → rejet")
            return None

    row = next((a for a in lm.get("actions") or []
                if str(a.get("symbol", "")).strip() == BVC_CODE), None)
    val = _in_bounds(row.get("dernierCours")) if row else None
    if val is None:  # repli : bandeau défilant (même page, autre structure)
        item = next((t for t in (lm.get("ticker") or {}).get("items") or []
                     if str(t.get("symbol", "")).strip() == BVC_CODE), None)
        val = _in_bounds(item.get("price")) if item else None
    if val is None:
        print(f"[casablanca-bourse] ✗ {BVC_CODE} absent ou hors bornes [{MIN_PRICE}, {MAX_PRICE}]")
        (_debug_dir() / "casablanca_bourse_live_market.json").write_text(
            json.dumps(lm, ensure_ascii=False, indent=1), encoding="utf-8")
        return None
    print(f"[casablanca-bourse] ✓ prix={val} MAD (séance {session_day})")
    # `sessionDay` sert uniquement de clé d'historique (pas écrit dans sgtm_live.json).
    return {"priceMAD": val, "source": "casablanca-bourse.com", "raw": f"{val:g}",
            "sessionDay": session_day}


def scrape_tradingview() -> dict | None:
    """TradingView scanner (CSEMA:GTM) — cours différé 15 min, JSON plat."""
    print(f"[tradingview] GET {TV_URL} ...")
    try:
        status, body = http_get(TV_URL, "application/json")
        d = json.loads(body)
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f"[tradingview] ✗ {e}")
        return None
    if (d.get("currency") or "MAD") != "MAD":
        print(f"[tradingview] ✗ devise inattendue: {d.get('currency')}")
        return None
    val = _in_bounds(d.get("close"))
    if val is None:
        print(f"[tradingview] ✗ close={d.get('close')!r} absent ou hors bornes")
        return None
    print(f"[tradingview] ✓ prix={val} MAD")
    return {"priceMAD": val, "source": "tradingview.com", "raw": f"{val:g}"}


def scrape() -> dict | None:
    """Tente chaque source dans l'ordre ; retourne le premier résultat valide."""
    for scraper in (scrape_casablanca_bourse, scrape_tradingview):
        try:
            result = scraper()
        except Exception as e:  # noqa: BLE001 — une source cassée ne doit pas masquer l'autre
            print(f"[{scraper.__name__}] exception: {type(e).__name__}: {e}")
            continue
        if result is not None:
            return result
    return None


def check_staleness(max_weekdays: int) -> int:
    """Échoue (exit 1) si le dernier relevé committé a plus de `max_weekdays` jours ouvrés.

    Garde-fou indépendant du scrape : attrape aussi un push raté, un workflow désactivé
    puis réactivé, ou tout autre chemin où le JSON cesse d'avancer sans erreur visible."""
    try:
        snap = json.loads(OUT_PATH.read_text())
        last = datetime.fromisoformat(snap["lastUpdate"].replace("Z", "+00:00"))
    except Exception as e:  # noqa: BLE001
        print(f"::error::sgtm_live.json illisible: {e}")
        return 1
    age = weekdays_between(last, datetime.now(timezone.utc))
    msg = f"{OUT_PATH.name}: {snap.get('priceMAD')} MAD @ {snap['lastUpdate']} ({age} jour(s) ouvré(s))"
    if age > max_weekdays:
        print(f"::error::Prix SGTM périmé — {msg} > seuil {max_weekdays}")
        return 1
    print(f"[staleness] ✓ {msg} ≤ seuil {max_weekdays}")
    return 0


def _new_history_doc() -> dict:
    return {
        "ticker": "SGTM",
        "currency": "MAD",
        "granularity": "daily-close",
        "note": ("Dernier prix observé chaque jour ouvré (close de facto — la séance BVC "
                 "termine à 15h30 et le dernier run intraday capture ce prix). Alimenté par "
                 "scripts/scrape_sgtm.py (upsert par date à chaque run) ; reconstructible "
                 "intégralement depuis le git log de data/sgtm_live.json via `--backfill`."),
        "series": [],
    }


def upsert_history_entry(day: str, price_mad: float, source: str) -> int:
    """Insère/remplace l'entrée `day` dans data/sgtm_history.json. Retourne la taille de la série.

    Utilisé par le run normal (upsert du jour) ET par --backfill (upsert de chaque jour
    reconstruit). Ne lève jamais : l'historique ne doit pas faire échouer le scrape.
    """
    hist = json.loads(HISTORY_PATH.read_text()) if HISTORY_PATH.exists() else _new_history_doc()
    series = hist.get("series", [])
    entry = {"date": day, "priceMAD": round(price_mad, 2), "source": source}
    for i, e in enumerate(series):
        if e.get("date") == day:
            series[i] = entry
            break
    else:
        series.append(entry)
        series.sort(key=lambda e: e["date"])
    hist["series"] = series
    HISTORY_PATH.write_text(json.dumps(hist, indent=2, ensure_ascii=False) + "\n")
    return len(series)


def rebuild_history_from_git() -> int:
    """Reconstruit data/sgtm_history.json depuis TOUT le git log de data/sgtm_live.json.

    Chaque commit du fichier live est un relevé horodaté (champ `lastUpdate`). Le close de
    facto d'un jour = le DERNIER relevé de ce jour (max timestamp). On récupère chaque version
    du blob via `git show <sha>:data/sgtm_live.json` et on garde, par date, l'observation la
    plus tardive. Idempotent : réécrit intégralement la série.
    """
    rel = "data/sgtm_live.json"
    shas = subprocess.check_output(
        ["git", "-C", str(REPO_ROOT), "log", "--reverse", "--format=%H", "--", rel],
        text=True,
    ).split()
    by_day: dict[str, tuple[float, str, str]] = {}  # date -> (price, source, ts)
    for sha in shas:
        try:
            blob = subprocess.check_output(
                ["git", "-C", str(REPO_ROOT), "show", f"{sha}:{rel}"], text=True,
                stderr=subprocess.DEVNULL,
            )
            d = json.loads(blob)
        except Exception:
            continue
        ts = d.get("lastUpdate", "")
        day = ts[:10]
        price = d.get("priceMAD")
        if not day or price is None:
            continue
        if day not in by_day or ts > by_day[day][2]:
            by_day[day] = (price, d.get("source", ""), ts)
    doc = _new_history_doc()
    doc["series"] = [
        {"date": k, "priceMAD": round(v[0], 2), "source": v[1]}
        for k, v in sorted(by_day.items())
    ]
    HISTORY_PATH.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
    print(f"[backfill] ✓ {len(doc['series'])} jours reconstruits depuis {len(shas)} commits "
          f"→ {HISTORY_PATH.name}"
          + (f" ({doc['series'][0]['date']} → {doc['series'][-1]['date']})" if doc['series'] else ""))
    return 0


def main() -> int:
    if "--backfill" in sys.argv:
        return rebuild_history_from_git()
    if "--check-staleness" in sys.argv:
        i = sys.argv.index("--check-staleness")
        n = int(sys.argv[i + 1]) if len(sys.argv) > i + 1 else 3
        return check_staleness(n)

    print(f"=== scrape_sgtm.py — {datetime.now(timezone.utc).isoformat()} ===")

    # Lire l'état précédent pour comparer
    previous = None
    if OUT_PATH.exists():
        try:
            previous = json.loads(OUT_PATH.read_text())
            print(f"[prev] dernier snapshot: {previous.get('priceMAD')} MAD @ {previous.get('lastUpdate')}")
        except Exception as e:
            print(f"[prev] illisible: {e}")

    result = scrape()
    if result is None:
        print("[main] Aucune source n'a répondu. JSON NON modifié.")
        return 1

    now = datetime.now(timezone.utc)
    snapshot = {
        "ticker": TICKER,
        "priceMAD": round(result["priceMAD"], 2),
        "currency": "MAD",
        "lastUpdate": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": result["source"],
        "raw": result["raw"],
    }

    # Skip si prix identique ET timestamp récent (< 1h) pour éviter des commits inutiles
    if previous and previous.get("priceMAD") == snapshot["priceMAD"]:
        try:
            prev_ts = datetime.fromisoformat(previous["lastUpdate"].replace("Z", "+00:00"))
            if (now - prev_ts).total_seconds() < 3600:
                print(f"[main] Prix identique ({snapshot['priceMAD']}) et snapshot précédent < 1h — skip")
                return 0
        except Exception:
            pass

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n")
    print(f"[main] ✓ écrit {OUT_PATH}: {snapshot['priceMAD']} MAD (source: {snapshot['source']})")

    # ── Maintien de l'historique daily (v338) ─────────────────────────
    # Upsert de l'entrée du jour : chaque run remplace la valeur du jour avec le dernier
    # prix observé. Le dernier commit de la séance = close de facto (séance BVC termine 15h30).
    # Le chart côté JS consomme cet historique pour peupler `SGTM_PRICES` à la volée.
    try:
        # Jour de séance BVC si connu (un run manuel un samedi ne crée pas d'entrée samedi).
        today = result.get("sessionDay") or now.strftime("%Y-%m-%d")
        n = upsert_history_entry(today, snapshot["priceMAD"], snapshot["source"])
        print(f"[history] ✓ upsert {today}: {snapshot['priceMAD']} MAD ({n} jours dans l'historique)")
    except Exception as e:
        # Ne JAMAIS faire échouer le run principal si l'historique part en vrille
        print(f"[history] ⚠ échec non-bloquant: {e}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
