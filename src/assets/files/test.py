#!/usr/bin/env python3
"""
Prototipo de consola para reproducir la lógica del libro en Python.

Calcula el mismo parámetro normalizado que usa Parametros.xlsx:

    parametro = cantidad / area_construida

Después reproduce las estadísticas y métodos de rango al estilo Excel:

- Media, varianza muestral y desviación estándar muestral
- Mediana
- Percentiles inclusivos, compatibles con el comportamiento de Excel
- MAD y MAD ajustado
- Bandas de rango construidas a partir de:
  - media +/- s
  - mediana +/- MAD ajustado
  - mediana + percentiles (P25/P75 para esperado, P10/P90 para preventivo)

Ejecuta el script sin argumentos para ver los tres escenarios de referencia
extraídos del libro. También acepta CSV o JSON con área y cantidad.
"""

from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from pathlib import Path
from statistics import mean, median, stdev, variance
from typing import Iterable, Sequence


MAD_ADJUSTMENT = 1.4826


@dataclass(frozen=True)
class Observation:
    label: str
    area_m2: float
    quantity_m3: float

    @property
    def parameter(self) -> float | None:
        if self.area_m2 == 0:
            return None
        return self.quantity_m3 / self.area_m2


def clean(values: Iterable[float | None]) -> list[float]:
    return [v for v in values if v is not None]


def inclusive_percentile(values: Sequence[float], p: float) -> float:
    """
    Excel-compatible inclusive percentile.

    position = 1 + (n - 1) * p
    """
    data = sorted(values)
    if not data:
        raise ValueError("percentile requires at least one numeric value")
    if len(data) == 1:
        return data[0]

    if p <= 0:
        return data[0]
    if p >= 1:
        return data[-1]

    position = 1 + (len(data) - 1) * p
    lower_idx = int(position)
    frac = position - lower_idx
    lower = data[lower_idx - 1]
    upper = data[min(lower_idx, len(data) - 1)]
    return lower + frac * (upper - lower)


def mad(values: Sequence[float]) -> float:
    center = median(values)
    return median([abs(v - center) for v in values])


def coverage_count(values: Sequence[float], low: float, high: float) -> int:
    return sum(1 for v in values if low <= v <= high)


def fmt(value: float | int | str, digits: int = 6) -> str:
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)


def render_table(headers: Sequence[str], rows: Sequence[Sequence[object]]) -> str:
    str_rows = [[fmt(cell) for cell in row] for row in rows]
    widths = [len(header) for header in headers]
    for row in str_rows:
        for idx, cell in enumerate(row):
            widths[idx] = max(widths[idx], len(cell))

    def line(left: str, mid: str, right: str, fill: str) -> str:
        parts = [fill * (w + 2) for w in widths]
        return left + mid.join(parts) + right

    header_line = "| " + " | ".join(header.ljust(widths[idx]) for idx, header in enumerate(headers)) + " |"
    sep = line("+", "+", "+", "-")
    out = [sep, header_line, sep]
    for row in str_rows:
        out.append("| " + " | ".join(cell.ljust(widths[idx]) for idx, cell in enumerate(row)) + " |")
    out.append(sep)
    return "\n".join(out)


@dataclass(frozen=True)
class ScenarioStats:
    name: str
    values: list[float]
    center_mean: float
    center_median: float
    sample_variance: float
    sample_stddev: float
    coefficient_of_variation: float
    minimum: float
    maximum: float
    p10: float
    p25: float
    p50: float
    p75: float
    p90: float
    iqr: float
    mad_raw: float
    mad_adjusted: float


@dataclass(frozen=True)
class RangeMethod:
    name: str
    expected_low: float
    expected_high: float
    preventive_low: float
    preventive_high: float
    expected_coverage: int
    preventive_coverage: int

    @property
    def expected_width(self) -> float:
        return self.expected_high - self.expected_low

    @property
    def preventive_width(self) -> float:
        return self.preventive_high - self.preventive_low


