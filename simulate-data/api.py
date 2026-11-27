"""Local REST and WebSocket API for simulated energy readings."""

from __future__ import annotations

import asyncio
import os
import random
import time
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Literal

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from generate_data import (
    LOCAL_TZ,
    MONTH_LABELS,
    WEEKDAY_LABELS,
    build_demo_payload,
    measure_values,
)


class EnergySimulator:
    def __init__(self) -> None:
        self.payload = build_demo_payload()
        self.latest = dict(self.payload["latest"])
        self.rng = random.Random()
        self.last_tick = time.monotonic()
        self.hour_start = datetime.now(LOCAL_TZ).replace(minute=0, second=0, microsecond=0)

    def tick(self) -> None:
        now = datetime.now(LOCAL_TZ)
        elapsed_hours = max(0, time.monotonic() - self.last_tick) / 3_600
        values = measure_values(now, self.rng)
        previous_energy = float(self.latest["energy_kwh"])
        interval_kwh = float(values["power_kw"]) * elapsed_hours
        current_hour = now.replace(minute=0, second=0, microsecond=0)

        if current_hour > self.hour_start:
            self._append_hour(current_hour, values)
            self.hour_start = current_hour

        self.latest = {
            "timestamp": now.isoformat(),
            **values,
            "energy_kwh": round(previous_energy + interval_kwh, 3),
        }
        self._update_history(now, values, interval_kwh)
        self.last_tick = time.monotonic()

    def _append_hour(self, timestamp: datetime, values: dict[str, float]) -> None:
        day_series = self.payload["series"]["day"]
        day_series.append(
            {
                "timestamp": timestamp.isoformat(),
                "label": timestamp.strftime("%H:%M"),
                "consumption_kwh": 0.0,
                "power_kw": values["power_kw"],
            }
        )
        del day_series[:-24]

        if timestamp.date() != self.hour_start.date():
            self.payload["summary"]["today_kwh"] = 0.0
            self.payload["summary"]["peak_hour"] = {
                "label": timestamp.strftime("%H:%M"),
                "consumption_kwh": 0.0,
            }
            if timestamp.month != self.hour_start.month:
                self.payload["summary"]["month_kwh"] = 0.0
            day_label = f"{timestamp.day:02d} {MONTH_LABELS[timestamp.month - 1]}"
            week_label = WEEKDAY_LABELS[timestamp.weekday()]
            for period, label, limit in (("week", week_label, 7), ("month", day_label, 30)):
                series = self.payload["series"][period]
                series.append(
                    {
                        "timestamp": timestamp.replace(hour=0).isoformat(),
                        "label": label,
                        "consumption_kwh": 0.0,
                        "power_kw": values["power_kw"],
                    }
                )
                del series[:-limit]

    def _update_history(
        self,
        now: datetime,
        values: dict[str, float],
        interval_kwh: float,
    ) -> None:
        hour_point = self.payload["series"]["day"][-1]
        hour_point["consumption_kwh"] = round(
            float(hour_point["consumption_kwh"]) + interval_kwh, 3
        )
        hour_point["power_kw"] = values["power_kw"]

        today_total = float(self.payload["summary"]["today_kwh"]) + interval_kwh
        month_total = float(self.payload["summary"]["month_kwh"]) + interval_kwh
        self.payload["summary"]["today_kwh"] = round(today_total, 2)
        self.payload["summary"]["month_kwh"] = round(month_total, 2)

        for period in ("week", "month"):
            series = self.payload["series"][period]
            daily_point = series[-1]
            daily_point["consumption_kwh"] = round(
                float(daily_point["consumption_kwh"]) + interval_kwh, 3
            )
            daily_point["power_kw"] = values["power_kw"]

        peak = self.payload["summary"]["peak_hour"]
        if float(hour_point["consumption_kwh"]) > float(peak["consumption_kwh"]):
            peak["label"] = now.strftime("%H:%M")
            peak["consumption_kwh"] = round(float(hour_point["consumption_kwh"]), 2)

    async def run(self) -> None:
        while True:
            self.tick()
            await asyncio.sleep(2)


simulator = EnergySimulator()


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(simulator.run())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Pantau Daya Simulator",
    description="API simulasi untuk dashboard pemantauan konsumsi energi listrik.",
    version="0.1.0",
    lifespan=lifespan,
)

default_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]
extra_origins = [
    origin.strip()
    for origin in os.getenv("SIMULATOR_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=default_origins + extra_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "pantau-daya-simulator"}


@app.get("/api/dashboard")
def dashboard() -> dict[str, object]:
    return {**simulator.payload, "latest": simulator.latest}


@app.get("/api/history")
def history(
    period: Literal["day", "week", "month"] = Query(default="day"),
) -> dict[str, object]:
    points = simulator.payload["series"][period]
    return {
        "period": period,
        "points": points,
        "total_kwh": round(sum(float(point["consumption_kwh"]) for point in points), 2),
    }


@app.websocket("/ws/live")
async def live_feed(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(simulator.latest)
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        pass
