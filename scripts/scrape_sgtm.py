#!/usr/bin/env python3
"""
scrape_sgtm.py — Récupère le dernier cours SGTM (Société Générale des Travaux du Maroc)
depuis plusieurs sources publiques et écrit data/sgtm_live.json.

Stratégie multi-source (première source qui répond gagne) :
  1. idbourse.com/stocks/SGTM (Next.js rendu client + Supabase)
  2. fr.investing.com/equities/ste-generale-des-travaux-du-maroc
  3. www.boursorama.com (si jamais ajouté plus tard)

Utilise Playwright headless chromium parce que :
  - idbourse.com hydrate les prix côté client (HTML initial = skeleton)
  - investing.com renvoie un challenge Cloudflare "Just a moment..." à curl
  - Playwright exécute le JS, passe Cloudflare transparent, puis on lit le DOM

Exit codes :
  0 = succès, JSON écrit ou déjà à jour
  1 = aucune source n'a répondu (ne PAS commit — garde l'ancien JSON)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATTERN GÉNÉRIQUE — actions marocaines (Bourse de Casablanca)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ce script est le prototype pour TOUTE action marocaine (CSR, LHM, IAM,
ATW, BCP, CIH, TQM, MNG, WAA, etc.). Pour ajouter un nouveau ticker :

  1. Copier ce fichier → `scripts/scrape_<ticker>.py`
  2. Remplacer `TICKER = 'SGTM'`, OUTPUT_PATH, URLs idbourse/investing,
     et les bornes MIN_PRICE/MAX_PRICE (52-semaines du titre).
  3. Copier `.github/workflows/sgtm-scrape.yml` → `<ticker>-scrape.yml`
     et remplacer les occurrences `sgtm` → `<ticker>`.
  4. Créer le bootstrap `data/<ticker>_live.json` (voir ARCHITECTURE §v331).
  5. Côté JS (api.js), factoriser `fetchSGTMFromRepo()` en
     `fetchMoroccanStockFromRepo(ticker)` dès le 2ème ticker.

Checklist complète : CLAUDE.md "Moroccan stocks live pipeline" + ARCHITECTURE §v331.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, sync_playwright

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "data" / "sgtm_live.json"
HISTORY_PATH = REPO_ROOT / "data" / "sgtm_history.json"

# Borne de sanity: SGTM oscille typiquement 400-1200 MAD. Toute valeur hors de ça = bug de parsing.
MIN_PRICE = 300.0
MAX_PRICE = 2000.0


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


def scrape_casablanca_bourse_http() -> dict | None:
    """Source OFFICIELLE de la Bourse de Casablanca — HTML rendu server-side,
    aucune dépendance à Playwright. Ultra-rapide (~1s), pas de Cloudflare.

    URL : https://www.casablanca-bourse.com/fr/live-market/instruments/GTM
    (le symbole côté BVC est "GTM" — ticker abrégé de Société Générale
    des Travaux du Maroc ; côté broker retail c'est souvent "SGTM")

    Le prix apparaît dans un `<td><span dir="ltr">826,00</span></td>` précédé
    du `<th>Cours (MAD)</th>`. Les cours sont en différé 15 minutes (standard BVC),
    ce qui est largement suffisant pour un dashboard patrimonial quotidien.
    """
    url = "https://www.casablanca-bourse.com/fr/live-market/instruments/GTM"
    print(f"[casablanca-bourse] HTTP GET {url} ...")
    debug_dir = Path(os.environ.get("DEBUG_DIR", "/tmp/scrape_debug"))
    debug_dir.mkdir(parents=True, exist_ok=True)
    html = ""
    status = None
    headers_dump = ""
    try:
        req = urllib.request.Request(
            url,
            headers={
                # UA de Chrome récent + headers "browser-like" complets pour
                # éviter les blocages côté CDN (certains runners GitHub Actions
                # ont une IP US datacenter que des firewalls WAF peuvent filtrer
                # quand les headers paraissent trop "bot").
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
                "Accept-Encoding": "identity",  # éviter gzip/br compression (urllib ne les décode pas)
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Upgrade-Insecure-Requests": "1",
            },
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            status = resp.status
            headers_dump = "\n".join(f"{k}: {v}" for k, v in resp.headers.items())
            raw = resp.read()
            html = raw.decode("utf-8", errors="replace")
            print(f"[casablanca-bourse] HTTP {status}, {len(raw)} bytes reçus")
    except urllib.error.HTTPError as e:
        status = e.code
        try:
            headers_dump = "\n".join(f"{k}: {v}" for k, v in e.headers.items())
            html = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        print(f"[casablanca-bourse] HTTPError {status}: {e.reason}")
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"[casablanca-bourse] erreur réseau: {e}")
        (debug_dir / "casablanca_bourse_http_error.txt").write_text(f"{type(e).__name__}: {e}", encoding="utf-8")
        return None

    # Si l'HTML a bien été récupéré, tenter l'extraction
    if html and status == 200:
        # Chercher : <th>Cours (MAD)</th><td ...><span dir="ltr">826,00</span></td>
        m = re.search(
            r'Cours \(MAD\)</th>\s*<td[^>]*>\s*(?:<[^>]+>\s*)*<span[^>]*>([^<]+)</span>',
            html,
            re.IGNORECASE,
        )
        if not m:
            # Fallback : span avec classe "text-right" après "Cours (MAD)"
            m = re.search(r'Cours \(MAD\)</th>.{0,500}?>(\d[\d\s.,]{0,15}\d)<', html, re.DOTALL | re.IGNORECASE)
        if m:
            raw_val = m.group(1).strip()
            val = parse_french_number(raw_val)
            if val is not None:
                print(f"[casablanca-bourse] ✓ prix={val} MAD (raw='{raw_val}')")
                return {"priceMAD": val, "source": "casablanca-bourse.com", "raw": raw_val}
            print(f"[casablanca-bourse] raw='{raw_val}' hors bornes [{MIN_PRICE}, {MAX_PRICE}]")

    # Échec : dump des infos HTTP pour debugging via artifact CI
    print(f"[casablanca-bourse] ✗ échec (status={status}, html_len={len(html)})")
    (debug_dir / "casablanca_bourse_status.txt").write_text(
        f"Status: {status}\nHTML length: {len(html)}\n\n=== Headers ===\n{headers_dump}", encoding="utf-8"
    )
    if html:
        (debug_dir / "casablanca_bourse.html").write_text(html, encoding="utf-8")
    return None


def scrape_casablanca_bourse_playwright(page: Page) -> dict | None:
    """Fallback Playwright pour casablanca-bourse.com quand le HTTP direct échoue.
    Certains runners GitHub Actions se font filtrer par le WAF du site officiel
    (IP US datacenter + headers "browser-like" insuffisants). Playwright avec un
    vrai Chromium + timezone Africa/Casablanca + locale fr-FR passe en général.
    """
    url = "https://www.casablanca-bourse.com/fr/live-market/instruments/GTM"
    print(f"[casablanca-bourse-pw] Navigation vers {url} ...")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
    except PlaywrightTimeoutError:
        print("[casablanca-bourse-pw] Timeout domcontentloaded — on continue")

    # Attendre que "Cours (MAD)" apparaisse dans le DOM
    try:
        page.wait_for_function(
            "() => (document.body.innerText || '').includes('Cours (MAD)')",
            timeout=15000,
        )
    except PlaywrightTimeoutError:
        print("[casablanca-bourse-pw] 'Cours (MAD)' introuvable dans le DOM")

    # Extraire la valeur du td qui suit le th "Cours (MAD)"
    raw = page.evaluate(
        """() => {
      const ths = Array.from(document.querySelectorAll('th'));
      const th = ths.find(t => /Cours \\(MAD\\)/i.test(t.textContent || ''));
      if (!th) return null;
      // Le td peut être le suivant en DOM, ou dans la même row
      const row = th.closest('tr');
      if (!row) return null;
      const td = row.querySelector('td');
      if (!td) return null;
      return td.textContent.trim();
    }"""
    )
    if raw:
        val = parse_french_number(raw)
        if val is not None:
            print(f"[casablanca-bourse-pw] ✓ prix={val} MAD (raw='{raw}')")
            return {"priceMAD": val, "source": "casablanca-bourse.com", "raw": raw}
        print(f"[casablanca-bourse-pw] raw='{raw}' hors bornes")

    # Fallback texte complet
    text = page.evaluate("() => document.body.innerText || ''")
    m = re.search(r"Cours\s*\(MAD\)[\s:]*([\d\s.,\u00a0]+)", text)
    if m:
        val = parse_french_number(m.group(1))
        if val is not None:
            print(f"[casablanca-bourse-pw] ✓ prix={val} MAD (fallback texte, raw='{m.group(1).strip()}')")
            return {"priceMAD": val, "source": "casablanca-bourse.com", "raw": m.group(1).strip()}

    print("[casablanca-bourse-pw] Aucun prix extrait")
    return None


def scrape_idbourse(page: Page) -> dict | None:
    """Cherche le prix SGTM sur idbourse.com. La page hydrate via Supabase client-side."""
    print("[idbourse] Navigation vers https://www.idbourse.com/stocks/SGTM ...")
    try:
        page.goto("https://www.idbourse.com/stocks/SGTM", wait_until="networkidle", timeout=30000)
    except PlaywrightTimeoutError:
        print("[idbourse] Timeout networkidle — on continue")

    # Attendre que le skeleton animate-pulse disparaisse OU qu'un prix apparaisse
    try:
        page.wait_for_function(
            "() => { const t = document.body.innerText || ''; return /\\b[1-9]\\d{2}(,\\d{2,4})?\\b/.test(t) && !/Chargement/i.test(t); }",
            timeout=15000,
        )
    except PlaywrightTimeoutError:
        print("[idbourse] Timeout sur hydratation — on tente quand même")

    # Extraire tout le texte et chercher un prix plausible
    text = page.evaluate("() => document.body.innerText || ''")
    # Chercher le 1er nombre XXX,XX ou XXX.XX à proximité de "MAD" ou de "SGTM"
    # Pattern large: capturer le prix dans la zone d'en-tête
    candidates = []
    for m in re.finditer(r"([1-9]\d{2}(?:[ \u00a0]?\d{3})*[.,]\d{1,4})", text):
        val = parse_french_number(m.group(1))
        if val is not None:
            # Score par distance à "SGTM" ou "MAD"
            start = m.start()
            sgtm_dist = min((abs(start - sm.start()) for sm in re.finditer(r"SGTM", text, re.I)), default=999999)
            mad_dist = min((abs(start - mm.start()) for mm in re.finditer(r"MAD|DH", text, re.I)), default=999999)
            candidates.append((min(sgtm_dist, mad_dist), val, m.group(1)))

    if not candidates:
        print("[idbourse] Aucun prix plausible trouvé dans le texte rendu")
        print(f"[idbourse] Debug text excerpt: {text[:500]!r}")
        return None

    candidates.sort()
    closest = candidates[0]
    print(f"[idbourse] ✓ prix={closest[1]} MAD (raw='{closest[2]}', distance={closest[0]})")
    return {"priceMAD": closest[1], "source": "idbourse.com", "raw": closest[2]}


def scrape_leboursier(page: Page) -> dict | None:
    """Cherche le prix SGTM sur leboursier.ma. Site marocain sans Cloudflare typique."""
    url = "https://www.leboursier.ma/cours/SGTM"
    print(f"[leboursier] Navigation vers {url} ...")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
    except PlaywrightTimeoutError:
        print("[leboursier] Timeout — on continue")

    # Attendre hydratation minimale
    try:
        page.wait_for_function(
            "() => (document.body.innerText || '').match(/\\b[3-9]\\d{2}[.,]\\d{1,2}\\b/)",
            timeout=15000,
        )
    except PlaywrightTimeoutError:
        print("[leboursier] Timeout sur hydratation — on tente quand même")

    # Scan du texte pour un prix plausible
    text = page.evaluate("() => document.body.innerText || ''")
    candidates = []
    for m in re.finditer(r"([3-9]\d{2}(?:[ \u00a0]?\d{3})*[.,]\d{1,4})", text):
        val = parse_french_number(m.group(1))
        if val is None:
            continue
        start = m.start()
        sgtm_dist = min((abs(start - sm.start()) for sm in re.finditer(r"SGTM", text, re.I)), default=999999)
        cours_dist = min((abs(start - cm.start()) for cm in re.finditer(r"cours|dernier", text, re.I)), default=999999)
        candidates.append((min(sgtm_dist, cours_dist), val, m.group(1)))

    if not candidates:
        print("[leboursier] Aucun prix plausible trouvé")
        print(f"[leboursier] Debug text excerpt: {text[:400]!r}")
        return None

    candidates.sort()
    closest = candidates[0]
    print(f"[leboursier] ✓ prix={closest[1]} MAD (raw='{closest[2]}', distance={closest[0]})")
    return {"priceMAD": closest[1], "source": "leboursier.ma", "raw": closest[2]}


def scrape_investing(page: Page) -> dict | None:
    """Cherche le prix SGTM sur investing.com. Playwright passe Cloudflare."""
    url = "https://fr.investing.com/equities/ste-generale-des-travaux-du-maroc"
    print(f"[investing] Navigation vers {url} ...")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
    except PlaywrightTimeoutError:
        print("[investing] Timeout — on continue")

    # Attendre le selecteur du prix
    try:
        page.wait_for_selector('[data-test="instrument-price-last"]', timeout=20000)
    except PlaywrightTimeoutError:
        print("[investing] Selector instrument-price-last introuvable")
        # Fallback: chercher n'importe où
        pass

    # Extraire
    raw = page.evaluate(
        """() => {
      const el = document.querySelector('[data-test="instrument-price-last"]');
      return el ? el.textContent.trim() : null;
    }"""
    )
    if raw:
        val = parse_french_number(raw)
        if val is not None:
            print(f"[investing] ✓ prix={val} MAD (raw='{raw}')")
            return {"priceMAD": val, "source": "investing.com", "raw": raw}
        print(f"[investing] Prix raw='{raw}' hors bornes")

    # Fallback: chercher dans le texte
    text = page.evaluate("() => document.body.innerText || ''")
    m = re.search(r"aujourd[’']hui est de\s*([\d\s.,]+)", text, re.IGNORECASE)
    if m:
        val = parse_french_number(m.group(1))
        if val is not None:
            print(f"[investing] ✓ prix={val} MAD (fallback texte, raw='{m.group(1).strip()}')")
            return {"priceMAD": val, "source": "investing.com", "raw": m.group(1).strip()}

    print("[investing] Aucun prix extrait")
    return None


def _dump_debug(page: Page, tag: str) -> None:
    """Écrit un screenshot + HTML dans le répertoire /tmp/scrape_debug pour
    upload comme artifact CI en cas d'échec. Permet de voir ce que Playwright
    a réellement vu (Cloudflare challenge, captcha, page vide, selecteur changé, etc.)."""
    try:
        debug_dir = Path(os.environ.get("DEBUG_DIR", "/tmp/scrape_debug"))
        debug_dir.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(debug_dir / f"{tag}.png"), full_page=True)
        (debug_dir / f"{tag}.html").write_text(page.content(), encoding="utf-8")
        print(f"[debug] dumped {tag}.png + {tag}.html → {debug_dir}")
    except Exception as e:
        print(f"[debug] dump failed for {tag}: {e}")


def scrape() -> dict | None:
    """Tente chaque source dans l'ordre. Retourne le premier résultat valide.

    Stratégie :
      1. casablanca-bourse.com via HTTP direct (~1s, pas de Playwright) — source
         officielle BVC, HTML rendu server-side. Path rapide quand il marche.
      2. casablanca-bourse.com via Playwright — même URL, mais vrai Chromium
         pour contourner un éventuel WAF qui filtrerait les IPs GitHub Actions.
      3. idbourse.com (Playwright, SPA Next.js) — 2ème opinion.
      4. investing.com (Playwright passe Cloudflare) — dernier recours.

    leboursier.ma volontairement retiré : domaine mort (DNS SERVFAIL) au 19/04/2026.
    Peut être réintroduit si le DNS revient.
    """
    # Tentative 1 : source officielle via HTTP simple. Si ça marche, on évite
    # complètement le setup Playwright (gain ~30s).
    result = scrape_casablanca_bourse_http()
    if result is not None:
        return result

    # Tentatives 2, 3, 4 : Playwright (casablanca-bourse.com, puis idbourse, puis investing)
    print("[scrape] HTTP casablanca-bourse.com KO → fallback Playwright (casablanca-bourse-pw, idbourse, investing)")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800},
            locale="fr-FR",
            timezone_id="Africa/Casablanca",
        )
        page = context.new_page()

        for scraper in (scrape_casablanca_bourse_playwright, scrape_idbourse, scrape_investing):
            try:
                result = scraper(page)
                if result is not None:
                    browser.close()
                    return result
                # Échec "propre" (aucun prix trouvé mais pas d'exception) → dump debug
                _dump_debug(page, scraper.__name__)
            except Exception as e:
                print(f"[{scraper.__name__}] exception: {e}")
                _dump_debug(page, f"{scraper.__name__}_exception")
                continue

        browser.close()
    return None


def main() -> int:
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
        "ticker": "SGTM",
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
        today = now.strftime("%Y-%m-%d")
        entry = {"date": today, "priceMAD": snapshot["priceMAD"], "source": snapshot["source"]}
        if HISTORY_PATH.exists():
            hist = json.loads(HISTORY_PATH.read_text())
        else:
            hist = {
                "ticker": "SGTM",
                "currency": "MAD",
                "granularity": "daily-close",
                "note": ("Dernier prix observé chaque jour ouvré. Alimenté par "
                         "scripts/scrape_sgtm.py (upsert par date)."),
                "series": [],
            }
        series = hist.get("series", [])
        # Upsert : remplace si le jour existe déjà, sinon append à la bonne position
        found = False
        for i, e in enumerate(series):
            if e.get("date") == today:
                series[i] = entry
                found = True
                break
        if not found:
            series.append(entry)
            series.sort(key=lambda e: e["date"])
        hist["series"] = series
        HISTORY_PATH.write_text(json.dumps(hist, indent=2, ensure_ascii=False) + "\n")
        print(f"[history] ✓ upsert {today}: {snapshot['priceMAD']} MAD "
              f"({len(series)} jours dans l'historique)")
    except Exception as e:
        # Ne JAMAIS faire échouer le run principal si l'historique part en vrille
        print(f"[history] ⚠ échec non-bloquant: {e}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
