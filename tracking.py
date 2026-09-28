"""Combines several TX->RX links (one Sensor each) into one picture of the room.

Each link runs the single-link pipeline from sensing.py (movement, breathing).
On top of that, with receivers placed around the room:
  - Where: movement disturbs the links whose line passes close to the person
    most. The estimate is the midpoint of each link, weighted by how far its
    movement score is above its own detection line. This is coarse (about
    which part of the room, not an exact spot): a link only says "something
    moved near my line", not where along it.
  - Direction: the trend of that estimate over the last seconds, and the order
    in which links started to see movement (walking across the room crosses
    the links one after another).
  - Breathing and presence: taken from whichever link sees them best.
"""
import json, threading, time
from collections import deque

import numpy as np

from sensing import Sensor

TICK_HZ = 15
RATIO_SMOOTH = 0.5          # s, smoothing of each link's movement ratio
POS_SMOOTH = 0.6            # s, smoothing of the position estimate
WEIGHT_START = 0.8          # a link counts towards the position above 0.8 x its line
TREND_SECONDS = 2.0         # position history used for the direction
MIN_SPEED = 0.25            # m/s, slower trends are shown as "no clear direction"
TOWARD_COS = 0.6            # direction must point within ~53 degrees of a board to name it
SEQUENCE_SECONDS = 5.0      # link onsets remembered for the crossing order


def load_layout(path):
    with open(path) as f:
        lay = json.load(f)
    tx = lay["tx"]
    for r in lay["receivers"]:
        r["mac"] = r["mac"].lower()
    return dict(tx=dict(name=tx.get("name", "TX"), x=float(tx["x"]), y=float(tx["y"])),
                receivers=[dict(name=r["name"], mac=r["mac"], x=float(r["x"]), y=float(r["y"]))
                           for r in lay["receivers"]])


class Link:
    def __init__(self, rx, tx):
        self.name, self.mac = rx["name"], rx["mac"]
        self.pos = np.array([rx["x"], rx["y"]])
        self.mid = (self.pos + np.array([tx["x"], tx["y"]])) / 2
        self.sensor = Sensor()
        self.port = None            # serial port it was found on, set by server.py
        self.ratio = 0.0            # smoothed movement ratio
        self.was_moving = False