def describe(values: Sequence[float], name: str) -> ScenarioStats:
    if not values:
        raise ValueError(f"scenario {name!r} has no numeric parameters")

    data = sorted(values)
    center_mean = mean(data)
    center_median = median(data)
    sample_variance = variance(data) if len(data) > 1 else 0.0
    sample_stddev = stdev(data) if len(data) > 1 else 0.0
    coefficient_of_variation = 0.0 if center_mean == 0 else sample_stddev / center_mean
    p10 = inclusive_percentile(data, 0.10)
    p25 = inclusive_percentile(data, 0.25)
    p50 = inclusive_percentile(data, 0.50)
    p75 = inclusive_percentile(data, 0.75)
    p90 = inclusive_percentile(data, 0.90)
    mad_raw = mad(data)
    mad_adjusted = mad_raw * MAD_ADJUSTMENT

    return ScenarioStats(
        name=name,
        values=list(data),
        center_mean=center_mean,
        center_median=center_median,
        sample_variance=sample_variance,
        sample_stddev=sample_stddev,
        coefficient_of_variation=coefficient_of_variation,
        minimum=min(data),
        maximum=max(data),
        p10=p10,
        p25=p25,
        p50=p50,
        p75=p75,
        p90=p90,
        iqr=p75 - p25,
        mad_raw=mad_raw,
        mad_adjusted=mad_adjusted,
    )


def build_methods(stats: ScenarioStats) -> dict[str, RangeMethod]:
    mean_std_low = stats.center_mean - stats.sample_stddev
    mean_std_high = stats.center_mean + stats.sample_stddev
    mean_std_pre_low = stats.center_mean - 2 * stats.sample_stddev
    mean_std_pre_high = stats.center_mean + 2 * stats.sample_stddev

    median_mad_low = stats.center_median - stats.mad_adjusted
    median_mad_high = stats.center_median + stats.mad_adjusted
    median_mad_pre_low = stats.center_median - 2 * stats.mad_adjusted
    median_mad_pre_high = stats.center_median + 2 * stats.mad_adjusted

    median_pct_low = stats.p25
    median_pct_high = stats.p75
    median_pct_pre_low = stats.p10
    median_pct_pre_high = stats.p90

    values = stats.values
    return {
        "mean_std": RangeMethod(
            name="Media +/- s",
            expected_low=mean_std_low,
            expected_high=mean_std_high,
            preventive_low=mean_std_pre_low,
            preventive_high=mean_std_pre_high,
            expected_coverage=coverage_count(values, mean_std_low, mean_std_high),
            preventive_coverage=coverage_count(values, mean_std_pre_low, mean_std_pre_high),
        ),
        "median_mad": RangeMethod(
            name="Mediana +/- MAD ajustado",
            expected_low=median_mad_low,
            expected_high=median_mad_high,
            preventive_low=median_mad_pre_low,
            preventive_high=median_mad_pre_high,
            expected_coverage=coverage_count(values, median_mad_low, median_mad_high),
            preventive_coverage=coverage_count(values, median_mad_pre_low, median_mad_pre_high),
        ),
        "median_percentiles": RangeMethod(
            name="Mediana + percentiles",
            expected_low=median_pct_low,
            expected_high=median_pct_high,
            preventive_low=median_pct_pre_low,
            preventive_high=median_pct_pre_high,
            expected_coverage=coverage_count(values, median_pct_low, median_pct_high),
            preventive_coverage=coverage_count(values, median_pct_pre_low, median_pct_pre_high),
        ),
    }


def classify(value: float, method: RangeMethod) -> tuple[str, float, str]:
    if value < method.preventive_low or value > method.preventive_high:
        return "Crítico", (value - method.expected_low), "Fuera del rango preventivo"
    if method.expected_low <= value <= method.expected_high:
        return "Correcto", (value - method.expected_low), "Dentro del rango esperado"
    return "Revisar", (value - method.expected_low), "Dentro del preventivo, pero fuera del esperado"


