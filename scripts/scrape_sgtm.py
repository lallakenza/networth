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
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, sync_playwright

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "data" / "sgtm_live.json"

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


def scrape() -> dict | None:
    """Tente chaque source dans l'ordre. Retourne le premier résultat valide."""
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

        for scraper in (scrape_idbourse, scrape_investing):
            try:
                result = scraper(page)
                if result is not None:
                    browser.close()
                    return result
            except Exception as e:
                print(f"[{scraper.__name__}] exception: {e}")
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
