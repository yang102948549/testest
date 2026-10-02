import { _electron as electron } from "playwright-core";
import electronPath from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { domainRuntime } from "./domain-runtime.mjs";
const { slotsFor, forbidden, key } = await domainRuntime();
const root = process.cwd(),
  artifacts = path.join(root, "test-artifacts");
await mkdir(artifacts, { recursive: true });
const userData = path.join(artifacts, `workflow-profile-${Date.now()}`);
const launch = () =>
  electron.launch({
    executablePath: process.env.PROCTOR_EXE || electronPath,
    args: process.env.PROCTOR_EXE ? [] : ["."],
    cwd: root,
    env: {
      ...process.env,
      PROCTOR_TEST_DATA: userData,
      PROCTOR_TEST_HIDDEN: "1",
    },
    timeout: 40000,
  });
let app, page;
const errors = [],
  network = [];
const nav = async (name) => {
  const group =
    {
      "교사 기본 설정": "교사 설정",
      "감독 가능 시간": "교사 설정",
      "제외 교시 설정": "교사 설정",
      "배정 세부 설정": "시험 설정",
      "감독 배정·조정": "배정표",
      "고사 기록": "기록",
      "시험일정·고사실": "시험 설정",
    }[name] || name;
  await page
    .locator("nav")
    .getByRole("button", { name: group, exact: true })
    .click();
  // Leaving with unsaved edits asks first; the workflow keeps them.
  const keep = page.getByRole("button", { name: "저장하고 이동", exact: true });
  if (await keep.isVisible()) {
    await keep.click();
    await page
      .locator("nav")
      .getByRole("button", { name: group, exact: true })
      .waitFor();
  }
  const tab = {
    "교사 기본 설정": "교사 명단",
    "감독 가능 시간": "특별교사 감독 설정",
    "제외 교시 설정": "감독불가 교사 설정",
    "배정 세부 설정": "감독 방식·배정 기준",
  }[name];
  if (tab) await page.getByRole("tab", { name: tab, exact: true }).click();
};
const saved = async () => {
  // Edits are drafts until saved explicitly (Ctrl+S).
  await page.keyboard.press("Control+s");
  await page.waitForFunction(
    () =>
      document.querySelector(".save-state")?.textContent?.trim() === "저장됨",
  );
};
const doc = () =>
  page.evaluate(async () => (await window.desktop.current()).document);
const shot = async (name) => {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document
      .querySelectorAll(".workspace, main, .proctor-scroll")
      .forEach((el) => (el.scrollTop = 0));
  });
  await page.screenshot({ path: path.join(artifacts, name), fullPage: false });
};
const confirm = async () =>
  page.getByRole("button", { name: "확인", exact: true }).click();
const next = async () =>
  page.getByRole("button", { name: /저장 및 다음 단계/ }).click();
