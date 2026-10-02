import loadHighs, { type Highs, type InitOptions } from "highs";
import { Assignment, ExamDocument, Result, fingerprint, key } from "./model";
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

export const ENGINE_VERSION = "2.0.0-highs";
let runtime: Promise<Highs> | undefined;
/** The Worker supplies a bundled WASM URL; Node tests use the package loader. */
export function initializeSolver(options?: InitOptions) {
  return (runtime ??= loadHighs(options).catch((error) => {
    runtime = undefined;
    throw error;
  }));
}
type Term = [number, number];
type Edge = {
  si: number;
  ti: number;
  points: number;
  designated: boolean;
  miss: number;
};
const phaseNames = [
  "지정배치",
  "빈자리 최소화",
  "자리 선호",
  "점수 격차",
  "평균 편차",
];
const dot = (terms: Term[], x: Float64Array) =>
  terms.reduce((n, [i, v]) => n + v * x[i], 0);

/** Lexicographic MILP. Counts are advisory only; never weaken forbidden(). */
export async function solve(
  d: ExamDocument,
  onProgress?: (n: number) => void,
  options: { timeLimitMs?: number } = {},
): Promise<Result> {
  const started = performance.now();
  let lastProgress = 0;
  const progress = (value: number) => {
    lastProgress = Math.max(lastProgress, value);
    onProgress?.(lastProgress);
  };
  const budget = Math.max(0, options.timeLimitMs ?? 10_000);
  const deadline = started + budget;
  const slots = slotsFor(d),
    subjects = subjectMap(d);
  const designated = d.teachers.map(isDesignated);
  const normal = d.teachers.flatMap((t, i) => (t.role === "normal" ? [i] : []));
  const scale =
    (d.settings.mode === "mainSub"
      ? 1
      : Math.max(d.settings.classroomWeight, d.settings.hallwayWeight)) || 1;
  const weights = slots.map((s) => weight(d, s) / scale);
  // Never silently discard a positive user weight below numerical resolution.
  if (weights.some((w) => w > 0 && w < 1e-8))
    throw new Error(
      "교실·복도 가중치의 비율 차이가 너무 큽니다. 두 값의 비율을 1억 배 이내로 조정해 주세요.",
    );
  const edges: Edge[] = [],
    bySlot = slots.map(() => [] as number[]);
  const byTeacher = d.teachers.map(() => [] as number[]);
  const byTime = new Map<string, number[]>();
  slots.forEach((s, si) =>
    d.teachers.forEach((t, ti) => {
      if (forbidden(d, t, s, subjects).length) return;
      const ei = edges.length;
      edges.push({
        si,
        ti,
        points: weights[si],
        designated: designated[ti],
        miss: designated[ti] ? placementCost(t, s) : 0,
      });
      bySlot[si].push(ei);
      byTeacher[ti].push(ei);
      const k = `${ti}/${key(s)}`;
      if (!byTime.has(k)) byTime.set(k, []);
      byTime.get(k)!.push(ei);
    }),
  );
  // Period matching supplies a valid incumbent even when optimization times out.
  const seedPlan = slots.map(() => -1),
    occupied = new Map<string, number>();
  const seedRank = (ei: number) => {
    const e = edges[ei];
    return (
      (Math.imul(e.ti + 1, 1103515245) ^
        Math.imul(e.si + 1, 12345) ^
        d.settings.seed) >>>
      0
    );
  };
  bySlot.forEach((list) =>
    list.sort(
      (a, b) =>
        Number(edges[b].designated) - Number(edges[a].designated) ||
        edges[a].miss - edges[b].miss ||
        seedRank(a) - seedRank(b),
    ),
  );
  function augment(si: number, seen: Set<number>): boolean {
    if (seen.has(si)) return false;
    seen.add(si);
    for (const ei of bySlot[si]) {
      const k = `${edges[ei].ti}/${key(slots[si])}`;
      const prior = occupied.get(k);
      if (prior === undefined || augment(prior, seen)) {
        occupied.set(k, si);
        seedPlan[si] = ei;
        return true;
      }
    }
    return false;
  }
  slots
    .map((_, i) => i)
    .sort((a, b) => bySlot[a].length - bySlot[b].length || a - b)
    .forEach((si) => augment(si, new Set()));
  const ne = edges.length,
    count = normal.length;
  const scoreCols = new Map(normal.map((ti, i) => [ti, ne + i]));
  const meanCol = ne + count,
    minCol = meanCol + 1,
    maxCol = meanCol + 2;
  const absStart = meanCol + 3,
    nc = absStart + count;
  const upperScore = new Set(slots.map(key)).size;
  if (!Number.isFinite(upperScore * scale * Math.max(1, count)))
    throw new Error(
      "가중치가 너무 커서 누적 점수를 계산할 수 없습니다. 가중치 크기를 줄여 주세요.",
    );
  const canonical = (plan: number[]) => {
    const x = new Float64Array(nc);
    for (const ei of plan)
      if (ei >= 0) {
        x[ei] = 1;
        const sc = scoreCols.get(edges[ei].ti);
        if (sc !== undefined) x[sc] += edges[ei].points;
      }
    const points = normal.map((ti) => x[scoreCols.get(ti)!]);
    x[meanCol] = points.reduce((a, b) => a + b, 0) / (count || 1);
    x[minCol] = points.length ? Math.min(...points) : 0;
    x[maxCol] = points.length ? Math.max(...points) : 0;
    points.forEach((p, i) => (x[absStart + i] = Math.abs(p - x[meanCol])));
    return x;
  };
  let incumbent = canonical(seedPlan);
  const objectives: Term[][] = [
    edges.flatMap((e, i): Term[] => (e.designated ? [[i, -1]] : [])),
    edges.map((_, i) => [i, -1]),
    edges.flatMap((e, i): Term[] => (e.miss ? [[i, e.miss]] : [])),
    [
      [maxCol, 1],
      [minCol, -1],
    ],
    normal.map((_, i) => [absStart + i, 1]),
  ];
  const required = d.teachers.reduce(
    (n, t) => n + new Set(requiredTimes(d, t, slots).map(key)).size,
    0,
  );
  const lowerBounds = [-required, -slots.length, 0, 0, 0];
  const completed: string[] = [];
  let stopReason: "time-limit" | "solver-limit" | undefined;
  let interruptedPhase: string | undefined;
  const starts = [0],
    indices: number[] = [],
    values: number[] = [],
    lo: number[] = [],
    hi: number[] = [];
  const row = (terms: Term[], lower: number, upper: number) => {
    for (const [i, v] of terms)
      if (v !== 0) {
        indices.push(i);
        values.push(v);
      }
    starts.push(indices.length);
    lo.push(lower);
    hi.push(upper);
  };
  bySlot.forEach((list) =>
    row(
      list.map((i) => [i, 1]),
      0,
      1,
    ),
  );
  byTime.forEach((list) =>
    row(
      list.map((i) => [i, 1]),
      0,
      1,
    ),
  );
  normal.forEach((ti, i) => {
    const sc = scoreCols.get(ti)!;
    row(
      [[sc, 1], ...byTeacher[ti].map((ei): Term => [ei, -edges[ei].points])],
      0,
      0,
    );
    row(
      [
        [sc, 1],
        [minCol, -1],
      ],
      0,
      Infinity,
    );
    row(
      [
        [sc, 1],
        [maxCol, -1],
      ],
      -Infinity,
      0,
    );
    row(
      [
        [sc, 1],
        [meanCol, -1],
        [absStart + i, -1],
      ],
      -Infinity,
      0,
    );
    row(
      [
        [sc, -1],
        [meanCol, 1],
        [absStart + i, -1],
      ],
      -Infinity,
      0,
    );
  });
  row(
    [
      [meanCol, count || 1],
      ...normal.map((ti): Term => [scoreCols.get(ti)!, -1]),
    ],
    0,
    0,
  );
  progress(5);
  const highs = await initializeSolver();
  const model = highs.createModel({
    numCols: nc,
    numRows: lo.length,
    colCost: new Float64Array(nc),
    colLower: new Float64Array(nc),
    colUpper: Array.from({ length: nc }, (_, i) => (i < ne ? 1 : upperScore)),
    rowLower: lo,
    rowUpper: hi,
    integrality: Array.from({ length: nc }, (_, i) => (i < ne ? 1 : 0)),
    matrix: {
      format: "csr",
      numRows: lo.length,
      numCols: nc,
      starts,
      indices,
      values,
    },
  });
  const fixed: { terms: Term[]; value: number; integer: boolean }[] = [];
  const epsilon = 1e-8;
  // Do not round a fractional relaxation into a schedule.
  const decode = (candidate: Float64Array) => {
    if (candidate.length !== nc) return undefined;
    const plan = slots.map(() => -1),
      busy = new Set<string>();
    for (let ei = 0; ei < ne; ei++) {
      const v = candidate[ei];
      if (
        !Number.isFinite(v) ||
        Math.abs(v - Math.round(v)) > 1e-6 ||
        v < -1e-6 ||
        v > 1 + 1e-6
      )
        return undefined;
      if (v < 0.5) continue;
      const { si, ti } = edges[ei],
        k = `${ti}/${key(slots[si])}`;
      if (plan[si] >= 0 || busy.has(k)) return undefined;
      plan[si] = ei;
      busy.add(k);
    }
    const x = canonical(plan);
    if (
      fixed.some(
        (f) =>
          Math.abs(dot(f.terms, x) - f.value) >
          (f.integer ? 1e-6 : epsilon * 4),
      )
    )
      return undefined;
    return x;
  };
  try {
    model.options.set({
      output_flag: false,
      random_seed: d.settings.seed,
      mip_rel_gap: 0,
      mip_abs_gap: 0,
      mip_feasibility_tolerance: 1e-8,
      primal_feasibility_tolerance: 1e-8,
      small_matrix_value: 1e-10,
    });
    for (let phase = 0; phase < objectives.length; phase++) {
      const terms = objectives[phase];
      interruptedPhase = phaseNames[phase];
      let value = dot(terms, incumbent);
      const trivial =
        !terms.length ||
        value === lowerBounds[phase] ||
        (phase >= 3 && count < 2);
      if (!trivial) {
        const remaining = deadline - performance.now();
        if (remaining <= 0) {
          stopReason = "time-limit";
          break;
        }
        const costs = new Float64Array(nc);
        terms.forEach(([i, v]) => (costs[i] = v));
        model.changeColsCost({ kind: "range", from: 0, to: nc - 1 }, costs);
        model.zeroAllClocks();
        model.options.set("time_limit", remaining / 1000);
        model.setSolution({ colValue: incumbent });
        const status = model.run({
          [highs.constants.callbackType.mipInterrupt]: (event) => {
            if (performance.now() >= deadline) event.interrupt();
            progress(
              Math.min(
                94,
                5 +
                  Math.floor(
                    (89 * (performance.now() - started)) / Math.max(1, budget),
                  ),
              ),
            );
          },
        });
        let accepted = false;
        if (
          model.info.get("primal_solution_status") ===
          highs.constants.solutionStatus.feasible
        ) {
          const next = decode(model.getSolution().colValue);
          if (next && dot(terms, next) <= value + epsilon) {
            incumbent = next;
            value = dot(terms, next);
            accepted = true;
          }
        }
        if (
          status.modelStatus !== highs.constants.modelStatus.optimal ||
          !accepted
        ) {
          stopReason =
            performance.now() >= deadline ? "time-limit" : "solver-limit";
          break;
        }
      }
      fixed.push({ terms, value, integer: phase < 3 });
      if (terms.length)
        model.addRow(value, value, {
          indices: terms.map((t) => t[0]),
          values: terms.map((t) => t[1]),
        });
      completed.push(phaseNames[phase]);
      progress(Math.round(5 + 18 * completed.length));
    }
  } finally {
    model.dispose();
  }
  const assignments: Assignment[] = slots.map((s) => ({
    slotId: s.id,
    teacherId: null,
  }));
  edges.forEach((e, i) => {
    if (incumbent[i] === 1) assignments[e.si].teacherId = d.teachers[e.ti].id;
  });
  const issues = validate(d, assignments);
  if (issues.some((i) => i.severity === "error"))
    throw new Error(
      "배정 결과 검증에 실패했습니다. 결과를 적용하지 않았습니다.",
    );
  progress(100);
  return {
    engine: ENGINE_VERSION,
    seed: d.settings.seed,
    fingerprint: fingerprint(d),
    assignments,
    issues,
    createdAt: new Date().toISOString(),
    optimization: {
      status: completed.length === phaseNames.length ? "optimal" : "feasible",
      completed,
      stoppedAt: stopReason ? interruptedPhase : undefined,
      reason: stopReason,
      elapsedMs: Math.round(performance.now() - started),
      scoreRange: (incumbent[maxCol] - incumbent[minCol]) * scale,
      absoluteDeviation: dot(objectives[4], incumbent) * scale,
    },
  };
}
