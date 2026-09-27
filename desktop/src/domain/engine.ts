import {
  Assignment,
  ExamDocument,
  Result,
  Slot,
  Teacher,
  fingerprint,
  key,
} from "./model";
import {
  forbidden,
  isDesignated,
  placementCost,
  requiredTimes,
  slotsFor,
  subjectMap,
  validate,
  weight,
} from "./rules";
export const ENGINE_VERSION = "1.0.1";
const less = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
};
function random(seed: number) {
  let a = seed | 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function solve(
  d: ExamDocument,
  onProgress?: (n: number) => void,
): Result {
  const slots = slotsFor(d),
    subjects = subjectMap(d),
    teachers = d.teachers;
  const eligible = slots.map((s) =>
    teachers
      .map((t, i) => (!forbidden(d, t, s, subjects).length ? i : -1))
      .filter((i) => i >= 0),
  );
  const req = teachers.map((t) => new Set(requiredTimes(d, t, slots).map(key)));
  const designated = teachers.map(isDesignated);
  const runs = slots.length > 500 ? 4 : 12;
  let best: number[] | undefined, bestMetric: number[] | undefined;
  const toAssignments = (a: number[]): Assignment[] =>
    slots.map((s, i) => ({
      slotId: s.id,
      teacherId: a[i] < 0 ? null : teachers[a[i]].id,
    }));
  const metric = (a: number[]) => {
    let missing = 0,
      empty = 0,
      over = 0,
      repetition = 0,
      dailyPenalty = 0,
      consecutive = 0,
      placementMiss = 0,
      rolePenalty = 0;
    const lists = teachers.map(() => [] as Slot[]);
    a.forEach((t, i) => {
      if (t < 0) empty++;
      else lists[t].push(slots[i]);
    });
    const scores: number[] = [];
    lists.forEach((ss, ti) => {
      const times = new Set(ss.map(key));
      for (const k of req[ti]) if (!times.has(k)) missing++;
      const rooms = new Map<string, number>();
      const days = new Map<string, { hall: number; cls: number }>();
      for (const s of ss) {
        rooms.set(s.roomId, (rooms.get(s.roomId) ?? 0) + 1);
        const day = days.get(s.date) ?? { hall: 0, cls: 0 };
        s.kind === "hallway" ? day.hall++ : day.cls++;
        days.set(s.date, day);
        if (times.has(`${s.date}/${s.period - 1}`)) consecutive++;
        // A designated teacher's seat preference outranks workload balance.
        if (designated[ti]) placementMiss += placementCost(teachers[ti], s);
        else rolePenalty += placementCost(teachers[ti], s);
      }
      for (const n of rooms.values()) repetition += (n * (n - 1)) / 2;
      for (const v of days.values()) {
        dailyPenalty += (v.hall + v.cls) ** 2;
        if (d.settings.mode === "general" && !designated[ti]) {
          over += Math.max(0, v.hall - d.settings.maxHallway);
          if (!d.settings.allowThird && !v.hall) over += Math.max(0, v.cls - 2);
        }
      }
      if (d.settings.mode === "general" && !designated[ti])
        over += Math.max(
          0,
          ss.filter((s) => s.kind !== "hallway").length -
            d.settings.maxClassroom,
        );
      if (teachers[ti].role === "normal")
        scores.push(ss.reduce((n, s) => n + weight(d, s), 0));
    });
    const mean = scores.reduce((a, b) => a + b, 0) / (scores.length || 1),
      variance = scores.reduce((n, x) => n + (x - mean) ** 2, 0);
    return [
      missing,
      empty,
      over,
      placementMiss,
      variance,
      dailyPenalty,
      rolePenalty,
      repetition,
      consecutive,
    ];
  };
  for (let run = 0; run < runs; run++) {
    const rng = random(d.settings.seed + run * 7919),
      a = slots.map(() => -1),
      lists = teachers.map(() => new Set<number>());
    const set = (si: number, ti: number) => {
      const old = a[si];
      if (old >= 0) lists[old].delete(si);
      a[si] = ti;
      if (ti >= 0) lists[ti].add(si);
    };
    const limitOK = (ti: number, si: number) => {
      if (d.settings.mode === "mainSub") return true;
      const s = slots[si],
        ss = [...lists[ti]].map((i) => slots[i]);
      if (s.kind === "hallway")
        return (
          ss.filter((x) => x.date === s.date && x.kind === "hallway").length <
          d.settings.maxHallway
        );
      if (
        ss.filter((x) => x.kind !== "hallway").length >= d.settings.maxClassroom
      )
        return false;
      const today = ss.filter((x) => x.date === s.date);
      return (
        d.settings.allowThird ||
        today.some((x) => x.kind === "hallway") ||
        today.filter((x) => x.kind !== "hallway").length < 2
      );
    };
    const tie = slots.map(() => teachers.map(() => rng()));
    const ranking = (ti: number, si: number) => {
      const ss = [...lists[ti]].map((i) => slots[i]),
        s = slots[si],
        t = teachers[ti];
      const required =
        req[ti].has(key(s)) && !ss.some((x) => key(x) === key(s));
      return [
        required ? -1 : 0,
        limitOK(ti, si) ? 0 : 1,
        ss.reduce((n, x) => n + weight(d, x), 0),
        ss.filter((x) => x.date === s.date).length,
        placementCost(t, s),
        ss.filter((x) => x.roomId === s.roomId).length,
        tie[si][ti],
      ];
    };
    const order = slots
      .map((_, i) => i)
      .sort(
        (i, j) =>
          eligible[i].length - eligible[j].length ||
          key(slots[i]).localeCompare(key(slots[j])) ||
          i - j,
      );
    // Augmenting paths repair greedy choices within a period. Never drop an occupied slot.
    const place = (
      si: number,
      strict: boolean,
      visited: Set<number>,
      depth: number,
    ): boolean => {
      if (depth > Math.min(teachers.length, 50) || visited.has(si))
        return false;
      visited.add(si);
      const candidates = [...eligible[si]].sort((x, y) => {
        const rx = ranking(x, si),
          ry = ranking(y, si);
        return less(rx, ry) ? -1 : less(ry, rx) ? 1 : 0;
      });
      for (const ti of candidates) {
        const conflict = [...lists[ti]].find(
          (i) => key(slots[i]) === key(slots[si]),
        );
        if (conflict === undefined) {
          if (!strict || limitOK(ti, si)) {
            set(si, ti);
            return true;
          }
          continue;
        }
        if (visited.has(conflict)) continue;
        // Remove before checking aggregate limits; rollback every unsuccessful path.
        set(conflict, -1);
        if (!strict || limitOK(ti, si)) {
          set(si, ti);
          if (place(conflict, strict, visited, depth + 1)) return true;
          set(si, -1);
        }
        set(conflict, ti);
      }
      return false;
    };
    // Designated periods first, each on the seat the teacher prefers.
    teachers.forEach((t, ti) => {
      for (const k of req[ti]) {
        const free = order.filter(
          (si) =>
            a[si] < 0 && key(slots[si]) === k && eligible[si].includes(ti),
        );
        free.sort(
          (x, y) =>
            placementCost(t, slots[x]) - placementCost(t, slots[y]) ||
            tie[x][ti] - tie[y][ti],
        );
        if (free.length) set(free[0], ti);
      }
    });
    for (const strict of [true, false])
      for (const si of order) if (a[si] < 0) place(si, strict, new Set(), 0);
    let current = metric(a);
    // Deterministic bounded local repair: fill required periods and balance workload.
    const attempts =
      slots.length > 500
        ? 350
        : Math.min(1800, Math.max(250, slots.length * 18));
    for (let n = 0; n < attempts && slots.length; n++) {
      const si = Math.floor(rng() * slots.length),
        candidates = eligible[si];
      if (!candidates.length) continue;
      const ti = candidates[Math.floor(rng() * candidates.length)],
        old = a[si];
      if (ti === old) continue;
      const conflict = [...lists[ti]].find(
        (i) => key(slots[i]) === key(slots[si]),
      );
      if (
        conflict !== undefined &&
        (old < 0 || !eligible[conflict].includes(old))
      )
        continue;
      set(si, ti);
      if (conflict !== undefined) set(conflict, old);
      const m = metric(a);
      if (less(m, current)) current = m;
      else {
        if (conflict !== undefined) set(conflict, ti);
        set(si, old);
      }
    }
    if (!bestMetric || less(current, bestMetric)) {
      best = [...a];
      bestMetric = current;
    }
    onProgress?.(Math.round(((run + 1) / runs) * 100));
  }
  const assignments = toAssignments(best ?? slots.map(() => -1));
  const issues = validate(d, assignments);
  if (issues.some((x) => x.severity === "error"))
    throw new Error(
      "배정 결과 검증에 실패했습니다. 결과를 적용하지 않았습니다.",
    );
  return {
    engine: ENGINE_VERSION,
    seed: d.settings.seed,
    fingerprint: fingerprint(d),
    assignments,
    issues,
    createdAt: new Date().toISOString(),
  };
}