def print_stats(stats: ScenarioStats) -> None:
    methods = build_methods(stats)

    print(f"\n=== {stats.name} ===")
    stats_rows = [
        ("n", len(stats.values)),
        ("media", stats.center_mean),
        ("mediana", stats.center_median),
        ("varianza muestral", stats.sample_variance),
        ("desviación estándar muestral", stats.sample_stddev),
        ("coeficiente de variación", stats.coefficient_of_variation),
        ("mínimo", stats.minimum),
        ("máximo", stats.maximum),
        ("P10", stats.p10),
        ("P25", stats.p25),
        ("P50", stats.p50),
        ("P75", stats.p75),
        ("P90", stats.p90),
        ("RIC", stats.iqr),
        ("MAD", stats.mad_raw),
        ("MAD ajustado", stats.mad_adjusted),
    ]
    print("\nEstadísticas")
    print(render_table(("Métrica", "Valor"), stats_rows))

    method_rows = []
    for method in methods.values():
        method_rows.append(
            (
                method.name,
                method.expected_low,
                method.expected_high,
                method.expected_width,
                f"{method.expected_coverage}/{len(stats.values)}",
                method.preventive_low,
                method.preventive_high,
                method.preventive_width,
                f"{method.preventive_coverage}/{len(stats.values)}",
            )
        )

    print("\nRangos")
    print(
        render_table(
            (
                "Método",
                "Límite esp. inf.",
                "Límite esp. sup.",
                "Ancho esp.",
                "Cob. esp.",
                "Límite prev. inf.",
                "Límite prev. sup.",
                "Ancho prev.",
                "Cob. prev.",
            ),
            method_rows,
        )
    )

    print("\nSugerencia")
    print(f"- {suggest_method(stats)}")


def suggest_method(stats: ScenarioStats) -> str:
    """
    Lightweight heuristic for choosing a method when the data quality changes.

    This is intentionally conservative:
    - Mean +/- s for stable, compact data
    - Median +/- adjusted MAD for small samples or mild outliers
    - Median + percentiles for skewed or uneven data
    """
    n = len(stats.values)
    median = abs(stats.center_median) or 1.0
    spread = (stats.maximum - stats.minimum) / median
    iqr_ratio = stats.iqr / median
    tail_balance = abs((stats.p90 - stats.p50) - (stats.p50 - stats.p10))
    tail_span = max(stats.p90 - stats.p10, 1e-9)
    skewness_proxy = tail_balance / tail_span

    if n < 8 or spread > 0.55:
        return "Mediana +/- MAD ajustado: la muestra es pequeña o muy dispersa."
    if skewness_proxy > 0.35 or stats.coefficient_of_variation > 0.16:
        return "Mediana + percentiles: la distribución es asimétrica o cambia por tramos."
    if iqr_ratio < 0.08 and stats.coefficient_of_variation < 0.08:
        return "Media +/- s: los datos son compactos y bastante estables."
    return "Mediana +/- MAD ajustado: el conjunto es razonable, pero todavía conviene robustez."


def load_csv(path: Path) -> dict[str, list[Observation]]:
    scenarios: dict[str, list[Observation]] = {}
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames:
            raise ValueError("El CSV no tiene fila de encabezado")

        lower_fields = {name.lower(): name for name in reader.fieldnames}

        scenario_field = lower_fields.get("scenario")
        area_field = lower_fields.get("area") or lower_fields.get("area_m2") or lower_fields.get("construction_area")
        quantity_field = lower_fields.get("quantity") or lower_fields.get("quantity_m3") or lower_fields.get("amount")

        if area_field is None or quantity_field is None:
            raise ValueError(
                "El CSV debe incluir columnas de área y cantidad. "
                "Nombres aceptados para área: area, area_m2, construction_area. "
                "Nombres aceptados para cantidad: quantity, quantity_m3, amount."
            )

        for idx, row in enumerate(reader, start=2):
            scenario = row.get(scenario_field, "default") if scenario_field else "default"
            area_raw = row.get(area_field, "").strip()
            quantity_raw = row.get(quantity_field, "").strip()
            if not area_raw or not quantity_raw:
                continue
            obs = Observation(
                label=f"row {idx}",
                area_m2=float(area_raw),
                quantity_m3=float(quantity_raw),
            )
            scenarios.setdefault(scenario, []).append(obs)
    return scenarios