const apply = async () => {
  await page
    .getByRole("button", { name: "변경사항 반영", exact: true })
    .click();
  await saved();
};
try {
  app = await launch();
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) network.push(r.url());
  });
  await saved();
  const prefs = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  assert(prefs.contextIsolation && prefs.sandbox && !prefs.nodeIntegration);
  await page
    .getByRole("textbox", { name: "고사 이름", exact: true })
    .fill("원본 방식 검증 고사");
  await page
    .getByRole("button", { name: "1학년 고사실 추가", exact: true })
    .click();
  await page
    .getByRole("button", { name: "1학년 고사실 추가", exact: true })
    .click();
  await page.getByRole("button", { name: "시험일 추가", exact: true }).click();
  // Calendar picker: move to October 2026 and pick the 19th.
  for (let i = 0; i < 36; i++) {
    if (await page.getByRole("button", { name: "2026-10-19", exact: true }).count()) break;
    const month = await page.locator(".calendar-head b").textContent();
    const later = month.localeCompare("2026년 10월", "ko", { numeric: true }) > 0;
    await page.getByRole("button", { name: later ? "이전 달" : "다음 달", exact: true }).click();
  }
  await page.getByRole("button", { name: "2026-10-19", exact: true }).click();
  await page.getByRole("button", { name: "1일 추가", exact: true }).click();
  // The detail button shows on hover, like the rest of the cell tools.
  const cell = () => ({
    click: async () => {
      await page
        .getByLabel("2026-10-19 1교시 1학년 과목", { exact: true })
        .hover();
      await page
        .getByRole("button", {
          name: "2026-10-19 1교시 1학년 과목 설정",
          exact: true,
        })
        .click();
    },
  });
  await cell().click();
  await page.getByLabel("과목명 1", { exact: true }).fill("수학");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "1-2", exact: true })
    .click();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await saved();
  assert.equal((await doc()).lessons.length, 0);
  await cell().click();
  await page.getByLabel("과목명 1", { exact: true }).fill("수학");
  await page.getByRole("button", { name: "적용완료", exact: true }).click();
  await saved();
  assert.equal((await doc()).lessons[0].roomIds.length, 2);
  await next();
  const roster = path.join(artifacts, "smoke-teachers.csv");
  await writeFile(roster, "교사명,담당과목\n가교사,체육\n나교사,음악\n다교사,미술");
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, roster);
  await page
    .getByRole("button", { name: "명단 가져오기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "엑셀·CSV 파일 선택", exact: true })
    .click();
  await page.getByRole("button", { name: "3명 추가", exact: true }).click();
  await page
    .getByRole("button", { name: "가교사 담당과목 선택", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "국어", exact: true })
    .click();
  await page.getByRole("button", { name: "선택 완료", exact: true }).click();
  await saved();
  assert.deepEqual((await doc()).teachers[0].subjects, ["체육", "국어"]);
  await page
    .getByRole("button", { name: "가교사 담임 학급 선택", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "1-1", exact: true })
    .click();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await saved();
  assert.equal((await doc()).teachers[0].homeroom, null);
  await page
    .getByRole("button", { name: "가교사 담임 학급 선택", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "1-2", exact: true })
    .click();
  await page.getByRole("button", { name: "선택 완료", exact: true }).click();
  await next();
  await page.getByText("특별교사(지정배치·시간강사·비교과·순회·복도 전담)가 없습니다.", { exact: false }).waitFor();
  await next();
  await page
    .getByLabel("다교사 2026-10-19 1교시 불가", { exact: true })
    .check();
  await page
    .getByLabel("나교사 2026-10-19 2교시 불가", { exact: true })
    .check();
  await page.getByLabel("나교사 불가 사유", { exact: true }).fill("출장");
  await nav("배정 세부 설정");
  await page.getByLabel("교실 감독 가중치", { exact: true }).fill("140.75");
  await page.getByLabel("복도 감독 가중치", { exact: true }).fill("0.125");
  await page
    .getByRole("button", { name: "설정 저장 및 감독 배정 실행", exact: true })
    .click();
  await page.locator(".proctor-matrix").waitFor({ timeout: 40000 });
  await saved();
  const initial = await doc();
  assert.equal(initial.settings.classroomWeight, 140.75);
  assert.equal(initial.settings.hallwayWeight, 0.125);
  assert.equal(initial.result.engine, "2.0.0-highs");
  assert.equal(initial.result.optimization.status, "optimal");
  assert.equal(initial.result.assignments.filter((x) => x.teacherId).length, 2);
  assert.equal(initial.teachers[1].exclusionReason, "출장");
  assert(
    !initial.teachers[1].availability.some(
      (x) => x.date === "2026-10-19" && x.period === 2,
    ),
  );
  await page
    .getByRole("button", {
      name: "가교사 2026-10-19 1교시 감독 선택",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "나교사 2026-10-19 1교시 감독 선택",
      exact: true,
    })
    .click();
  // A refused pair shows the reason and changes nothing.
  assert(
    (await page.locator(".selection-guide").textContent()).includes("담임"),
  );
  assert.equal(
    await page.getByRole("button", { name: "변경사항 반영", exact: true }).count(),
    0,
  );
  await page
    .getByRole("button", {
      name: "나교사 2026-10-19 1교시 감독 선택",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "고사실별 보기 · 미배정 확인", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "1-1 2026-10-19 1교시 감독 배정",
      exact: true,
    })
    .click();
  assert(await page.getByRole("radio", { name: /다교사/ }).isDisabled());
  await page.getByRole("button", { name: "배정 해제", exact: true }).click();
  assert.deepEqual(
    (await doc()).result.assignments,
    initial.result.assignments,
    "임시 조정은 파일을 바꾸면 안 됨",
  );
  await nav("교사 기본 설정");
  await nav("감독 배정·조정");
  assert(await page.getByText(/반영 전 변경/).isVisible());
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  await page
    .getByRole("dialog", { name: "반영하지 않은 배정 조정이 있습니다" })
    .waitFor();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await apply();
  assert.equal((await doc()).result.optimization, undefined, "수동 변경 후 최적성 표시는 해제되어야 함");
  assert.equal(
    (await doc()).result.assignments.filter((x) => x.teacherId).length,
    1,
  );
  await page
    .getByRole("button", { name: "고사실별 보기 · 미배정 확인", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "1-1 2026-10-19 1교시 감독 배정",
      exact: true,
    })
    .click();
  await page.getByRole("radio", { name: /가교사/ }).check();
  await page
    .getByRole("button", { name: "선택 교사 배정", exact: true })
    .click();
  await apply();
  assert.equal(
    (await doc()).result.assignments.filter((x) => x.teacherId).length,
    2,
  );
  await nav("고사 기록");
  await page.getByRole("button", { name: "예시 고사", exact: true }).click();
  await confirm();
  await saved();
  await shot("v11-01-schedule.png");
  await page
    .getByLabel("2026-10-19 1교시 1학년 과목", { exact: true })
    .hover();
  await page
    .getByRole("button", {
      name: "2026-10-19 1교시 1학년 과목 설정",
      exact: true,
    })
    .click();
  await shot("v11-02-subject-picker.png");
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await nav("교사 기본 설정");
  await shot("v11-03-teachers.png");
  await page
    .getByRole("button", { name: "김민서 담당과목 선택", exact: true })
    .click();
  await shot("v11-04-teacher-picker.png");
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await nav("감독 가능 시간");
  await shot("v11-05-availability.png");
  await nav("제외 교시 설정");
  await shot("v11-06-exclusions.png");
  await nav("감독 배정·조정");
  await page.getByRole("button", { name: "자동 배정", exact: true }).click();
  await page.locator(".proctor-matrix").waitFor({ timeout: 40000 });
  await saved();
  const example = await doc(),
    slots = slotsFor(example),
    bySlot = new Map(slots.map((s) => [s.id, s])),
    teachers = new Map(example.teachers.map((t) => [t.id, t]));
  let pair;
  for (const a of example.result.assignments) {
    for (const b of example.result.assignments) {
      if (!a.teacherId || !b.teacherId || a.teacherId === b.teacherId) continue;
      const sa = bySlot.get(a.slotId),
        sb = bySlot.get(b.slotId);
      if (
        key(sa) === key(sb) &&
        !forbidden(example, teachers.get(a.teacherId), sb).length &&
        !forbidden(example, teachers.get(b.teacherId), sa).length
      ) {
        pair = [a, b];
        break;
      }
    }
    if (pair) break;
  }
  assert(pair);
  const choose = async (a) => {
    const s = bySlot.get(a.slotId),
      t = teachers.get(a.teacherId);
    await page
      .getByRole("button", {
        name: `${t.name} ${s.date} ${s.period}교시 감독 선택`,
        exact: true,
      })
      .click();
  };
  await choose(pair[0]);
  await shot("v11-07-swap-targets.png");
  // The second click swaps right away; only 반영 persists it.
  await choose(pair[1]);
  assert.deepEqual(
    (await doc()).result.assignments,
    example.result.assignments,
  );
  await apply();
  assert.equal(
    (await doc()).result.assignments.find((x) => x.slotId === pair[0].slotId)
      .teacherId,
    pair[1].teacherId,
  );
  await shot("v11-08-assignment.png");
  // Excel export: whole-exam sheets + printable day sheet.
  const xlsxPath = path.join(artifacts, "v11-export.xlsx");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, xlsxPath);
  await page.getByRole("button", { name: "엑셀로 내보내기", exact: true }).click();
  await shot("v11-08b-export-dialog.png");
  await page.getByRole("button", { name: "엑셀 파일 저장", exact: true }).click();
  await page.getByText(/엑셀 파일로 내보냈습니다/).waitFor();
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(xlsxPath);
  assert.deepEqual(
    book.worksheets.map((w) => w.name),
    ["교사별 전체", "고사실별 전체", "10.19(월) 감독표", "10.20(화) 감독표", "10.21(수) 감독표"],
  );
  const exportPath = path.join(artifacts, "v11-roundtrip.json");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, exportPath);
  await page
    .getByRole("button", { name: "고사 파일 내보내기", exact: true })
    .click();
  await page.getByText("고사 파일을 내보냈습니다.", { exact: true }).waitFor();
  const exported = JSON.parse(await readFile(exportPath, "utf8"));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, exportPath);
  await page
    .getByRole("button", { name: "고사 파일 가져오기", exact: true })
    .click();
  await page.waitForFunction(
    async (id) => (await window.desktop.current()).document.id !== id,
    exported.id,
  );
  await saved();
  assert.deepEqual(
    (await doc()).result.assignments,
    exported.result.assignments,
  );
  const closed = app.waitForEvent("close", { timeout: 15000 });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  await closed;
  app = null;
  app = await launch();
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await saved();
  assert.equal((await doc()).title, exported.title);
  await nav("배정 세부 설정");
  await page
    .getByRole("checkbox", { name: "정/부감독 모드", exact: true })
    .check();
  await page
    .getByRole("heading", { name: "단독 감독 고사실 세부 설정" })
    .waitFor();
  await page
    .locator(".single-period")
    .first()
    .getByRole("button")
    .first()
    .click();
  await shot("v11-09-main-sub-settings.png");
  await page
    .getByRole("button", { name: "설정 저장 및 감독 배정 실행", exact: true })
    .click();
  await page
    .getByRole("button", { name: "자동 배정", exact: true })
    .waitFor({ timeout: 40000 });
  await saved();
  const ms = await doc();
  assert.equal(ms.settings.mode, "mainSub");
  assert(ms.result.assignments.some((a) => a.slotId.endsWith("/sub")));
  assert.equal(
    ms.result.issues.filter((i) => i.severity === "error").length,
    0,
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1060, 780),
  );
  await shot("v11-10-compact-window.png");
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "작은 창에서 전체 페이지가 가로로 넘치지 않아야 함",
  );
  await nav("고사 기록");
  await page.getByRole("button", { name: /대규모 예시 열기/ }).click();
  await confirm();
  await saved();
  await nav("감독 배정·조정");
  await page.getByRole("button", { name: "자동 배정", exact: true }).click();
  await nav("교사 기본 설정");
  await nav("감독 배정·조정");
  await page.getByRole("button", { name: /계산 취소/ }).click();
  await page
    .getByText("계산을 취소했습니다. 이전 결과를 유지합니다.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "자동 배정", exact: true }).click();
  const started = Date.now();
  await page.locator(".proctor-matrix").waitFor({ timeout: 60000 });
  await saved();
  const large = await doc();
  assert.equal(large.result.assignments.length, 800);
  assert.equal(
    large.result.issues.filter((x) => x.severity === "error").length,
    0,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  const report = {
    passed: true,
    version: JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version,
    executable: process.env.PROCTOR_EXE ? "packaged" : "development",
    largeElapsedMs: Date.now() - started,
    largeAssigned: large.result.assignments.filter((x) => x.teacherId).length,
    solver: large.result.engine,
    optimization: large.result.optimization,
    rendererErrors: errors,
    remoteRequests: network,
    verified: [
      "원본 교시×학년 과목 선택창",
      "교사 과목·학급 칩 선택",
      "가능 시간 카드",
      "제외 전체 표",
      "같은 교시 맞교환·불가 사유",
      "임시 조정과 명시적 반영",
      "페이지 이동 중 임시 조정 보존",
      "닫기 전 임시 조정 경고",
      "JSON 왕복·재시작",
      "정/부·단독실",
      "작은 창",
      "대규모 취소·배정",
    ],
  };
  await writeFile(
    path.join(
      artifacts,
      process.env.PROCTOR_EXE
        ? "v11-packaged-report.json"
        : "v11-smoke-report.json",
    ),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
