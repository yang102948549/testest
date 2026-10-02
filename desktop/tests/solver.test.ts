import { describe, expect, it } from "vitest";
import {
  blank,
  documentSchema,
  key,
  type Assignment,
  type ExamDocument,
} from "../src/domain/model";
import { solve } from "../src/domain/engine";
import {
  forbidden,
  isDesignated,
  placementCost,
  requiredTimes,
  slotsFor,
  validate,
  weight,
} from "../src/domain/rules";

function fixture(): ExamDocument {
  const d = blank();
  d.dates = [{ date: "2026-10-19", periods: 2 }];
  d.rooms = [
    { id: "a", name: "1-1", grade: 1, kind: "classroom" },
    { id: "h", name: "Hall", grade: 1, kind: "hallway" },
  ];
  d.lessons = [1, 2].map((period) => ({
    id: `l${period}`,
    date: d.dates[0].date,
    period,
    grade: 1,
    subject: "Math",
    roomIds: ["a"],
  }));
  d.teachers = ["A", "B", "C"].map((id) => ({
    id,
    name: id,
    subjects: [],
    homeroom: null,
    movingRooms: [],
    role: "normal",
    note: "",
    availability: null,
    exclusions: [],
  }));
  return d;
}

function metrics(d: ExamDocument, plan: Assignment[]) {
  const slots = slotsFor(d),
    used = new Set<string>();
  const scores = new Map(
    d.teachers.filter((t) => t.role === "normal").map((t) => [t.id, 0]),
  );
  let empty = 0,
    pref = 0,
    missing = 0;
  plan.forEach((a, i) => {
    if (!a.teacherId) {
      empty++;
      return;
    }
    const t = d.teachers.find((t) => t.id === a.teacherId)!;
    used.add(`${t.id}/${key(slots[i])}`);
    if (isDesignated(t)) pref += placementCost(t, slots[i]);
    if (scores.has(t.id))
      scores.set(t.id, scores.get(t.id)! + weight(d, slots[i]));
  });
  d.teachers.forEach((t) =>
    requiredTimes(d, t, slots).forEach((k) => {
      if (!used.has(`${t.id}/${key(k)}`)) missing++;
    }),
  );
  const ss = [...scores.values()],
    mean = ss.reduce((a, b) => a + b, 0) / (ss.length || 1);
  return [
    missing,
    empty,
    pref,
    ss.length ? Math.max(...ss) - Math.min(...ss) : 0,
    ss.reduce((n, s) => n + Math.abs(s - mean), 0),
  ];
}

function exhaustive(d: ExamDocument) {
  const slots = slotsFor(d),
    plan: Assignment[] = [],
    busy = new Set<string>();
  let best: number[] | undefined;
  const less = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++)
      if (Math.abs(a[i] - b[i]) > 1e-7) return a[i] < b[i];
    return false;
  };
  const walk = (i: number) => {
    if (i === slots.length) {
      const m = metrics(d, plan);
      if (!best || less(m, best)) best = m;
      return;
    }
    const s = slots[i];
    plan[i] = { slotId: s.id, teacherId: null };
    walk(i + 1);
    for (const t of d.teachers) {
      const k = `${t.id}/${key(s)}`;
      if (busy.has(k) || forbidden(d, t, s).length) continue;
      busy.add(k);
      plan[i] = { slotId: s.id, teacherId: t.id };
      walk(i + 1);
      busy.delete(k);
    }
  };
  walk(0);
  return best!;
}

