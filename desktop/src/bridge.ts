import type { ExamDocument } from "./domain/model";
export type RecordEntry = {
  id: string;
  title: string;
  updatedAt: string;
  teachers: number;
  recovered: boolean;
  error: boolean;
};
export type Loaded = { document: ExamDocument; recovered: boolean };
declare global {
  interface Window {
    desktop?: {
      licenseStatus: () => Promise<import("../electron/license").LicenseStatus>;
      activateLicense: (token: string) => Promise<import("../electron/license").LicenseStatus>;
      current: () => Promise<Loaded | null>;
      list: () => Promise<RecordEntry[]>;
      importTeachers: () => Promise<
        import("./domain/teacherImport").ImportSheet[] | null
      >;
      searchSchools: (
        name: string,
      ) => Promise<import("./domain/timetable").ComciganSchool[]>;
      fetchComcigan: (
        code: number,
      ) => Promise<import("./domain/timetable").ComciganTimetable>;
      exportXlsx: (
        title: string,
        sheets: import("./domain/exportBook").XSheet[],
      ) => Promise<boolean>;
      importTimetableFiles: () => Promise<
        import("./domain/teacherImport").ImportSheet[] | null
      >;
      importTeachersFromLink: (
        link: string,
      ) => Promise<import("./domain/teacherImport").ImportSheet[]>;
      load: (id: string) => Promise<Loaded>;
      save: (d: ExamDocument) => Promise<string>;
      importFile: () => Promise<ExamDocument | null>;
      exportFile: (d: ExamDocument) => Promise<boolean>;
      close: () => Promise<void>;
      onClosing: (fn: () => void) => () => void;
    };
  }
}
export const desktop = window.desktop;
