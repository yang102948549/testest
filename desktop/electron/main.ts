import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import { readFile, writeFile, rename } from "node:fs/promises";
import { Store } from "./storage";
import { documentSchema } from "../src/domain/model";
import { readGoogleSheet, readTeacherFile } from "./teacherFile";
import { fetchTimetable, searchSchools } from "./comcigan";
import { writeWorkbook } from "./exportXlsx";

if (process.env.PROCTOR_TEST_DATA)
  app.setPath("userData", process.env.PROCTOR_TEST_DATA);
app.setName("시험감독");
let window: BrowserWindow;
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on("second-instance", () => {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});
app.whenReady().then(() => {
  if (!gotLock) return;
  const store = new Store(path.join(app.getPath("userData"), "exams"));
  const handle = (channel: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("허용되지 않은 요청");
      return fn(...args);
    });
  handle("exam:current", () => store.current());
  handle("exam:list", () => store.list());
  handle("teachers:import", async () => {
    const selected = await dialog.showOpenDialog(window, {
      title: "교사 명단 가져오기",
      properties: ["openFile"],
      filters: [
        { name: "엑셀·Google Sheets 명단", extensions: ["xlsx", "csv", "tsv"] },
      ],
    });
    if (selected.canceled) return null;
    return readTeacherFile(selected.filePaths[0]);
  });
  handle("teachers:importLink", (link: unknown) => {
    if (typeof link !== "string" || link.length > 2000)
      throw new Error("Google Sheets 주소를 확인해 주세요.");
    return readGoogleSheet(link);
  });
  handle("timetable:schools", (name: unknown) => {
    if (typeof name !== "string") throw new Error("학교 이름을 확인해 주세요.");
    return searchSchools(name);
  });
  handle("timetable:comcigan", (code: unknown) => fetchTimetable(Number(code)));
  handle("timetable:files", async () => {
    const selected = await dialog.showOpenDialog(window, {
      title: "시간표 파일 선택",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "엑셀·CSV 시간표", extensions: ["xlsx", "csv", "tsv"] }],
    });
    if (selected.canceled) return null;
    const sheets = [];
    for (const file of selected.filePaths.slice(0, 20))
      for (const sheet of await readTeacherFile(file))
        sheets.push({ ...sheet, name: `${path.basename(file)} · ${sheet.name}` });
    return sheets;
  });
  handle("export:xlsx", async (title: unknown, sheets: unknown) => {
    const name = String(title ?? "감독 배정").replace(/[<>:"/\\|?*]/g, "_").slice(0, 80);
    const result = await dialog.showSaveDialog(window, {
      title: "엑셀로 내보내기",
      defaultPath: `${name} 감독배정.xlsx`,
      filters: [{ name: "엑셀", extensions: ["xlsx"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeWorkbook(sheets, result.filePath);
    return true;
  });
  handle("exam:load", (id: string) => store.load(id));
  handle("exam:save", (d: unknown) => store.save(d));
  handle("exam:export", async (input: unknown) => {
    const d = documentSchema.parse(input);
    const result = await dialog.showSaveDialog(window, {
      title: "고사 파일 내보내기",
      defaultPath: d.title.replace(/[<>:"/\\|?*]/g, "_") + ".json",
      filters: [{ name: "고사 JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(
      result.filePath + ".tmp",
      JSON.stringify(d, null, 2),
      "utf8",
    );
    await rename(result.filePath + ".tmp", result.filePath);
    return true;
  });
  handle("exam:import", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "고사 파일 가져오기",
      properties: ["openFile"],
      filters: [{ name: "고사 JSON", extensions: ["json"] }],
    });
    if (result.canceled) return null;
    const raw = await readFile(result.filePaths[0], "utf8");
    if (raw.length > 20_000_000)
      throw new Error("파일이 너무 큽니다. 최대 20 MB까지 지원합니다.");
    const d = documentSchema.parse(JSON.parse(raw));
    // Imported copies never silently overwrite a local exam with the same ID.
    d.id = crypto.randomUUID();
    d.updatedAt = new Date().toISOString();
    return d;
  });
  let closing = false;
  handle("app:close", () => {
    closing = true;
    window.close();
  });
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    icon: path.join(__dirname, "../build/icon.ico"),
    minWidth: 1040,
    minHeight: 700,
    show: process.env.PROCTOR_TEST_HIDDEN !== "1",
    backgroundColor: "#ffffff",
    title: "시험감독",
    autoHideMenuBar: true,
    webPreferences: {
      offscreen: process.env.PROCTOR_TEST_HIDDEN === "1",
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.on("close", (event) => {
    if (!closing) {
      event.preventDefault();
      window.webContents.send("app:closing");
    }
  });
  if (process.env.VITE_DEV_SERVER_URL)
    window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else window.loadFile(path.join(__dirname, "../dist/index.html"));
});
app.on("window-all-closed", () => app.quit());
