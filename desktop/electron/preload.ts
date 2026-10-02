import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("desktop", {
  licenseStatus: () => ipcRenderer.invoke("license:status"),
  activateLicense: (token: string) => ipcRenderer.invoke("license:activate", token),
  current: () => ipcRenderer.invoke("exam:current"),
  list: () => ipcRenderer.invoke("exam:list"),
  importTeachers: () => ipcRenderer.invoke("teachers:import"),
  importTeachersFromLink: (link: string) =>
    ipcRenderer.invoke("teachers:importLink", link),
  searchSchools: (name: string) => ipcRenderer.invoke("timetable:schools", name),
  fetchComcigan: (code: number) => ipcRenderer.invoke("timetable:comcigan", code),
  importTimetableFiles: () => ipcRenderer.invoke("timetable:files"),
  exportXlsx: (title: string, sheets: unknown) =>
    ipcRenderer.invoke("export:xlsx", title, sheets),
  load: (id: string) => ipcRenderer.invoke("exam:load", id),
  save: (d: unknown) => ipcRenderer.invoke("exam:save", d),
  importFile: () => ipcRenderer.invoke("exam:import"),
  exportFile: (d: unknown) => ipcRenderer.invoke("exam:export", d),
  close: () => ipcRenderer.invoke("app:close"),
  onClosing: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("app:closing", listener);
    return () => ipcRenderer.removeListener("app:closing", listener);
  },
});