describe("HiGHS weighted fairness", () => {
  it.each([
    [2, 1],
    [0.3, 0.17],
    [1, 3],
    [0, 1],
    [140.75, 0.125],
    [0, 0],
  ])(
    "matches exhaustive optimum with classroom=%s hallway=%s",
    async (classroomWeight, hallwayWeight) => {
      const d = fixture();
      Object.assign(d.settings, { classroomWeight, hallwayWeight });
      documentSchema.parse(d);
      const r = await solve(d);
      expect(r.optimization?.status).toBe("optimal");
      const wanted = exhaustive(d);
      metrics(d, r.assignments).forEach((v, i) =>
        expect(v).toBeCloseTo(wanted[i], 6),
      );
      expect(r.optimization?.scoreRange).toBeCloseTo(wanted[3], 6);
      expect(
        documentSchema.parse({ ...d, result: r }).result?.optimization,
      ).toEqual(r.optimization);
    },
    20000,
  );
  it("prioritizes designated periods and preference over normal scores", async () => {
    const d = fixture();
    d.teachers[0].role = "lecturer";
    d.teachers[0].availability = d.lessons.map(({ date, period }) => ({
      date,
      period,
    }));
    d.settings.hallwayWeight = 7.25;
    d.settings.classroomWeight = 0.15;
    const r = await solve(d);
    const wanted = exhaustive(d);
    metrics(d, r.assignments).forEach((v, i) =>
      expect(v).toBeCloseTo(wanted[i], 6),
    );
    expect(metrics(d, r.assignments).slice(0, 3)).toEqual([0, 0, 0]);
  });
  it("reports impossible designated duties without violating exclusions or double booking", async () => {
    const d = fixture();
    d.teachers.forEach((t) => {
      t.role = "hallway";
      t.availability = [{ date: d.dates[0].date, period: 1 }];
    });
    d.teachers[0].exclusions = [
      { date: d.dates[0].date, period: 1, reason: "Trip" },
    ];
    const r = await solve(d);
    expect(r.optimization?.status).toBe("optimal");
    expect(metrics(d, r.assignments)).toEqual(exhaustive(d));
    expect(
      validate(d, r.assignments).filter((i) => i.severity === "error"),
    ).toEqual([]);
  });
  it("returns a valid incumbent with unproven status when budget expires", async () => {
    const d = fixture();
    const r = await solve(d, undefined, { timeLimitMs: 0 });
    expect(r.optimization).toMatchObject({
      status: "feasible",
      reason: "time-limit",
    });
    expect(r.assignments.every((a) => a.teacherId)).toBe(true);
    expect(
      validate(d, r.assignments).filter((i) => i.severity === "error"),
    ).toEqual([]);
  });
  it("preserves relative weights at very small and large scales", async () => {
    const reference = fixture();
    reference.settings.classroomWeight = 3.5;
    reference.settings.hallwayWeight = 0.75;
    const base = await solve(reference);
    for (const factor of [1e-5, 1000]) {
      const d = structuredClone(reference);
      d.settings.classroomWeight *= factor;
      d.settings.hallwayWeight *= factor;
      const r = await solve(d);
      expect(r.optimization?.status).toBe("optimal");
      expect(r.optimization!.scoreRange / factor).toBeCloseTo(
        base.optimization!.scoreRange,
        6,
      );
      expect(r.optimization!.absoluteDeviation / factor).toBeCloseTo(
        base.optimization!.absoluteDeviation,
        6,
      );
    }
    for (const value of [-1, Infinity, NaN]) {
      reference.settings.classroomWeight = value;
      expect(documentSchema.safeParse(reference).success).toBe(false);
    }
  });
  it("fixes the previous multi-period counterexample", async () => {
    const d = fixture();
    d.dates[0].periods = 3;
    d.rooms.splice(1, 0, { id: "b", name: "1-2", grade: 1, kind: "classroom" });
    d.lessons = [1, 2, 3].map((period) => ({
      ...d.lessons[0],
      id: `l${period}`,
      period,
      roomIds: ["a", "b"],
    }));
    d.teachers.push({ ...d.teachers[2], id: "D", name: "D" });
    d.teachers[0].movingRooms = ["a"];
    d.teachers[0].availability = [1, 2].map((period) => ({
      date: d.dates[0].date,
      period,
    }));
    d.teachers[2].movingRooms = ["b"];
    d.teachers[2].availability = [{ date: d.dates[0].date, period: 3 }];
    d.teachers[3].movingRooms = ["b"];
    const r = await solve(d);
    expect(r.optimization?.status).toBe("optimal");
    const wanted = exhaustive(d);
    metrics(d, r.assignments).forEach((v, i) =>
      expect(v).toBeCloseTo(wanted[i], 6),
    );
    expect(r.optimization?.scoreRange).toBe(3);
  }, 20000);
  it("keeps homeroom and forbidden-room restrictions in both modes", async () => {
    for (const mode of ["general", "mainSub"] as const) {
      const d = fixture();
      d.settings.mode = mode;
      d.teachers[0].homeroom = "a";
      d.teachers[1].movingRooms = ["a"];
      d.teachers[2].role = "excluded";
      const r = await solve(d);
      expect(
        r.assignments
          .filter((a) => a.slotId.includes("/a/"))
          .every((a) => a.teacherId === null),
      ).toBe(true);
      expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    }
  });
});
