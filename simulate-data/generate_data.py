"""Generate reproducible sample energy readings for the dashboard."""

from __future__ import annotations

import math
import random
from collections import defaultdict
from datetime import datetime, timedelta, timezone

LOCAL_TZ = timezone(timedelta(hours=7), "WIB")
BASE_METER_KWH = 18_420.0
WEEKDAY_LABELS = ("Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min")
MONTH_LABELS = (
    "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
    "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
)


def measure_values(moment: datetime, rng: random.Random) -> dict[str, float]:
    """Return a plausible single-phase electrical reading for a timestamp."""
    hour = moment.hour + moment.minute / 60
    morning_peak = math.exp(-((hour - 9.0) / 2.7) ** 2)
    afternoon_peak = math.exp(-((hour - 14.5) / 3.1) ** 2)
    evening_peak = math.exp(-((hour - 20.0) / 2.5) ** 2)
    load_profile = (
        0.18
        + 0.27 * morning_peak
        + 0.42 * afternoon_peak
        + 0.2 * evening_peak
    )

    power_kw = max(0.25, 0.42 + load_profile * 2.75 + rng.gauss(0, 0.11))
    voltage_v = 222 + 2.2 * math.sin(hour / 24 * math.tau) + rng.gauss(0, 1.1)
    power_factor = min(
        0.99,
        max(0.88, 0.94 + load_profile * 0.035 + rng.gauss(0, 0.012)),
    )
    current_a = power_kw * 1_000 / (voltage_v * power_factor)

    return {
        "voltage_v": round(voltage_v, 1),
        "current_a": round(current_a, 2),
        "power_kw": round(power_kw, 3),
        "power_factor": round(power_factor, 3),
    }


def _make_chart_point(
    timestamp: datetime,
    consumption_kwh: float,
    power_kw: float,
    label: str,
) -> dict[str, object]:
    return {
        "timestamp": timestamp.isoformat(),
        "label": label,
        "consumption_kwh": round(consumption_kwh, 3),
        "power_kw": round(power_kw, 3),
    }


def build_demo_payload(now: datetime | None = None) -> dict[str, object]:
    """Build a dashboard payload with 30 days of hourly history."""
    now = now.astimezone(LOCAL_TZ) if now else datetime.now(LOCAL_TZ)
    current_hour = now.replace(minute=0, second=0, microsecond=0)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    start = min(current_hour - timedelta(days=30), month_start)
    rng = random.Random(20250308)

    readings: list[dict[str, object]] = []
    meter_total = BASE_METER_KWH
    cursor = start
    while cursor <= current_hour:
        values = measure_values(cursor, rng)
        duration_hours = 1.0
        if cursor == current_hour:
            duration_hours = max(0, (now - current_hour).total_seconds()) / 3_600
        interval_kwh = float(values["power_kw"]) * duration_hours
        meter_total += interval_kwh
        readings.append(
            {
                "timestamp": cursor.isoformat(),
                "label": cursor.strftime("%H:%M"),
                "consumption_kwh": round(interval_kwh, 3),
                "power_kw": values["power_kw"],
                "voltage_v": values["voltage_v"],
                "current_a": values["current_a"],
                "power_factor": values["power_factor"],
                "energy_kwh": round(meter_total, 3),
            }
        )
        cursor += timedelta(hours=1)

    daily_buckets: dict[str, list[dict[str, object]]] = defaultdict(list)
    for reading in readings:
        timestamp = datetime.fromisoformat(str(reading["timestamp"]))
        daily_buckets[timestamp.date().isoformat()].append(reading)

    daily_points: list[dict[str, object]] = []
    for date_key, day_readings in daily_buckets.items():
        day = datetime.fromisoformat(date_key).replace(tzinfo=LOCAL_TZ)
        total = sum(float(point["consumption_kwh"]) for point in day_readings)
        average_power = sum(float(point["power_kw"]) for point in day_readings) / len(day_readings)
        month_label = f"{day.day:02d} {MONTH_LABELS[day.month - 1]}"
        daily_points.append(_make_chart_point(day, total, average_power, month_label))

    day_readings = readings[-24:]
    day_series = [
        _make_chart_point(
            datetime.fromisoformat(str(point["timestamp"])),
            float(point["consumption_kwh"]),
            float(point["power_kw"]),
            str(point["label"]),
        )
        for point in day_readings
    ]
    week_series = [
        _make_chart_point(
            datetime.fromisoformat(str(point["timestamp"])),
            float(point["consumption_kwh"]),
            float(point["power_kw"]),
            WEEKDAY_LABELS[
                datetime.fromisoformat(str(point["timestamp"])).weekday()
            ],
        )
        for point in daily_points[-7:]
    ]
    month_series = daily_points[-30:]

    today_key = now.date().isoformat()
    month_key = now.strftime("%Y-%m")
    today_readings = [
        point
        for point in readings
        if datetime.fromisoformat(str(point["timestamp"])).date().isoformat() == today_key
    ]
    this_month_points = [
        point
        for point in daily_points
        if datetime.fromisoformat(str(point["timestamp"])).strftime("%Y-%m") == month_key
    ]
    peak_point = max(
        day_readings,
        key=lambda point: float(point["consumption_kwh"]),
    )
    latest_values = measure_values(now, rng)

    return {
        "generated_at": now.isoformat(),
        "latest": {
            "timestamp": now.isoformat(),
            **latest_values,
            "energy_kwh": round(meter_total, 3),
        },
        "summary": {
            "today_kwh": round(
                sum(float(point["consumption_kwh"]) for point in today_readings),
                2,
            ),
            "month_kwh": round(
                sum(float(point["consumption_kwh"]) for point in this_month_points), 2
            ),
            "peak_hour": {
                "label": datetime.fromisoformat(
                    str(peak_point["timestamp"])
                ).strftime("%H:%M"),
                "consumption_kwh": round(float(peak_point["consumption_kwh"]), 2),
            },
        },
        "series": {
            "day": day_series,
            "week": week_series,
            "month": month_series,
        },
    }
