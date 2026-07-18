#!/usr/bin/env python3
"""
moroccan_price_at.py — Prix d'une action marocaine (Bourse de Casablanca) à une date donnée.

Yahoo Finance ne couvre AUCUNE action de la BVC. La source de vérité est donc l'historique
quotidien auto-alimenté du repo : `data/<ticker>_history.json`, un tableau de closes de facto
(dernier prix observé chaque jour ouvré) maintenu par `scripts/scrape_<ticker>.py`
(upsert quotidien + `--backfill` depuis le git log de data/<ticker>_live.json).

Convention « prix à la date D » = dernier close CONNU à la date D (forward-fill) : si D tombe
un week-end, un jour férié BVC, ou un jour sans relevé, on renvoie le close du dernier jour de
bourse <= D. C'est la convention financière standard pour un prix de référence (mtdOpen,
oneMonthAgo, etc.) et elle évite d'inventer un prix interpolé un jour non coté.

Usage :
    python scripts/moroccan_price_at.py SGTM 2026-06-16
    python scripts/moroccan_price_at.py SGTM 2026-06-16 --json
    python scripts/moroccan_price_at.py SGTM 2026-07-01 --exact   # None si pas de close ce jour

Comme module :
    from moroccan_price_at import price_at
    px = price_at("SGTM", "2026-06-16")          # -> dict | None
    px["priceMAD"]                                # 728.0
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"


def _load_series(ticker: str) -> list[dict]:
    """Charge la série daily-close de `data/<ticker>_history.json`, triée par date croissante."""
    path = DATA_DIR / f"{ticker.lower()}_history.json"
    if not path.exists():
        raise FileNotFoundError(
            f"Pas d'historique pour {ticker} ({path.name} introuvable). "
            f"Actions marocaines suivies : "
            f"{[p.stem.replace('_history','').upper() for p in DATA_DIR.glob('*_history.json')]}"
        )
    doc = json.loads(path.read_text())
    series = [e for e in doc.get("series", []) if e.get("date") and e.get("priceMAD") is not None]
    series.sort(key=lambda e: e["date"])
    return series


def price_at(ticker: str, date: str, *, exact: bool = False) -> dict | None:
    """Prix de `ticker` à la date `date` (YYYY-MM-DD).

    Renvoie un dict {ticker, dateRequested, dateUsed, priceMAD, currency, source, forwardFilled}
    ou None si aucune donnée applicable (date antérieure au 1er close connu, ou --exact sans
    close ce jour précis).

    - exact=False (défaut) : forward-fill — dernier close <= date.
    - exact=True           : uniquement si un close existe exactement à `date`.
    """
    series = _load_series(ticker)
    if not series:
        return None

    if exact:
        hit = next((e for e in series if e["date"] == date), None)
        if hit is None:
            return None
        return _result(ticker, date, hit, forward_filled=False)

    # forward-fill : dernière entrée dont la date <= date cible
    chosen = None
    for e in series:
        if e["date"] <= date:
            chosen = e
        else:
            break
    if chosen is None:
        return None  # date antérieure à tout l'historique connu — on ne fabrique rien
    return _result(ticker, date, chosen, forward_filled=chosen["date"] != date)


def _result(ticker: str, date_req: str, entry: dict, *, forward_filled: bool) -> dict:
    return {
        "ticker": ticker.upper(),
        "dateRequested": date_req,
        "dateUsed": entry["date"],
        "priceMAD": round(float(entry["priceMAD"]), 2),
        "currency": "MAD",
        "source": entry.get("source", ""),
        "forwardFilled": forward_filled,
    }


def _main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--")]
    flags = {a for a in argv if a.startswith("--")}
    if len(args) < 2:
        print(__doc__)
        return 2
    ticker, date = args[0], args[1]
    if len(date) != 10 or date[4] != "-" or date[7] != "-":
        print(f"[erreur] date attendue au format YYYY-MM-DD, reçu: {date!r}")
        return 2
    try:
        res = price_at(ticker, date, exact="--exact" in flags)
    except FileNotFoundError as e:
        print(f"[erreur] {e}")
        return 1

    if res is None:
        print(f"[{ticker.upper()}] aucun prix pour {date} "
              f"({'pas de close ce jour' if '--exact' in flags else 'date antérieure à l historique'})")
        return 1

    if "--json" in flags:
        print(json.dumps(res, ensure_ascii=False))
    else:
        ff = f"  (forward-fill depuis {res['dateUsed']})" if res["forwardFilled"] else ""
        print(f"{res['ticker']} @ {res['dateRequested']} : {res['priceMAD']} {res['currency']}"
              f"{ff}  [source: {res['source']}]")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
