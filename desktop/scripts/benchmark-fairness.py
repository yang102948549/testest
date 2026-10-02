"""Exploratory native HiGHS benchmark; not the production engine or WASM.

Full coverage and checked designated duties are hard constraints in these
feasible samples. Optimize designated hallway preference, then normal teachers'
absolute deviations from their actual mean (or score range with --range).
No count caps or other objectives. Timings exclude Python/SciPy startup. The
fairness solve is deliberately cold: scipy.optimize.milp has no start argument.
"""
import copy
import json
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import scipy
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix


def benchmark(filename, add_halls=0, designated_count=0, fairness="absolute"):
    start = time.perf_counter()
    d = json.loads(Path(filename).read_text(encoding="utf-8-sig"))
    d = copy.deepcopy(d)
    for i in range(add_halls):
        d["rooms"].append({"id": f"extra-hall-{i}", "name": f"Hall {i}", "kind": "hallway", "grade": 1})
    teachers = d["teachers"]
    assert all(t["role"] == "normal" for t in teachers)
    special = set(range(len(teachers) - designated_count, len(teachers)))
    slots, subjects = [], {}
    for day in d["dates"]:
        for p in range(1, day["periods"] + 1):
            k = (day["date"], p)
            lessons = [l for l in d["lessons"] if (l["date"], l["period"]) == k]
            if not lessons:
                continue
            subjects[k] = {s.strip() for l in lessons for s in re.split(r"[,/]", l["subject"]) if s.strip()}
            selected = {r for l in lessons for r in l["roomIds"]}
            self_study = all(l["subject"].strip() == "자습" for l in lessons)
            for r in d["rooms"]:
                if r["kind"] == "classroom" and r["id"] not in selected:
                    continue
                if r["kind"] == "hallway" and self_study:
                    continue
                slots.append((k, r["id"], r["kind"]))
    edges, by_slot, by_time, by_teacher = [], defaultdict(list), defaultdict(list), defaultdict(list)
    for si, (k, room, kind) in enumerate(slots):
        for ti, t in enumerate(teachers):
            if t["homeroom"] == room or room in t["movingRooms"]:
                continue
            if any(s.strip() in subjects[k] for s in t["subjects"]):
                continue
            if t["availability"] is not None and not any((v["date"], v["period"]) == k for v in t["availability"]):
                continue
            if any((v["date"], v["period"]) == k for v in t["exclusions"]):
                continue
            ei = len(edges)
            w = d["settings"]["hallwayWeight" if kind == "hallway" else "classroomWeight"]
            edges.append((si, ti, w))
            by_slot[si].append(ei)
            by_time[ti, k].append(ei)
            by_teacher[ti].append(ei)
    normal = [ti for ti in range(len(teachers)) if ti not in special]
    ne, nn = len(edges), len(normal)
    score_col = {ti: ne + i for i, ti in enumerate(normal)}
    abs_start, total_col = ne + nn, ne + 2 * nn
    min_col, max_col = total_col + 1, total_col + 2
    nv = total_col + 3
    rr, cc, vv, low, high = [], [], [], [], []

    def row(entries, lo, hi):
        ri = len(low)
        for col, value in entries:
            rr.append(ri); cc.append(col); vv.append(value)
        low.append(lo); high.append(hi)

    for si in range(len(slots)):
        row([(ei, 1) for ei in by_slot[si]], 1, 1)
    for (ti, _), eis in by_time.items():
        # Synthetic designated teachers check exactly their eligible periods.
        row([(ei, 1) for ei in eis], 1 if ti in special else 0, 1)
    for i, ti in enumerate(normal):
        row([(score_col[ti], 1)] + [(ei, -edges[ei][2]) for ei in by_teacher[ti]], 0, 0)
        if fairness == "absolute":
            row([(score_col[ti], nn), (total_col, -1), (abs_start + i, -1)], -np.inf, 0)
            row([(score_col[ti], -nn), (total_col, 1), (abs_start + i, -1)], -np.inf, 0)
        else:
            row([(score_col[ti], 1), (min_col, -1)], 0, np.inf)
            row([(score_col[ti], 1), (max_col, -1)], -np.inf, 0)
    row([(total_col, 1)] + [(col, -1) for col in score_col.values()], 0, 0)
    pref = np.zeros(nv)
    for ei, (si, ti, _) in enumerate(edges):
        if ti in special and slots[si][2] != "hallway":
            pref[ei] = 1
    integer = np.zeros(nv); integer[:ne] = 1
    upper = np.full(nv, np.inf); upper[:ne] = 1
    bounds = Bounds(np.zeros(nv), upper)

    def constraints():
        matrix = coo_matrix((vv, (rr, cc)), shape=(len(low), nv)).tocsc()
        return LinearConstraint(matrix, low, high)

    report = {"file": filename, "fairness": fairness, "teachers": len(teachers), "slots": len(slots), "binary_variables": ne, "designated_teachers": designated_count}
    report["prepare_seconds"] = round(time.perf_counter() - start, 3)
    if designated_count:
        now = time.perf_counter()
        first = milp(pref, integrality=integer, bounds=bounds, constraints=constraints(), options={"time_limit": 10, "mip_rel_gap": 0})
        report["preference_seconds"] = round(time.perf_counter() - now, 3)
        report["preference_status"] = first.message
        if first.status != 0:
            print(json.dumps(report), flush=True)
            return
        report["preference_misses"] = round(first.fun)
        row([(i, v) for i, v in enumerate(pref) if v], round(first.fun), round(first.fun))
    objective = np.zeros(nv)
    if fairness == "absolute":
        objective[abs_start:total_col] = 1
    else:
        objective[min_col] = -1
        objective[max_col] = 1
    now = time.perf_counter()
    cons = constraints()
    result = milp(objective, integrality=integer, bounds=bounds, constraints=cons, options={"time_limit": 10, "mip_rel_gap": 0})
    report["fairness_seconds"] = round(time.perf_counter() - now, 3)
    report["status"] = result.message
    report["gap"] = getattr(result, "mip_gap", None)
    if result.x is not None:
        assert np.max(np.abs(result.x[:ne] - np.round(result.x[:ne]))) < 1e-5
        lhs = cons.A @ result.x
        assert np.all(lhs >= np.asarray(low) - 1e-5) and np.all(lhs <= np.asarray(high) + 1e-5)
        points = [round(result.x[score_col[ti]], 6) for ti in normal]
        report["normal_score_min_max"] = [min(points), max(points)]
        mean = sum(points) / len(points)
        report["absolute_deviation_sum"] = sum(abs(p - mean) for p in points)
        report["model_validation"] = "passed"
    report["total_seconds"] = round(time.perf_counter() - start, 3)
    print(json.dumps(report), flush=True)


fairness = "range" if "--range" in sys.argv else "absolute"
print(json.dumps({"scipy": scipy.__version__, "backend": "native HiGHS via scipy.optimize.milp", "fairness": fairness, "count_caps": False}), flush=True)
benchmark("samples/example-exam.json", designated_count=2, fairness=fairness)
if fairness == "absolute":
    benchmark("samples/large-exam.json", fairness=fairness)
benchmark("samples/large-exam.json", add_halls=4, designated_count=4, fairness=fairness)