class Tracker:
    def __init__(self, layout):
        self.layout = layout
        self.tx = np.array([layout["tx"]["x"], layout["tx"]["y"]])
        self.links = {r["name"]: Link(r, layout["tx"]) for r in layout["receivers"]}
        self.by_mac = {l.mac: l for l in self.links.values()}
        self.errors = {}            # extra problems reported by server.py (unknown boards...)
        self.lock = threading.Lock()
        self.pos = None
        self.trail = deque()        # (t, x, y) while movement is located
        self.onsets = deque()       # (t, link name) when a link starts seeing movement
        self.present_since = None
        self.latest = None
        self._last = None
        threading.Thread(target=self._loop, daemon=True).start()

    # ---- controls, applied to every link --------------------------------------
    def calibrate(self):
        for l in self.links.values():
            l.sensor.calibrate()

    def set_sensitivity(self, value):
        for l in self.links.values():
            l.sensor.set_sensitivity(value)

    def _loop(self):
        while True:
            time.sleep(1 / TICK_HZ)
            try:
                snap = self._tick(time.time())
            except Exception as e:                        # keep the loop alive
                snap = dict(self.latest or {}, error=f"tracking: {e}")
            with self.lock:
                self.latest = snap

    def snapshot(self):
        with self.lock:
            return dict(self.latest) if self.latest else dict(t=time.time(), state="warming", links=[])

    # ---- combine the links ----------------------------------------------------
    def _tick(self, now):
        dt = 1 / TICK_HZ if self._last is None else min(1.0, now - self._last)
        self._last = now
        snaps = {name: l.sensor.snapshot(now) for name, l in self.links.items()}
        live = {n: s for n, s in snaps.items() if s["link"]["rate"] > 0}

        # Per-link smoothed ratio and movement onsets
        k = 1 - np.exp(-dt / RATIO_SMOOTH)
        for n, l in self.links.items():
            r = snaps[n]["motion"]["ratio"] if n in live else None
            l.ratio += ((r or 0.0) - l.ratio) * k
            moving = n in live and snaps[n]["state"] == "moving"
            if moving and not l.was_moving:
                self.onsets.append((now, n))
            l.was_moving = moving
        while self.onsets and now - self.onsets[0][0] > SEQUENCE_SECONDS:
            self.onsets.popleft()

        states = {n: s["state"] for n, s in live.items()}
        vals = set(states.values())
        if not live:
            state = "nodata"
        elif vals & {"calib_countdown", "calibrating"}:
            state = "calib_countdown" if "calib_countdown" in vals else "calibrating"
        elif "moving" in vals:
            state = "moving"
        elif "still_breathing" in vals:
            state = "still_breathing"
        elif vals == {"warming"}:
            state = "warming"
        elif "maybe" in vals:
            state = "maybe"
        else:
            state = "empty"

        present = state in ("moving", "still_breathing", "maybe")
        if present and self.present_since is None:
            self.present_since = now
        if not present:
            self.present_since = None

        # The link that sees the most movement drives the movement meter
        ranked = sorted(live, key=lambda n: live[n]["motion"]["ratio"] or 0, reverse=True)
        primary = live[ranked[0]] if ranked else next(iter(snaps.values()))
        motion = dict(primary["motion"], link=ranked[0] if ranked else None)
        motion["events"] = sum(s["motion"]["events"] for s in snaps.values())
        agos = [s["motion"]["last_ago"] for s in snaps.values() if s["motion"]["last_ago"] is not None]
        motion["last_ago"] = min(agos) if agos else None

        # Breathing from the link that sees it best
        def breath_rank(n):
            b = live[n]["breathing"]
            return (b.get("status") == "detected", b.get("strength") or 0)
        bname = max(live, key=breath_rank) if live else None
        breathing = dict(live[bname]["breathing"], link=bname) if bname else dict(status="searching")

        dists = [s["disturbance"] for s in live.values() if s["disturbance"]]
        dists = [d for d in dists if len(d) == len(dists[0])] if dists else []
        disturbance = [round(float(x), 2) for x in np.mean(dists, axis=0)] if dists else None

        calibs = [s for s in live.values() if s["calib"]]
        ago = [s["calibrated_ago"] for s in live.values() if s["calibrated_ago"] is not None]
        warm = [s["warmup_left"] for s in live.values() if s["warmup_left"] is not None]
        warnings = [f"{n}: {s['calib_warning']}" for n, s in live.items() if s["calib_warning"]]
        errors = [f"{n}: {s['error']}" for n, s in snaps.items() if s["error"]] + list(self.errors.values())
        rates = [snaps[n]["link"]["rate"] for n in self.links]

        links = []
        for n, l in self.links.items():
            s = snaps[n]
            thr = s["motion"]["threshold"]
            links.append(dict(
                name=n, mac=l.mac, port=l.port, x=float(l.pos[0]), y=float(l.pos[1]),
                rate=s["link"]["rate"], rssi=s["link"]["rssi"], state=s["state"],
                ratio=s["motion"]["ratio"], smooth_ratio=round(l.ratio, 3),
                breathing=s["breathing"].get("status"), breath_strength=s["breathing"].get("strength"),
                history=[(t, round(v / thr, 3)) for t, v in s["history"]] if thr else [],
            ))

        return dict(
            t=now, state=state, error="; ".join(errors) or None,
            warmup_left=max(warm) if warm and state == "warming" else None,
            calib=calibs[0]["calib"] if calibs else None,
            calibrated_ago=min(ago) if ago else None,
            calib_warning=" ".join(warnings) or None,
            sensitivity=primary["sensitivity"],
            link=dict(rate=min(rates) if rates else 0, rssi=primary["link"]["rssi"],
                      subcarriers=primary["link"]["subcarriers"]),
            links=links,
            motion=motion,
            presence=dict(present=present,
                          for_s=None if self.present_since is None else now - self.present_since,
                          still_for_s=None if state != "still_breathing" else
                          min((s["presence"]["still_for_s"] for s in live.values()
                               if s["presence"]["still_for_s"] is not None), default=None)),
            breathing=breathing,
            disturbance=disturbance,
            location=self._locate(now, dt, state),
            layout=dict(tx=self.layout["tx"], receivers=[dict(name=r["name"], x=r["x"], y=r["y"])
                                                         for r in self.layout["receivers"]]),
        )

    def _locate(self, now, dt, state):
        weights = {n: max(0.0, l.ratio - WEIGHT_START) ** 2 for n, l in self.links.items()}
        total = sum(weights.values())
        active = bool(state == "moving" and total > 1e-3)
        if active:
            target = sum(w * self.links[n].mid for n, w in weights.items()) / total
            k = 1 - np.exp(-dt / POS_SMOOTH)
            self.pos = target if self.pos is None else self.pos + (target - self.pos) * k
            self.trail.append((now, *self.pos))
        while self.trail and (now - self.trail[0][0] > TREND_SECONDS or not active):
            self.trail.popleft()

        out = dict(active=active, x=None, y=None, near=None, share={}, direction=None, sequence=[])
        if self.pos is not None:
            out.update(x=round(float(self.pos[0]), 3), y=round(float(self.pos[1]), 3))
        if active:
            out["near"] = max(weights, key=weights.get)
            out["share"] = {n: round(w / total, 3) for n, w in weights.items()}

        # Direction: straight-line fit of the recent positions
        if active and len(self.trail) >= 5 and self.trail[-1][0] - self.trail[0][0] >= 0.8 * TREND_SECONDS:
            T = np.array(self.trail)
            t = T[:, 0] - T[:, 0].mean()
            v = (t @ (T[:, 1:] - T[:, 1:].mean(axis=0))) / (t @ t)
            speed = float(np.hypot(*v))
            if speed >= MIN_SPEED:
                u = v / speed
                boards = {self.layout["tx"]["name"]: self.tx, **{n: l.pos for n, l in self.links.items()}}
                best, best_cos = None, TOWARD_COS
                for n, p in boards.items():
                    d = p - self.pos
                    c = float(u @ d / (np.hypot(*d) + 1e-9))
                    if c > best_cos:
                        best, best_cos = n, c
                out["direction"] = dict(dx=round(float(u[0]), 3), dy=round(float(u[1]), 3),
                                        speed=round(speed, 2), toward=best)

        # Order in which links started seeing movement (consecutive repeats merged)
        seq = []
        for _, n in self.onsets:
            if not seq or seq[-1] != n:
                seq.append(n)
        if len(seq) >= 2:
            out["sequence"] = seq[-4:]
            out["sequence_ago"] = round(now - self.onsets[-1][0], 1)
        return out
