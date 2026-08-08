#!/usr/bin/env python3
"""Confronte les valorisations immo aux TRANSACTIONS NOTARIÉES RÉELLES.

Pourquoi ce script existe
-------------------------
Les valorisations du dashboard s'appuyaient sur des estimateurs algorithmiques
(MeilleursAgents, efficity, Orpi). Ces outils sont structurellement plus hauts que
les prix réellement actés, et ils raisonnent à la maille du quartier — ce qui ne
décrit pas un bien précis. En v418, cette différence valait 35 000 € sur Rueil.

La base DVF (Demandes de Valeurs Foncières, Etalab) contient les mutations
réellement enregistrées par les notaires. C'est la seule source qui permet de
comparer un bien à ses voisins immédiats plutôt qu'à une moyenne communale.

Source : https://files.data.gouv.fr/geo-dvf/latest/csv/<annee>/communes/<dep>/<insee>.csv
Ouvert, gratuit, sans clé.

Note : le serveur MCP `immobilier-dvf` expose les mêmes données, mais il dépend de
api.cquest.org qui était hors service au moment de l'écriture (HTTP 502). Ce script
tape directement les fichiers Etalab et n'a donc pas cette dépendance.

Usage
-----
    python3 scripts/dvf_comparables.py            # les 3 biens du portefeuille
    python3 scripts/dvf_comparables.py --rayon 150
"""
import argparse, csv, io, math, statistics as st, sys, urllib.request

# nom, code INSEE, département, lat, lon, surface m², valeur retenue dans data.js
BIENS = [
    ("Vitry",     "94081", "94", 48.78028, 2.40640, 67.14, 300000),
    ("Rueil",     "92063", "92", 48.86625, 2.19482, 55.66, 245000),
    ("Villejuif", "94076", "94", 48.78798, 2.36822, 68.92, 415000),
]
ANNEES = ["2025", "2024", "2023", "2022", "2021"]
BASE = "https://files.data.gouv.fr/geo-dvf/latest/csv"


def charge(insee, dep, annee):
    url = f"{BASE}/{annee}/communes/{dep}/{insee}.csv"
    req = urllib.request.Request(url, headers={"User-Agent": "networth-dvf/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return list(csv.DictReader(io.StringIO(r.read().decode("utf-8"))))


def dist_m(la1, lo1, la2, lo2):
    """Distance approximative en mètres — suffisant à l'échelle d'un quartier."""
    return math.hypot((la2 - la1) * 111_320,
                      (lo2 - lo1) * 111_320 * math.cos(math.radians(la1)))


def ventes_appartements(rows, lat, lon):
    out = []
    for r in rows:
        if r.get("type_local") != "Appartement" or r.get("nature_mutation") != "Vente":
            continue
        try:
            val = float(r["valeur_fonciere"])
            surf = float(r["surface_reelle_bati"])
            d = dist_m(lat, lon, float(r["latitude"]), float(r["longitude"]))
        except (ValueError, KeyError, TypeError):
            continue
        if surf < 20 or val < 30_000:
            continue
        pm2 = val / surf
        if not (1_500 < pm2 < 20_000):       # écarte démembrements et saisies
            continue
        out.append({"pm2": pm2, "surf": surf, "val": val, "d": d,
                    "voie": (r.get("adresse_nom_voie") or "?").upper(),
                    "date": r.get("date_mutation", "")})
    return out


def resume(sample):
    if not sample:
        return None
    p = sorted(x["pm2"] for x in sample)
    return {"n": len(p), "med": st.median(p), "q1": p[len(p) // 4], "q3": p[3 * len(p) // 4]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rayon", type=int, default=250,
                    help="rayon en mètres pour identifier les voies voisines (défaut 250)")
    ap.add_argument("--depuis", default="2024", help="ne garder que les ventes >= cette année")
    args = ap.parse_args()

    for nom, insee, dep, lat, lon, surface, valeur in BIENS:
        rows = []
        for a in ANNEES:
            try:
                rows += charge(insee, dep, a)
            except Exception as e:
                print(f"[{nom}] millésime {a} indisponible ({type(e).__name__})", file=sys.stderr)
        apps = ventes_appartements(rows, lat, lon)
        pm2_modele = valeur / surface

        print(f"\n{'='*78}")
        print(f"{nom} — {surface} m² — modèle {valeur:,} € = {pm2_modele:.0f} €/m²".replace(",", " "))
        print(f"{'='*78}")

        proches = [a for a in apps if a["d"] <= args.rayon]
        recents = [a for a in proches if a["date"] >= args.depuis]
        print(f"  {len(apps)} ventes dans la commune · {len(proches)} à moins de {args.rayon} m "
              f"· {len(recents)} depuis {args.depuis}")

        # Détail par voie : c'est ce qui révèle la résidence, pas la moyenne de quartier.
        par_voie = {}
        for a in proches:
            par_voie.setdefault(a["voie"], []).append(a)
        print(f"\n  {'voie':<32}{'n':>4}{'dist':>7}{'médiane':>10}{'depuis '+args.depuis:>14}")
        for v, items in sorted(par_voie.items(), key=lambda kv: -len(kv[1])):
            r = resume(items)
            rec = resume([x for x in items if x["date"] >= args.depuis])
            dm = sum(x["d"] for x in items) / len(items)
            print(f"  {v[:31]:<32}{r['n']:>4}{dm:>6.0f}m{r['med']:>10.0f}"
                  f"{(f'{rec[chr(109)+chr(101)+chr(100)]:.0f} (n={rec[chr(110)]})' if rec else '—'):>14}")

        s = resume(recents) or resume(proches)
        if s:
            ecart = (pm2_modele / s["med"] - 1) * 100
            sens = "au-dessus" if ecart > 0 else "en dessous"
            print(f"\n  médiane retenue : {s['med']:.0f} €/m² (n={s['n']}, Q1-Q3 {s['q1']:.0f}-{s['q3']:.0f})")
            print(f"  le modèle est {abs(ecart):.0f}% {sens}")
            print(f"  valeur implicite : {s['med']*surface:,.0f} €  "
                  f"(Q1-Q3 {s['q1']*surface:,.0f} — {s['q3']*surface:,.0f})".replace(",", " "))


if __name__ == "__main__":
    main()
