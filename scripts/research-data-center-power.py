"""Regenerate the bounded data-center capacity snapshot (Python 3 + openpyxl + pdfplumber).

Downloads are cached outside the repository. Run from the repository root.
"""
import concurrent.futures
import csv
import json
import pathlib
import tempfile
import urllib.request

import openpyxl
import pdfplumber

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = pathlib.Path(tempfile.gettempdir()) / "electrify-power-research"
CACHE.mkdir(exist_ok=True)
EMBER = "https://files.ember-energy.org/public-downloads/yearly_full_release_long_format.csv"
EIA = "https://www.eia.gov/electricity/state/xls/SEP%20Tables%20for%20{}.xlsx"
FUELS = ["Coal", "Natural Gas", "Oil", "Uranium", "Hydro", "Sun", "Wind", "Biomass", "Geothermal", "Unmapped"]
ALIASES = {"United States": "United States of America", "Ivory Coast": "Cote d'Ivoire", "DR Congo": "Congo (the Democratic Republic of the)", "Bahamas": "Bahamas (the)", "Dominican Republic": "Dominican Republic (the)", "Iran": "Iran (Islamic Republic of)", "Niger": "Niger (the)", "Russia": "Russian Federation (the)", "Sudan": "Sudan (the)", "Syria": "Syrian Arab Republic (the)", "Tanzania": "Tanzania, the United Republic of", "Venezuela": "Venezuela (Bolivarian Republic of)"}


def download(url, name):
    path = CACHE / name
    if not path.exists():
        urllib.request.urlretrieve(url, path)
    return path


cities = json.loads((ROOT / "public/data/weather/index.json").read_text())["cities"].values()
countries = {c["country"] for c in cities} | {"World", "Puerto Rico"}
states = {c["admin"] for c in cities if c["country"] == "United States" and len(c["admin"]) == 2}
ember_names = {ALIASES.get(c, c): c for c in countries}
country_data = {}
mapping = {"Coal": "Coal", "Gas": "Natural Gas", "Other Fossil": "Oil", "Nuclear": "Uranium", "Hydro": "Hydro", "Solar": "Sun", "Wind": "Wind", "Bioenergy": "Biomass", "Other Renewables": "Unmapped"}
for row in csv.DictReader(download(EMBER, "ember.csv").open(encoding="utf-8-sig")):
    if not row["Value"] or row["Area"] not in ember_names or row["Category"] != "Capacity" or row["Subcategory"] != "Fuel" or row["Unit"] != "GW" or not 2010 <= int(row["Year"]) <= 2024:
        continue
    name = ember_names[row["Area"]]
    values = country_data.setdefault(name, {}).setdefault(row["Year"], [0] * len(FUELS))
    values[FUELS.index(mapping[row["Variable"]])] = round(float(row["Value"]) * 1000, 2)

# The downloaded Ember capacity release lacks an explicit geothermal category
# (Iceland/Kenya Other Renewables = 0). Retain separately reported IRENA values;
# the runtime helper reconciles possible overlap with Other Renewables.
IRENA_RELEASES = [
    (2020, 55, "https://www.irena.org/-/media/Files/IRENA/Agency/Publication/2020/Mar/IRENA_RE_Capacity_Statistics_2020.pdf"),
    (2025, 56, "https://www.irena.org/-/media/Files/IRENA/Agency/Publication/2025/Mar/IRENA_DAT_RE_Capacity_Statistics_2025.pdf"),
]
irena_names = {"Russian Fed": "Russia", "Türkiye": "Turkey", "USA": "United States"}
for release, page_index, url in IRENA_RELEASES:
    with pdfplumber.open(download(url, f"irena{release}.pdf")) as pdf:
        page = pdf.pages[page_index]
        assert "Geothermal energy" in page.extract_text()
        words = page.extract_words()
        headers = [w for w in words if w["text"].isdigit() and release - 10 <= int(w["text"]) < release and w["top"] < 115]
        assert len(headers) == 10
        centers = [(w["x0"] + w["x1"]) / 2 for w in headers]
        row_tops = sorted({round(w["top"], 1) for w in words if w["x0"] < 110 and w["top"] > 100})
        for top in row_tops:
            row = [w for w in words if abs(w["top"] - top) < 0.2]
            name = " ".join(w["text"] for w in row if w["x0"] < 110)
            name = irena_names.get(name, name)
            if name not in country_data:
                continue
            numbers = [[] for _ in headers]
            for word in row:
                if word["x0"] >= 110 and word["text"].isdigit():
                    nearest = min(range(10), key=lambda i: abs(centers[i] - (word["x0"] + word["x1"]) / 2))
                    numbers[nearest].append(word["text"])
            for header, number in zip(headers, numbers):
                if number and header["text"] in country_data[name]:
                    country_data[name][header["text"]][FUELS.index("Geothermal")] = int("".join(number))


def state_data(code):
    workbook = openpyxl.load_workbook(download(EIA.format(code), f"eia-{code}.xlsx"), data_only=True)
    rows = list(workbook["4A. Capacity"].values)
    name = rows[1][0]
    start = next(i for i, row in enumerate(rows) if row[0] == "Total electric industry") + 1
    fuel_map = {"Coal": "Coal", "Natural gas": "Natural Gas", "Petroleum": "Oil", "Nuclear": "Uranium", "Hydroelectric": "Hydro", "Solar": "Sun", "Wind": "Wind", "Other biomass": "Biomass", "Wood": "Biomass", "Geothermal": "Geothermal", "Other": "Unmapped", "Other gas": "Unmapped"}
    years = {}
    for col, label in enumerate(rows[3]):
        if not isinstance(label, str) or not label.startswith("Year\n"):
            continue
        year = int(label.split("\n")[1])
        if not 2010 <= year <= 2024:
            continue
        values = [0] * len(FUELS)
        for row in rows[start:]:
            if row[0] in fuel_map and isinstance(row[col], (int, float)):
                values[FUELS.index(fuel_map[row[0]])] += row[col]
        # Distributed solar is outside table 4A; add the reported capacity, not its generation.
        solar = list(workbook["19. Small Scale Solar Annual"].values)
        capacity_start = next((i for i, r in enumerate(solar) if r[0] == "Capacity (MW)"), None)
        solar_col = next((i for i, x in enumerate(solar[3]) if x == label), None)
        if capacity_start is not None and solar_col is not None:
            total = next(r for r in solar[capacity_start + 1:] if r[0] == "Total")
            if isinstance(total[solar_col], (int, float)):
                values[FUELS.index("Sun")] += total[solar_col]
        years[str(year)] = [round(v, 2) for v in values]
    print(f"Read {code}: {name}", flush=True)
    return code, {"name": name, "years": years}


with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    states_data = dict(pool.map(state_data, sorted(states)))
missing = countries - country_data.keys()
if missing:
    raise ValueError(f"Missing countries: {sorted(missing)}")
result = {"fuels": FUELS, "countries": dict(sorted(country_data.items())), "states": states_data}
(ROOT / "src/data/DataCenterPowerCapacity.json").write_text(json.dumps(result, separators=(",", ":")) + "\n")
print(f"Wrote {len(country_data)} countries/aggregates and {len(states_data)} states")