def load_json(path: Path) -> dict[str, list[Observation]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    scenarios: dict[str, list[Observation]] = {}

    if isinstance(payload, list):
        payload = {"predeterminado": payload}
    if not isinstance(payload, dict):
        raise ValueError("El JSON debe contener una lista de filas o un mapeo por escenario")

    for scenario, rows in payload.items():
        if not isinstance(rows, list):
            raise ValueError(f"El escenario {scenario!r} debe contener una lista de filas")
        bucket: list[Observation] = []
        for idx, row in enumerate(rows, start=1):
            if not isinstance(row, dict):
                raise ValueError(f"Row {idx} in scenario {scenario!r} must be an object")
            area = float(row["area"])
            quantity = float(row["quantity"])
            label = str(row.get("label", f"row {idx}"))
            bucket.append(Observation(label=label, area_m2=area, quantity_m3=quantity))
        scenarios[scenario] = bucket
    return scenarios


def built_in_reference_data() -> dict[str, list[Observation]]:
    homogeneous = [
        (4200, 621.6), (4800, 724.8), (5100, 780.3), (5600, 868), (6100, 951.6),
        (6500, 1027), (7000, 1113), (7400, 1184), (7900, 1271.9), (8300, 1344.6),
        (8800, 1434.4), (9200, 1508.8), (9700, 1600.5), (10200, 1693.2), (10800, 1803.6),
        (11400, 1915.2), (12000, 2028), (12600, 2142), (13200, 2257.2), (14000, 2408),
    ]
    outlier = [
        (4200, 621.6), (4800, 724.8), (5100, 780.3), (5600, 868), (6100, 951.6),
        (6500, 1027), (7000, 1113), (7400, 1184), (7900, 1271.9), (8300, 1344.6),
        (8800, 1434.4), (9200, 1508.8), (9700, 1600.5), (10200, 1693.2), (10800, 1803.6),
        (11400, 1915.2), (12000, 2028), (12600, 2142), (13200, 2257.2), (14000, 4200),
    ]
    asymmetric = [
        (4200, 621.6), (4800, 724.8), (5100, 780.3), (5600, 868), (6100, 951.6),
        (6500, 1027), (7000, 1113), (7400, 1184), (7900, 1271.9), (8300, 1344.6),
        (8800, 1434.4), (9200, 1508.8), (9700, 1600.5), (10200, 1693.2), (10800, 1803.6),
        (11400, 2029.2), (12000, 2280), (12600, 2583), (13200, 3036), (14000, 3780),
    ]

    def make(name: str, rows: list[tuple[float, float]]) -> list[Observation]:
        return [
            Observation(label=f"Obra {idx:02d}", area_m2=area, quantity_m3=quantity)
            for idx, (area, quantity) in enumerate(rows, start=1)
        ]

    return {
        "homogéneo": make("homogéneo", homogeneous),
        "con_atípico": make("con_atípico", outlier),
        "asimétrico": make("asimétrico", asymmetric),
    }


def analyze_scenario(name: str, rows: Sequence[Observation]) -> ScenarioStats:
    params = clean(row.parameter for row in rows)
    return describe(params, name)


def classify_new_value(stats: ScenarioStats, value: float, method_key: str) -> None:
    methods = build_methods(stats)
    method = methods[method_key]
    state, delta, note = classify(value, method)
    print("\nClasificación")
    print(
        render_table(
            ("Campo", "Valor"),
            [
                ("Método", method.name),
                ("Valor", value),
                ("Estado", state),
                ("Delta vs. límite esperado inferior", delta),
                ("Nota", note),
            ],
        )
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Reproducir los cálculos de parámetros estilo Excel.")
    parser.add_argument("--csv", type=Path, help="Archivo CSV con columnas de área y cantidad")
    parser.add_argument("--json", type=Path, help="Archivo JSON con filas o escenarios")
    parser.add_argument("--scenario", help="Nombre del escenario a analizar del archivo cargado")
    parser.add_argument(
        "--method",
        choices=["mean_std", "median_mad", "median_percentiles"],
        default="mean_std",
        help="Método a usar en la demostración de clasificación",
    )
    parser.add_argument("--value", type=float, help="Valor extra para clasificar con el método elegido")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.csv and args.json:
        raise SystemExit("Usa --csv o --json, pero no ambos.")

    if args.csv:
        raw = load_csv(args.csv)
    elif args.json:
        raw = load_json(args.json)
    else:
        raw = built_in_reference_data()

    if args.scenario:
        if args.scenario not in raw:
            raise SystemExit(f"No se encontró el escenario {args.scenario!r}. Disponibles: {', '.join(raw)}")
        selected = {args.scenario: raw[args.scenario]}
    else:
        selected = raw

    analyzed: dict[str, ScenarioStats] = {}
    for name, rows in selected.items():
        stats = analyze_scenario(name, rows)
        analyzed[name] = stats
        print_stats(stats)

    if args.value is not None:
        first_name = next(iter(analyzed))
        classify_new_value(analyzed[first_name], args.value, args.method)


if __name__ == "__main__":
    main()
