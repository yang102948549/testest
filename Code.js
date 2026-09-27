/**
 * 시험감독 배정 프로그램
 */

const ss = SpreadsheetApp.getActiveSpreadsheet();
const teacherSheet = ss.getSheetByName('교사 정보');


// ===============================================================
// --- 메뉴 및 UI 호출 함수 ---
// ===============================================================

/**
 * 메뉴에 사이드바 실행 항목을 추가하고, 파일 오픈 시 자동으로 사이드바를 엽니다.
 */
function onOpen() {
  // 1. 메뉴 생성은 어떤 오류가 있더라도 가장 먼저 실행되도록 보장합니다.
  try {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('📌감독 배정') 
        .addItem('메뉴 열기', 'showSidebar')
        .addToUi();
  } catch (menuError) {
    Logger.log('메뉴 생성 중 오류 발생: ' + menuError.message);
  }
  
  // 2. 사본 생성 시 에러를 유발할 수 있는 복원 함수를 안전하게 호출합니다.
  try {
    _rehydratePropertiesFromSheet();
  } catch (rehydrateError) {
    // 사본 권한 문제나 시트 부재로 인한 에러를 무시하고 진행하여 메뉴가 안 뜨는 현상 방지
    Logger.log('속성 복원 중 오류 발생(사본/권한 등): ' + rehydrateError.message);
  }
}

/**
 * 사이드바 UI를 표시하는 함수
 */
function showSidebar() {
    const html = HtmlService.createHtmlOutputFromFile('SidebarUI')
        .setTitle('시험감독 배정 프로그램');
    SpreadsheetApp.getUi().showSidebar(html);
}


function showScheduleDialog() {
    const html = HtmlService.createHtmlOutputFromFile('ScheduleUI').setWidth(1200).setHeight(800);
    SpreadsheetApp.getUi().showModalDialog(html, '시험일정 및 고사실 설정');
}

function showCalendarDialog(teachers, examDates, periodCount) {
    const template = HtmlService.createTemplateFromFile('CalendarUI');
    template.teachers = JSON.stringify(teachers);
    template.examDates = JSON.stringify(examDates);
    template.periodCount = periodCount;
    const html = template.evaluate().setWidth(1500).setHeight(1000);
    SpreadsheetApp.getUi().showModalDialog(html, '감독 가능 날짜 선택');
}


/**
 * ✅ [수정] '제외 교사 설정' 다이얼로그를 엽니다.
 * UI가 기존 설정을 표시할 수 있도록, 필터링된 교사 '객체' 배열을 전달합니다.
 */
function showExclusionDialog() {
  const scheduleData = getSavedScheduleData();
  if (!scheduleData || !scheduleData.dates || scheduleData.dates.length === 0) {
    SpreadsheetApp.getUi().alert('저장된 시험 정보가 없습니다. 시험일정을 먼저 설정해주세요.');
    return;
  }

  const allTeachers = getTeacherProfiles();
  const exclusionCandidateTeachers = allTeachers.filter(teacher => !teacher.notesReason);

  // ✅ 저장된 timetableData 불러오기
  const savedTimetableData = PropertiesService.getDocumentProperties()
    .getProperty('savedTimetableData');
  const timetableData = savedTimetableData ? JSON.parse(savedTimetableData) : {};
  
  // 💡 서버에 기록된 설정 완료 여부 플래그 가져오기
  const hasSavedExclusions = PropertiesService.getDocumentProperties().getProperty('hasSavedExclusions') === 'true';

  const scriptData = '<script>'
    + 'var schedule = ' + JSON.stringify(scheduleData) + ';'
    + 'var teachers = ' + JSON.stringify(exclusionCandidateTeachers) + ';'
    + 'var timetableData = ' + JSON.stringify(timetableData) + ';'
    + 'var hasSavedExclusions = ' + hasSavedExclusions + ';' // 💡 HTML 전역 변수로 주입
    + '<\/script>';

  let htmlContent = HtmlService.createHtmlOutputFromFile('ExclusionUI').getContent();
  htmlContent = htmlContent.replace('</head>', scriptData + '</head>');

  const output = HtmlService.createHtmlOutput(htmlContent)
    .setWidth(1500)
    .setHeight(1000);

  SpreadsheetApp.getUi().showModalDialog(output, '제외 교사 설정');
}

function showProctorSettingsDialog() {
    const html = HtmlService.createHtmlOutputFromFile('SettingsUI').setWidth(600).setHeight(550);
    SpreadsheetApp.getUi().showModalDialog(html, '감독 배정 세부 설정');
}

function showDailySheetPrintDialog() {
    const teacherSheet = ss.getSheetByName('교사별 전체 시간표') || ss.getSheetByName('교사별 전체 시간표 (정부)');
    if (!teacherSheet) {
        SpreadsheetApp.getUi().alert('먼저 "감독 배정 실행"을 통해 시간표를 생성해야 합니다.');
        return;
    }
    const scheduleData = getSavedScheduleData();
    if (!scheduleData || !scheduleData.dates || scheduleData.dates.length === 0) {
        SpreadsheetApp.getUi().alert('저장된 시험 정보가 없습니다. 시험일정을 먼저 설정해주세요.');
        return;
    }
    const examDates = scheduleData.dates.map(dateStr => formatDateToYYYYMMDD(dateStr)).filter(Boolean);
    const template = HtmlService.createTemplateFromFile('PrintDialogUI');
    template.examDates = JSON.stringify(examDates);
    const html = template.evaluate().setWidth(800).setHeight(600);
    SpreadsheetApp.getUi().showModalDialog(html, '일자별 시간표 생성');
}

function showProctorSwapTableUI() {
    try {
        const assignments = getProctorAssignments();
        if (!assignments || assignments.length === 0) {
            SpreadsheetApp.getUi().alert('먼저 "감독 배정 실행"을 통해 시간표를 생성해야 합니다.');
            return;
        }
        let htmlFileName, dialogTitle;
        if (typeof assignments[0].isMain !== 'undefined') {
            htmlFileName = 'ProctorSwapTableUI_MainSub.html';
            dialogTitle = '감독 수동 배정 (정/부 감독)';
        } else {
            htmlFileName = 'ProctorSwapTableUI.html';
            dialogTitle = '감독 수동 배정';
        }
        const html = HtmlService.createHtmlOutputFromFile(htmlFileName).setWidth(2000).setHeight(1200);
        SpreadsheetApp.getUi().showModalDialog(html, dialogTitle);
    } catch (e) {
        SpreadsheetApp.getUi().alert('오류', '수동 배정 UI를 여는 중 오류가 발생했습니다: ' + e.message);
    }
}

// ===============================================================
// --- [UI 창 호출 함수 추가] ---
// ===============================================================

/**
 * [신규] 교사 정보 설정 창을 엽니다.
 */
function showTeacherDialog() {
    const html = HtmlService.createHtmlOutputFromFile('TeacherUI')
        .setWidth(1400)
        .setHeight(900);
    SpreadsheetApp.getUi().showModalDialog(html, '교사 기본 설정');
}


// ===============================================================
// --- [단계별 흐름 연결 함수 (Flow Control)] ---
// ===============================================================

/**
 * [연결 함수 1] 시험일정 데이터를 저장하고, '교사 정보 설정' 창을 엽니다.
 * (수정: 달력 창이 아닌 교사 정보 창을 호출)
 */
function saveScheduleAndShowTeacherSetup(scheduleData) {
  try {
    saveSchedule(scheduleData); // 1. 시험일정 저장
    showTeacherDialog();        // 2. 교사 정보 설정 창 열기
    return true;
  } catch(e) {
    throw new Error('시험일정 저장 또는 다음 단계 진행 중 오류 발생: ' + e.message);
  }
}

/**
 * [연결 함수 2 (신규)] 교사 정보 데이터를 저장하고, '감독 가능날짜 설정' 창을 엽니다.
 */
function saveTeacherInfoAndShowAvailability(teacherData) {
  try {
    saveTeacherProfiles(teacherData); // 1. 교사 정보 시트에 저장
    setupTeacherAvailabilityAndConfirm(); // 2. 감독가능날짜 설정 창 열기 준비
    return true;
  } catch(e) {
    throw new Error('교사 정보 저장 또는 다음 단계 진행 중 오류 발생: ' + e.message);
  }
}


/**
 * [연결 함수 4] 제외 교시 데이터를 저장하고, 성공하면 즉시 '감독 세부 설정' 창을 엽니다.
 */
function saveExclusionsAndShowSettings(allExclusionData) {
  try {
    saveExclusionData(allExclusionData);
    PropertiesService.getDocumentProperties().setProperty('hasSavedExclusions', 'true'); // 💡 수동 저장 완료 플래그 기록
    showProctorSettingsDialog();
    return true;
  } catch(e) {
    throw new Error('데이터 저장 또는 다음 창 열기 중 오류가 발생했습니다: ' + e.message);
  }
}


// ===============================================================
// --- [TeacherUI 데이터 저장 헬퍼 함수] ---
// ===============================================================



/**
 * [완전 교체] TeacherUI에서 넘겨받은 교사 배열을 '교사 정보' 시트에 완벽히 덮어씁니다.
 * 기존의 가능날짜, 제외교시 등은 이름을 기준으로 안전하게 백업 및 복원합니다.
 */
function saveTeacherProfiles(teacherData) {
  const sheet = ss.getSheetByName('교사 정보');
  if (!sheet) throw new Error("'교사 정보' 시트가 없습니다.");

  // 1. 필터 강제 해제 (덮어쓰기 에러 방지)
  if (sheet.getFilter()) {
    sheet.getFilter().remove();
  }

  // 2. 헤더 가져오기 및 인덱스 파악
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  const nameIdx = headers.indexOf('교사명');
  const subIdx = headers.indexOf('담당과목');
  const hrIdx = headers.indexOf('담임학급');
  const mcIdx = headers.indexOf('이동학급');
  const noteIdx = headers.indexOf('비고');
  const availIdx = headers.indexOf('가능날짜');
  const exclIdx = headers.indexOf('제외교시');
  const exclReasonIdx = headers.indexOf('제외사유');

  if (nameIdx === -1) throw new Error("'교사명' 열을 찾을 수 없습니다.");

  // 3. 기존 시트 데이터 백업 (가능날짜, 제외사유 등 보존용)
  const lastRow = sheet.getLastRow();
  const existingDataCache = {};

  if (lastRow > 1) {
    const sheetValues = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    sheetValues.forEach(row => {
      const name = String(row[nameIdx]).trim();
      if (name) {
        existingDataCache[name] = {
          availability: availIdx !== -1 ? row[availIdx] : '',
          exclusion: exclIdx !== -1 ? row[exclIdx] : '',
          exclusionReason: exclReasonIdx !== -1 ? row[exclReasonIdx] : ''
        };
      }
    });
    // 기존 데이터 완전히 지우기 (추가/삭제 시 찌꺼기 방지)
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }

  // 4. UI 데이터를 바탕으로 완전히 새로운 배열 구성
  const newRows = [];
  teacherData.forEach(t => {
    const tName = t.name ? t.name.trim() : "";
    if (!tName) return; // 이름이 비어있으면 건너뜀

    const row = new Array(lastCol).fill("");
    row[nameIdx] = tName;
    if (subIdx !== -1) row[subIdx] = Array.isArray(t.subjects) ? t.subjects.join(', ') : (t.subjects || "");
    if (hrIdx !== -1) row[hrIdx] = t.homeroom || "";
    if (mcIdx !== -1) row[mcIdx] = Array.isArray(t.movingClasses) ? t.movingClasses.join(', ') : (t.movingClasses || "");

    // 비고란 변수명 호환성 완벽 처리
    const noteVal = t.notesReason ? t.notesReason : (t.note ? t.note : "");
    if (noteIdx !== -1) row[noteIdx] = noteVal.trim();

    // 기존에 있던 교사면 백업해둔 가능날짜/제외사유 복구
    if (existingDataCache[tName]) {
      if (availIdx !== -1) row[availIdx] = existingDataCache[tName].availability;
      if (exclIdx !== -1) row[exclIdx] = existingDataCache[tName].exclusion;
      if (exclReasonIdx !== -1) row[exclReasonIdx] = existingDataCache[tName].exclusionReason;
    }

    newRows.push(row);
  });

  // 5. 시트에 일괄 쓰기
  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, lastCol).setValues(newRows);
  }

  SpreadsheetApp.flush();
}

/**
 * [VLOOKUP 방식 로드] 시트의 A열(교사명)에 있는 모든 명단을 불러오고,
 * 각 교사에 기록된 기존 정보(B~E열)를 매칭하여 UI로 보냅니다.
 */
function getTeacherSetupData() {
  const scheduleData = getSavedScheduleData();
  const sheet = ss.getSheetByName('교사 정보');
  if (!sheet) return { masterSubjects: [], teachers: [], gradeConfigs: {1:10, 2:10, 3:10} };

  const data = sheet.getDataRange().getValues();
  const headers = data.shift();

  // 1. 과목 마스터 추출 (ScheduleUI 기반)
  const uniqueSubjects = new Set();
  if (scheduleData && scheduleData.subjects) {
    Object.values(scheduleData.subjects).forEach(day => {
      Object.values(day).forEach(period => {
        Object.values(period).forEach(grade => {
          if (Array.isArray(grade)) {
            grade.forEach(sub => { if(sub.name) uniqueSubjects.add(sub.name.trim()); });
          }
        });
      });
    });
  }

  // 2. 시트의 '교사명' 기준으로 전체 리스트 생성
  const nameIdx = headers.indexOf('교사명');
  const subIdx = headers.indexOf('담당과목');
  const hrIdx = headers.indexOf('담임학급');
  const mcIdx = headers.indexOf('이동학급');
  const noteIdx = headers.indexOf('비고');

  const teachers = data.map((row, i) => {
    const name = row[nameIdx] ? row[nameIdx].toString().trim() : '';
    if (!name) return null; // 이름 없는 행 제외
    
    return {
      id: "t_" + i,
      name: name,
      subjects: row[subIdx] ? row[subIdx].toString().split(',').map(s => s.trim()).filter(Boolean) : [],
      homeroom: row[hrIdx] ? row[hrIdx].toString() : "",
      movingClasses: row[mcIdx] ? row[mcIdx].toString().split(',').map(s => s.trim()).filter(Boolean) : [],
      note: row[noteIdx] ? row[noteIdx].toString() : ""
    };
  }).filter(Boolean);

  return {
    masterSubjects: Array.from(uniqueSubjects),
    teachers: teachers,
    gradeConfigs: {
      1: (scheduleData.grade1Rooms || []).length || 10,
      2: (scheduleData.grade2Rooms || []).length || 10,
      3: (scheduleData.grade3Rooms || []).length || 10
    },
    gradeRooms: {
        1: scheduleData.grade1Rooms || [],
        2: scheduleData.grade2Rooms || [],
        3: scheduleData.grade3Rooms || []
      }
  };
}
// ===============================================================
// --- 데이터 저장, 로드, 초기화 함수 ---
// ===============================================================

/**
 * 구글 드라이브에 '시험 감독 기록 보관함' 폴더를 찾거나 생성하고 폴더 객체를 반환합니다.
 * @returns {DriveApp.Folder} 보관함 폴더 객체
 */
function getArchiveFolder() {
    const folderName = "고사 감독";
    const folders = DriveApp.getFoldersByName(folderName);
    
    if (folders.hasNext()) {
        // 폴더가 이미 있으면 해당 폴더를 반환
        return folders.next();
    } else {
        // 폴더가 없으면 새로 생성하여 반환
        return DriveApp.createFolder(folderName);
    }
}

/**
 * ✅ [수정] 'exclusion' 관련 로직을 제거하여 단순화합니다.
 */
function archiveCurrentSpreadsheet(fileName) {
    if (!fileName || fileName.trim() === "") {
        throw new Error("고사명이 입력되지 않았습니다.");
    }
    try {
        const scheduleDataToArchive = getSavedScheduleData();
        const settingsDataToArchive = getProctorSettings();

        const allConfigData = {
            schedule: scheduleDataToArchive,
            settings: settingsDataToArchive
        };
        
        const archiveFolder = getArchiveFolder();
        const newFile = DriveApp.getFileById(ss.getId()).makeCopy(fileName, archiveFolder);
        
        if (allConfigData.schedule || allConfigData.settings) {
            const newSpreadsheet = SpreadsheetApp.openById(newFile.getId());
            const configSheetName = '_CONFIG_DATA_';
            let configSheet = newSpreadsheet.getSheetByName(configSheetName);
            if (!configSheet) {
                configSheet = newSpreadsheet.insertSheet(configSheetName);
            }
            configSheet.getRange('A1').setValue(JSON.stringify(allConfigData));
            configSheet.hideSheet();
        }

        return {
            name: newFile.getName(),
            url: newFile.getUrl()
        };
    } catch (e) {
        throw new Error("파일을 복사하는 중 오류가 발생했습니다: " + e.message);
    }
}

/**
 * [내부 도우미 함수] 아카이브된 파일의 숨김 시트에서 모든 설정 정보를 읽어와
 * 현재 파일의 스크립트 속성(PropertiesService)을 복원(rehydrate)합니다.
 * 이 작업은 파일당 한 번만 실행되거나 수동 불러오기 직후에는 실행되지 않습니다.
 */
function _rehydratePropertiesFromSheet() {
    const properties = PropertiesService.getDocumentProperties();
    // 이미 복원 작업이 실행되었거나, 수동으로 불러오기를 한 직후라면 중복 실행 방지
    if (properties.getProperty('_PROPERTIES_HYDRATED_') === 'true') {
        return;
    }

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const configSheet = ss.getSheetByName('_CONFIG_DATA_');

        if (configSheet) {
            const dataFromSheet = configSheet.getRange('A1').getValue();
            if (dataFromSheet) {
                const allConfigData = JSON.parse(dataFromSheet);

                // 숨김 시트의 데이터를 각 속성에 맞게 저장
                if (allConfigData.schedule) {
                    properties.setProperty('savedScheduleData', JSON.stringify(allConfigData.schedule));
                }
                if (allConfigData.exclusion) {
                    saveExclusionData(allConfigData.exclusion);
                }
                if (allConfigData.settings) {
                    saveProctorSettings(allConfigData.settings);
                }
                
                // 복원 작업이 완료되었음을 표시
                properties.setProperty('_PROPERTIES_HYDRATED_', 'true');
            }
        }
    } catch (e) {
        Logger.log('숨김 시트에서 속성을 복원하는 중 오류 발생: ' + e.message);
    }
}


/**
 * [수정본] 선택한 아카이브 파일에서 '속성'과 '교사 정보 시트'의 내용을
 * 현재 스프레드시트로 가져와 덮어씁니다.
 *
 * @param {string} fileId 설정을 불러올 파일의 ID
 * @returns {string} 성공 메시지
 */
function loadSettingsFromArchivedFile(fileId) {
    if (!fileId) {
        throw new Error("파일 ID가 없습니다.");
    }

    try {
        const sourceSpreadsheet = SpreadsheetApp.openById(fileId);
        const currentSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();

        // --- 1. '교사 정보' 시트 데이터 복원 ---
        const sourceTeacherSheet = sourceSpreadsheet.getSheetByName('교사 정보');
        const targetTeacherSheet = currentSpreadsheet.getSheetByName('교사 정보');

        if (sourceTeacherSheet && targetTeacherSheet) {
            const sourceData = sourceTeacherSheet.getDataRange().getValues();
            targetTeacherSheet.getDataRange().clearContent();
            targetTeacherSheet.getRange(1, 1, sourceData.length, sourceData[0].length).setValues(sourceData);
        } else {
            Logger.log("원본 또는 현재 파일에서 '교사 정보' 시트를 찾을 수 없어 데이터 복사를 건너뜁니다.");
        }

        // --- 2. 앱 설정(Properties) 복원 ---
        const configSheet = sourceSpreadsheet.getSheetByName('_CONFIG_DATA_');
        if (configSheet) {
            const dataFromSheet = configSheet.getRange('A1').getValue();
            if (dataFromSheet) {
                const allConfigData = JSON.parse(dataFromSheet);
                const currentProperties = PropertiesService.getDocumentProperties();
                
                // 개별 속성을 덮어쓰거나, 없으면 삭제합니다.
                if (allConfigData.schedule) {
                    currentProperties.setProperty('savedScheduleData', JSON.stringify(allConfigData.schedule));
                } else {
                    currentProperties.deleteProperty('savedScheduleData');
                }

                if (allConfigData.settings) {
                    saveProctorSettings(allConfigData.settings);
                } else {
                    // 관련 설정값들을 개별적으로 삭제
                    currentProperties.deleteProperty('maxClassroom');
                    currentProperties.deleteProperty('maxHallway');
                    currentProperties.deleteProperty('allowThirdClassroomProctor');
                    currentProperties.deleteProperty('useMainSubProctoring');
                    currentProperties.deleteProperty('classroomWeight');
                    currentProperties.deleteProperty('hallwayWeight');
                }
                
                // 모든 로드가 끝났으므로, 자동 복원 방지 신호를 보냅니다.
                currentProperties.setProperty('_PROPERTIES_HYDRATED_', 'true');
            }
        }
        
        return `"${sourceSpreadsheet.getName()}" 파일의 '교사 정보'와 '시험 설정'을 성공적으로 불러왔습니다.`;

    } catch (e) {
        throw new Error("정보를 불러오는 중 오류가 발생했습니다: " + e.message);
    }
}


/**
 * 시험일정 데이터를 저장합니다. 
 * 단, 시험 날짜 자체에 변경이 있을 경우에만 '가능날짜', '제외교시', '제외사유' 열을 초기화합니다.
 * @param {object} data - ScheduleUI에서 전달된 시험일정 데이터
 */
function saveSchedule(data) {
    try {
        const properties = PropertiesService.getDocumentProperties();
        const oldDataString = properties.getProperty('savedScheduleData');
        let datesHaveChanged = false;

        // 1. 기존 데이터와 새 데이터의 '날짜' 배열을 비교합니다.
        if (oldDataString) {
            const oldData = JSON.parse(oldDataString);
            
            // 날짜 배열을 문자열로 변환하여 비교 (순서가 달라도 내용만 같으면 동일하게 취급)
            const oldDatesJSON = oldData.dates ? JSON.stringify(oldData.dates.sort()) : '[]';
            const newDatesJSON = data.dates ? JSON.stringify(data.dates.sort()) : '[]';

            if (oldDatesJSON !== newDatesJSON) {
                datesHaveChanged = true; // 날짜 배열에 변경이 있으면 true로 설정
            }
        } else {
            // 기존 데이터가 아예 없었으면 '변경'된 것으로 간주합니다.
            datesHaveChanged = true;
        }

        // 2. 새로운 시험일정 데이터를 항상 저장합니다.
        properties.setProperty('savedScheduleData', JSON.stringify(data));

        // 3. 날짜가 변경되었을 경우에만 관련 열을 초기화합니다.
        if (datesHaveChanged) {
            const teacherSheet = ss.getSheetByName('교사 정보');
            if (teacherSheet) {
                const headers = teacherSheet.getRange(1, 1, 1, teacherSheet.getLastColumn()).getValues()[0];
                const columnsToClear = ['가능날짜', '제외교시', '제외사유'];

                columnsToClear.forEach(columnName => {
                    const colIndex = headers.indexOf(columnName);
                    if (colIndex !== -1) {
                        const rangeToClear = teacherSheet.getRange(2, colIndex + 1, teacherSheet.getMaxRows() - 1, 1);
                        rangeToClear.clearContent();
                    }
                });
            }
        }
        
        return true;
    } catch (e) {
        throw new Error('데이터 저장 중 오류가 발생했습니다: ' + e.message);
    }
}


function getSavedScheduleData() {
    //_rehydratePropertiesFromSheet(); // 속성 복원 함수 호출
    const savedData = PropertiesService.getDocumentProperties().getProperty('savedScheduleData');
    return savedData ? JSON.parse(savedData) : null;
}

/**
 * ✅ [완전 교체] 제외교시와 제외사유 정보를 '교사 정보' 시트에 저장합니다.
 * - 필터 강제 해제 및 기존 기록 완전 삭제 후 새로 덮어쓰기 적용
 */

function saveExclusionData(allExclusionData) {
  try {
    const teacherSheet = ss.getSheetByName('교사 정보');

    // 1. 시트에 필터가 걸려 있으면 덮어쓰기 오류가 나므로 강제 해제
    if (teacherSheet.getFilter()) {
      teacherSheet.getFilter().remove();
    }

    const teacherDataRange = teacherSheet.getRange(1, 1, teacherSheet.getLastRow(), teacherSheet.getLastColumn());
    const teacherData = teacherDataRange.getValues();
    const headers = teacherData[0];

    const nameColIndex = headers.indexOf('교사명');
    const exclusionColIndex = headers.indexOf('제외교시');
    const reasonColIndex = headers.indexOf('제외사유');

    if (nameColIndex === -1 || exclusionColIndex === -1 || reasonColIndex === -1) {
      throw new Error("'교사 정보' 시트에서 '교사명', '제외교시', '제외사유' 열을 모두 찾을 수 없습니다.");
    }

    // 2. 기존 제외 정보 싹 밀어버리기 (체크 해제된 사람의 과거 데이터 삭제 목적)
    if (teacherSheet.getLastRow() > 1) {
      teacherSheet.getRange(2, exclusionColIndex + 1, teacherSheet.getLastRow() - 1, 1).clearContent();
      teacherSheet.getRange(2, reasonColIndex + 1, teacherSheet.getLastRow() - 1, 1).clearContent();
    }

    // 3. 교사별 행 번호 매핑
    const teacherRowMap = new Map();
    for (let i = 1; i < teacherData.length; i++) {
      const teacherName = teacherData[i][nameColIndex];
      if (teacherName) {
        teacherRowMap.set(teacherName.toString().trim(), i + 1);
      }
    }

    // 4. UI에서 넘어온 새로운 데이터만 정확하게 쓰기 (★조건문 수정)
    allExclusionData.forEach(data => {
      const rowIndex = teacherRowMap.get(data.teacherName.trim());
      // 💡 exclusionString이 빈 문자열("")이더라도 사유(reason)를 저장할 수 있도록 조건 수정
      if (rowIndex) {
        teacherSheet.getRange(rowIndex, exclusionColIndex + 1).setValue(data.exclusionString || "");
        teacherSheet.getRange(rowIndex, reasonColIndex + 1).setValue(data.reason || "");
      }
    });

    SpreadsheetApp.flush();
    return true;
  } catch (e) {
    throw new Error('제외 교시/사유 저장 중 오류가 발생했습니다: ' + e.message);
  }
}

/**
 * ✅ [완전 교체] 감독 가능 날짜 저장 함수
 * - 필터 강제 해제 및 기존 기록 완전 삭제 로직 동일 적용
 */
function saveAllAvailableDates(allData) {
  try {
    const data = JSON.parse(allData);
    const teacherSheet = ss.getSheetByName('교사 정보');
    
    if (teacherSheet.getFilter()) {
      teacherSheet.getFilter().remove();
    }

    const headers = teacherSheet.getDataRange().getValues()[0];
    const availableInfoColIndex = headers.indexOf('가능날짜');
    if (availableInfoColIndex === -1) {
      throw new Error("'교사 정보' 시트에서 '가능날짜' 열을 찾을 수 없습니다.");
    }
    
    // 기존 가능 날짜 정보 싹 밀어버리기
    if (teacherSheet.getLastRow() > 1) {
        teacherSheet.getRange(2, availableInfoColIndex + 1, teacherSheet.getLastRow() - 1, 1).clearContent();
    }

    // 새로운 값만 저장
    data.forEach(item => {
      if (item.selections && item.selections.trim() !== '') {
        teacherSheet.getRange(item.rowIndex, availableInfoColIndex + 1).setValue(item.selections);
      }
    });
    
    SpreadsheetApp.flush();
    return true;
  } catch (e) {
    throw new Error('교사 가능 날짜 저장 중 오류 발생: ' + e.message);
  }
}


function getProctorSettings() {
    //_rehydratePropertiesFromSheet(); // 속성 복원 함수 호출
    const userProperties = PropertiesService.getDocumentProperties();
    return {
        maxClassroom: parseInt(userProperties.getProperty('maxClassroom') || '6'),
        maxHallway: parseInt(userProperties.getProperty('maxHallway') || '1'),
        allowThirdClassroomProctor: userProperties.getProperty('allowThirdClassroomProctor') === 'true',
        useMainSubProctoring: userProperties.getProperty('useMainSubProctoring') === 'true',
        classroomWeight: parseFloat(userProperties.getProperty('classroomWeight') || '2'),
        hallwayWeight: parseFloat(userProperties.getProperty('hallwayWeight') || '1')
    };
}

/**
 * 감독 배정 세부 설정값을 저장합니다.
 * v2: 교실/복도 감독 가중치 설정 추가
 */
function saveProctorSettings(settings) {
    try {
        const userProperties = PropertiesService.getDocumentProperties();
        userProperties.setProperty('maxClassroom', settings.maxClassroom);
        userProperties.setProperty('maxHallway', settings.maxHallway);
        userProperties.setProperty('allowThirdClassroomProctor', settings.allowThirdClassroomProctor);
        userProperties.setProperty('useMainSubProctoring', settings.useMainSubProctoring);
        // ✅ 추가된 항목
        userProperties.setProperty('classroomWeight', settings.classroomWeight);
        userProperties.setProperty('hallwayWeight', settings.hallwayWeight);
        return true;
    } catch (e) {
        throw new Error('설정 저장 중 서버에서 오류가 발생했습니다.');
    }
}

function saveProctorAssignments(slots) {
    try {
        PropertiesService.getDocumentProperties().setProperty('currentProctorAssignments', JSON.stringify(slots));
        return true;
    } catch (e) {
        throw new Error('현재 감독 배정 정보 저장 중 오류가 발생했습니다: ' + e.message);
    }
}

function getProctorAssignments() {
    const savedAssignments = PropertiesService.getDocumentProperties().getProperty('currentProctorAssignments');
    return savedAssignments ? JSON.parse(savedAssignments) : [];
}

/**
 * ✅ [수정] '가능날짜', '제외교시', '제외사유' 열 데이터를 모두 초기화합니다.
 */
function resetTeacherAndExclusionSettings() {
    try {
        const teacherSheet = ss.getSheetByName('교사 정보');
        if (!teacherSheet) {
            return "'교사 정보' 시트를 찾을 수 없습니다.";
        }

        const headers = teacherSheet.getRange(1, 1, 1, teacherSheet.getLastColumn()).getValues()[0];
        const exclusionColIndex = headers.indexOf('제외교시');
        const reasonColIndex = headers.indexOf('제외사유');
        const availableColIndex = headers.indexOf('가능날짜');

        if (exclusionColIndex !== -1) {
            teacherSheet.getRange(2, exclusionColIndex + 1, teacherSheet.getMaxRows() - 1).clearContent();
        }
        if (reasonColIndex !== -1) {
            teacherSheet.getRange(2, reasonColIndex + 1, teacherSheet.getMaxRows() - 1).clearContent();
        }
        if (availableColIndex !== -1) {
            teacherSheet.getRange(2, availableColIndex + 1, teacherSheet.getMaxRows() - 1).clearContent();
        }
        
        return "'감독 가능 날짜', '제외 교시', '제외 사유' 정보가 초기화되었습니다.";
    } catch (e) {
        throw new Error("교사 설정 초기화 중 오류가 발생했습니다: " + e.message);
    }
}


/**
 * ✅ [수정] PropertiesService에 저장된 모든 설정값과 '교사 정보' 시트의
 * '비고', '가능날짜', '제외교시', '제외사유' 열 데이터를 모두 초기화합니다.
 */
function resetAllSettings() {
    try {
        // 1. 저장된 모든 앱 설정값(Properties)을 초기화합니다.
        PropertiesService.getDocumentProperties().deleteAllProperties();
        
        // 2. '교사 정보' 시트의 관련 열 데이터를 초기화합니다.
        const teacherSheet = ss.getSheetByName('교사 정보');
        if (teacherSheet) {
            const headers = teacherSheet.getRange(1, 1, 1, teacherSheet.getLastColumn()).getValues()[0];
            
            // 초기화할 열 이름 목록
            const columnsToClear = ['비고', '가능날짜', '제외교시', '제외사유'];
            
            columnsToClear.forEach(columnName => {
                const colIndex = headers.indexOf(columnName);
                if (colIndex !== -1) {
                    // 헤더(1행)를 제외한 2행부터 마지막 행까지 데이터 삭제
                    teacherSheet.getRange(2, colIndex + 1, teacherSheet.getMaxRows() - 1).clearContent();
                }
            });
        }

        return "저장된 모든 설정값과 교사 정보(비고, 가능날짜, 제외교시/사유)가 초기화되었습니다.";

    } catch (e) {
        throw new Error("전체 설정 초기화 중 오류가 발생했습니다: " + e.message);
    }
}


// ---------------------------------
// --- 일반 모드 로직 ---
// ---------------------------------


/**
 * 일반 감독 배정 실행 함수
 */
function executeProctorAssignmentLogic() {
  const ui = SpreadsheetApp.getUi();
  try {
    const scheduleData = getSavedScheduleData();
    const settings = getProctorSettings();
    if (!scheduleData) throw new Error("저장된 시험 정보가 없습니다.");

    const teachers = getTeacherProfiles();
    const examSubjectMap = createExamSubjectMap(scheduleData);
    const { proctoringSlots, allRooms } = createProctoringSlots(scheduleData, examSubjectMap);

    shuffleArray(proctoringSlots);
    proctoringSlots.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.period - b.period;
    });

    // ✅ 균등 대상(일반 교사) vs 역할 고정 교사 분리
    const isFixedRole = t => t.isSuperPriority || t.isHallwayOnly || t.isPriorityHallway || t.isRoaming;
    const equalityTeachers = teachers.filter(t => !isFixedRole(t));
    const fixedTeachers    = teachers.filter(t =>  isFixedRole(t));

    // [Helper] 슬롯 정렬 (복도/교실 선호 + 고사실 다양성)
    const sortSlotsByPreference = (slots, teacher) => {
      return slots.sort((a, b) => {
        // 1순위: 복도/교실 선호
        if (teacher.isPriorityHallway) {
          if (a.isHallway !== b.isHallway) return a.isHallway ? -1 : 1;
        } else {
          if (a.isHallway !== b.isHallway) return a.isHallway ? 1 : -1;
        }
        // 2순위: 이미 배정된 고사실은 뒤로 (다양성)
        const ra = getRoomAssignmentCount(teacher, a.room);
        const rb = getRoomAssignmentCount(teacher, b.room);
        if (ra !== rb) return ra - rb;
        return 0;
      });
    };

    // [Phase 0] 우선배치 (필수배치)
    const superPriorityTeachers = teachers.filter(t => t.isSuperPriority);
    superPriorityTeachers.forEach(teacher => {
      for (const date in teacher.availability) {
        if (date === 'all-unavailable') continue;
        teacher.availability[date].forEach(period => {
          if (teacher.assignments.some(a => a.date === date && a.period === period)) return;
          let availableSlots = proctoringSlots.filter(s => !s.assignedTeacher && s.date === date && s.period === period);
          sortSlotsByPreference(availableSlots, teacher);
          let validSlot = availableSlots.find(slot => isAssignable(teacher, slot, examSubjectMap, false, settings, true));
          if (validSlot) assignTeacherToSlot(teacher, validSlot, settings);
        });
      }
    });

    // [Phase 1] 부분 가능 교사 선배치 (하이브리드: 동적 평균과 설정 최대치 중 작은 값 적용)
    const validTeacherCount = teachers.filter(t => !t.availability['all-unavailable']).length;
    const avgAssignments = Math.ceil(proctoringSlots.length / (validTeacherCount || 1));

    const partiallyAvailableTeachers = teachers
      .filter(t => t.isPartiallyAvailable && !t.isSuperPriority)
      .sort((a, b) => a.totalProctorScore - b.totalProctorScore);

    partiallyAvailableTeachers.forEach(teacher => {
      // 절대 상한선과 평균 배정 횟수 중 '작은 값'을 상한선(cap)으로 결정
      const maxAllowed = teacher.isHallwayOnly ? settings.maxHallway : settings.maxClassroom;
      const cap = Math.min(avgAssignments, maxAllowed);
      
      let reachedCap = false;

      for (const date in teacher.availability) {
        if (date === 'all-unavailable' || reachedCap) continue;
        
        for (const period of teacher.availability[date]) {
          if (teacher.assignmentCount >= cap) {
            reachedCap = true;
            break; 
          }
          
          if (teacher.assignments.some(a => a.date === date && a.period === period)) continue;
          
          let availableSlots = proctoringSlots.filter(s =>
            !s.assignedTeacher && s.date === date && s.period === period &&
            isAssignable(teacher, s, examSubjectMap, false, settings, false)
          );
          
          sortSlotsByPreference(availableSlots, teacher);
          if (availableSlots.length > 0) {
            const validSlot = availableSlots.find(slot => isAssignable(teacher, slot, examSubjectMap, false, settings, false));
            if (validSlot) assignTeacherToSlot(teacher, validSlot, settings);
          }
        }
      }
    });

    // [Phase 2] 균등 배정 — 일반 교사(equalityTeachers)만 점수 기준 경쟁
    const unassignedSlots = proctoringSlots.filter(s => !s.assignedTeacher);
    unassignedSlots.forEach(slot => {
      let candidates = equalityTeachers.filter(t => isAssignable(t, slot, examSubjectMap, true, settings, false));
      if (candidates.length === 0) {
        candidates = equalityTeachers.filter(t => isAssignable(t, slot, examSubjectMap, false, settings, true));
      }
      if (candidates.length > 0) {
        candidates.sort((a, b) => calculateCandidateScore(a, slot, settings) - calculateCandidateScore(b, slot, settings));
        assignTeacherToSlot(candidates[0], slot, settings);
      }
    });

    // [Phase 3] 잔여 슬롯 fallback — 역할 교사(fixedTeachers) 투입 (미배정 최소화)
    const stillUnassigned = proctoringSlots.filter(s => !s.assignedTeacher);
    stillUnassigned.forEach(slot => {
      let candidates = fixedTeachers.filter(t => isAssignable(t, slot, examSubjectMap, true, settings, false));
      if (candidates.length === 0) {
        candidates = fixedTeachers.filter(t => isAssignable(t, slot, examSubjectMap, false, settings, true));
      }
      if (candidates.length > 0) {
        candidates.sort((a, b) => calculateCandidateScore(a, slot, settings) - calculateCandidateScore(b, slot, settings));
        assignTeacherToSlot(candidates[0], slot, settings);
      }
    });

    createResultSheets(proctoringSlots, teachers, scheduleData, Array.from(allRooms));
    saveProctorAssignments(proctoringSlots);

    const unassignedCount = proctoringSlots.filter(s => !s.assignedTeacher).length;
    if (unassignedCount > 0) return `감독 배정 완료 (미배정: ${unassignedCount}건)`;
    return "감독 배정이 성공적으로 완료되었습니다.";
  } catch (e) {
    throw new Error('감독 배정 중 오류 발생: ' + e.message);
  }
}

/**
 * [수정] 정/부 감독 배정 실행 함수 (동일 로직 적용)
 */
function executeMainSubProctorAssignmentLogic() {
    const ui = SpreadsheetApp.getUi();
    try {
        const scheduleData = getSavedScheduleData();
        const settings = getProctorSettings();
        if (!scheduleData) throw new Error("저장된 시험 정보가 없습니다.");

        const teachers = getTeacherProfiles();
        const examSubjectMap = createExamSubjectMap(scheduleData);
        const { proctoringSlots, allRooms } = createMainSubProctoringSlots(scheduleData, examSubjectMap);

        shuffleArray(proctoringSlots);
        proctoringSlots.sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.period - b.period; 
        });

        // [Helper] 슬롯 정렬 (부감독/정감독)
        const sortSlotsByPreference = (slots, teacher) => {
            return slots.sort((a, b) => {
                const preferSub = teacher.isHallwayOnly || teacher.isPriorityHallway || teacher.isRoaming;
                if (preferSub) {
                    if (a.isMain !== b.isMain) return a.isMain ? 1 : -1; // Sub 우선
                } else {
                    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1; // Main 우선
                }
                return 0;
            });
        };

        // [Phase 0] 우선배치
        const superPriorityTeachers = teachers.filter(t => t.isSuperPriority);
        superPriorityTeachers.forEach(teacher => {
            for (const date in teacher.availability) {
                if (date === 'all-unavailable') continue;
                teacher.availability[date].forEach(period => {
                    if (teacher.assignments.some(a => a.date === date && a.period === period)) return;
                    let availableSlots = proctoringSlots.filter(s => !s.assignedTeacher && s.date === date && s.period === period);
                    sortSlotsByPreference(availableSlots, teacher);
                    
                    let validSlot = availableSlots.find(s => isAssignableMainSub(teacher, s, examSubjectMap));
                    if (validSlot) assignTeacherToMainSubSlot(teacher, validSlot);
                });
            }
        });

        // [Phase 1] 부분 가능 교사 선배치 (하이브리드: 동적 평균과 설정 최대치 중 작은 값 적용)
    const validTeacherCount = teachers.filter(t => !t.availability['all-unavailable']).length;
    const avgAssignments = Math.ceil(proctoringSlots.length / (validTeacherCount || 1));

    const partiallyAvailableTeachers = teachers.filter(t => t.isPartiallyAvailable && !t.isSuperPriority);
    partiallyAvailableTeachers.sort((a, b) => a.totalProctorScore - b.totalProctorScore);

    partiallyAvailableTeachers.forEach(teacher => {
      // 절대 상한선과 평균 배정 횟수 중 '작은 값'을 상한선(cap)으로 결정
      const cap = Math.min(avgAssignments, settings.maxClassroom);
      let reachedCap = false;

      for (const date in teacher.availability) {
        if (date === 'all-unavailable' || reachedCap) continue;
        
        for (const period of teacher.availability[date]) {
          if (teacher.assignmentCount >= cap) {
            reachedCap = true;
            break;
          }

          if (teacher.assignments.some(a => a.date === date && a.period === period)) continue;
          
          let availableSlots = proctoringSlots.filter(s => !s.assignedTeacher && s.date === date && s.period === period);
          sortSlotsByPreference(availableSlots, teacher);

          let validSlot = availableSlots.find(s => isAssignableMainSub(teacher, s, examSubjectMap));
          if (validSlot) assignTeacherToMainSubSlot(teacher, validSlot);
        }
      }
    });

        // [Phase 2] 잔여 배정
        const unassignedSlots = proctoringSlots.filter(s => !s.assignedTeacher);
        unassignedSlots.forEach(slot => {
             let candidates = teachers.filter(t => isAssignableMainSub(t, slot, examSubjectMap));
             if (candidates.length > 0) {
                 candidates.sort((a, b) => calculateCandidateScore(a, slot, settings) - calculateCandidateScore(b, slot, settings));
                 assignTeacherToMainSubSlot(candidates[0], slot);
             }
        });

        createMainSubResultSheets(proctoringSlots, teachers, scheduleData, Array.from(allRooms));
        saveProctorAssignments(proctoringSlots);

        const unassignedCount = proctoringSlots.filter(s => !s.assignedTeacher).length;
        if (unassignedCount > 0) return `정/부 감독 배정 완료 (미배정: ${unassignedCount}건)`;
        return "정/부 감독 배정이 성공적으로 완료되었습니다.";

    } catch (e) {
        throw new Error('정/부 감독 배정 중 오류 발생: ' + e.message);
    }
}

// ✅ 2. 클라이언트에서 호출할 새로운 통합 실행 함수를 추가합니다.
/**
 * 설정을 확인하여 적절한 감독 배정 로직을 실행하고 결과 메시지를 반환합니다.
 * @returns {string} 감독 배정 결과 메시지
 */
function runAssignmentAndGetMessage() {
  try {
    const settings = getProctorSettings();
    if (settings.useMainSubProctoring) {
      return executeMainSubProctorAssignmentLogic();
    } else {
      return executeProctorAssignmentLogic();
    }
  } catch (e) {
    // 실행 중 발생한 오류를 클라이언트로 전파합니다.
    throw new Error('감독 배정 실행 중 오류 발생: ' + e.message);
  }
}


// ===============================================================
// --- 로직 헬퍼 및 유틸리티 함수 ---
// ===============================================================

/**
 * [신규] 배열 무작위 셔플 (Fisher-Yates Algorithm)
 * 고사실 배정 순서를 섞어 특정 교사가 앞번호 반에만 배정되는 패턴을 방지합니다.
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function isAllSelfStudyPeriod(scheduleData, date, period) {
    const formattedDate = formatDateToYYYYMMDD(date);
    const subjectsInPeriod = scheduleData.subjects[formattedDate]?.[`period${period}`];
    if (!subjectsInPeriod) return false;

    let hasSubject = false;
    let allSelfStudy = true;
    const selfStudyKeywords = /창체|동아리|봉사/i;

    for (let g = 1; g <= 3; g++) {
        let subjectList = subjectsInPeriod[`grade${g}`];
        if (!subjectList) continue;
        
        // 배열 변환
        if (!Array.isArray(subjectList)) {
            subjectList = typeof subjectList === 'object' ? [subjectList] : [{name: subjectList, rooms: []}];
        }

        for (const sub of subjectList) {
            const subjectName = sub.name;
            if (subjectName && subjectName.trim() !== '') {
                hasSubject = true;
                const cleanSubject = subjectName.replace(/\s+/g, '');
                if (!selfStudyKeywords.test(cleanSubject)) {
                    allSelfStudy = false;
                    break;
                }
            }
        }
        if (!allSelfStudy) break;
    }
    return hasSubject && allSelfStudy;
}



function setupTeacherAvailabilityAndConfirm() {
    const scheduleDataString = PropertiesService.getDocumentProperties().getProperty('savedScheduleData');
    if (!scheduleDataString) {
        SpreadsheetApp.getUi().alert('저장된 시험 날짜가 없습니다. 시험 일정을 먼저 설정해주세요.');
        return;
    }
    const scheduleData = JSON.parse(scheduleDataString);
    const allTeacherData = teacherSheet.getDataRange().getValues();
    const headers = allTeacherData.shift();
    const nameColIndex = headers.indexOf('교사명');
    const notesColIndex = headers.indexOf('비고');
    const availableInfoColIndex = headers.indexOf('가능날짜');
    
    const teachersToProcess = allTeacherData
        .map((row, index) => ({
            name: row[nameColIndex] ? row[nameColIndex].toString().trim() : '',
            reason: row[notesColIndex] ? row[notesColIndex].toString().trim() : '',
            rowIndex: index + 2,
            savedSelections: row[availableInfoColIndex] ? row[availableInfoColIndex].toString() : ''
        }))
        .filter(t => t.name && t.reason !== '');

    if (teachersToProcess.length === 0) {
        SpreadsheetApp.getUi().alert("처리할 교사 정보가 없습니다. '교사 정보' 시트에서 '비고'란에 내용이 기재된 교사를 확인해주세요.");
        return;
    }
    showCalendarDialog(teachersToProcess, scheduleData.dates.filter(d => d), scheduleData.periods);
}

/**
 * [수정본] 교사 정보를 가져올 때 다중 이동학급 및 과목 데이터를 배열로 파싱합니다.
 */
function getTeacherProfiles() {
    const allTeacherData = teacherSheet.getDataRange().getValues();
    const teacherHeaders = allTeacherData.shift();

    const nameColIdx = teacherHeaders.indexOf('교사명'),
        subjectColIdx = teacherHeaders.indexOf('담당과목'),
        homeroomColIdx = teacherHeaders.indexOf('담임학급'),
        movingClassColIdx = teacherHeaders.indexOf('이동학급'),
        notesColIdx = teacherHeaders.indexOf('비고'),
        availableInfoColIdx = teacherHeaders.indexOf('가능날짜'),
        exclusionColIdx = teacherHeaders.indexOf('제외교시'),
        exclusionReasonColIdx = teacherHeaders.indexOf('제외사유');

    if (nameColIdx === -1) throw new Error("'교사 정보' 시트에서 '교사명' 열을 찾을 수 없습니다.");

    // 키워드 정의
    const completeExclusionKeywords = ['평가담당', '평가계', '완전제외', '감독제외', '제외'];
    const hallwayOnlyKeywords = ['복도배치']; 
    const otherPriorityKeywords = ['시간강사', '비교과']; 
    const roamingKeywords = ['순회'];
    const superPriorityKeywords = ['필수배치'];

    return allTeacherData.map(row => {
        const teacherName = String(row[nameColIdx]).trim();
        if (!teacherName) return null;

        const notes = notesColIdx !== -1 ? (row[notesColIdx]?.toString().trim() || '') : '';
        const availabilityText = availableInfoColIdx !== -1 ? (row[availableInfoColIdx]?.toString() || '') : '';
        const exclusionText = exclusionColIdx !== -1 ? (row[exclusionColIdx]?.toString() || '') : '';
        const exclusionReasonText = exclusionReasonColIdx !== -1 ? (row[exclusionReasonColIdx]?.toString().trim() || '') : '';
        
        // ✅ 이동학급 데이터를 쉼표/슬래시 기준으로 쪼개어 배열화
        const movingClassText = movingClassColIdx !== -1 ? (row[movingClassColIdx]?.toString() || '') : '';
        const movingClasses = movingClassText.split(/[,/]/).map(c => c.trim()).filter(Boolean);

        let availability = parseAvailability(availabilityText);
        const exclusions = parseExclusions(exclusionText);

        // 1. 완전 제외 확인
        const isFullyExcluded = completeExclusionKeywords.some(k => notes.includes(k));
        if (isFullyExcluded) availability = { 'all-unavailable': true };

        // 2. 역할 속성 부여
        const isHallwayOnly = !isFullyExcluded && hallwayOnlyKeywords.some(k => notes.includes(k));
        const isPriorityHallway = isHallwayOnly || (!isFullyExcluded && otherPriorityKeywords.some(k => notes.includes(k)));
        const isRoaming = !isFullyExcluded && roamingKeywords.some(k => notes.includes(k));
        const isSuperPriority = !isFullyExcluded && superPriorityKeywords.some(k => notes.includes(k));

        return {
            name: teacherName,
            subject: subjectColIdx !== -1 ? (row[subjectColIdx]?.toString().trim() || '') : '',
            homeroom: homeroomColIdx !== -1 ? (row[homeroomColIdx]?.toString().trim() || null) : null,
            // ✅ 기존 movingClass(단수)를 movingClasses(복수/배열)로 변경
            movingClasses: movingClasses, 
            notesReason: notes,
            isSuperPriority: isSuperPriority,
            isHallwayOnly: isHallwayOnly,
            isPriorityHallway: isPriorityHallway,
            isRoaming: isRoaming,
            isPartiallyAvailable: Object.keys(availability).length > 0 && !availability['all-unavailable'],
            availability: availability,
            exclusions: exclusions,
            exclusionReason: exclusionReasonText,
            assignmentCount: 0,
            hallwayCount: 0,
            totalProctorScore: 0,
            assignments: [],
            classroomAssignmentCountsByDate: {},
            hallwayAssignmentCountsByDate: {}
        };
    }).filter(Boolean);
}

/**
 * [수정본] 제외교시 문자열을 파싱하여 객체로 변환하는 헬퍼 함수
 * (YYYY-MM-DD, YYYY-M-D, YYYY/MM/DD 등 모든 형태와 공백 완벽 대응)
 */
function parseExclusions(text) {
  const exclusions = {};
  if (!text || typeof text !== 'string' || text.trim() === '') return exclusions;
  
  // 모든 구분자(-, ., /)와 한자리/두자리 월, 일을 완벽하게 추출하는 정규식
  const regex = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})\s*\(([\d,\s]+)\)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const year = match[1];
    const month = match[2].padStart(2, '0'); // '7' -> '07' 로 자동 변환
    const day = match[3].padStart(2, '0');
    const date = `${year}-${month}-${day}`; // 무조건 YYYY-MM-DD 포맷으로 통일
    
    const periods = match[4].split(',').map(p => parseInt(p.trim())).filter(Number.isInteger);
    if (periods.length > 0) exclusions[date] = periods;
  }
  return exclusions;
}

/**
 * [수정본] 가능날짜 문자열 파싱 헬퍼 함수 (제외교시와 동일한 안정성 적용)
 */
function parseAvailability(text) {
  const availability = {};
  if (!text || typeof text !== 'string' || text.trim() === '') return availability;
  if (text.trim() === '전체 불가') {
    availability['all-unavailable'] = true;
    return availability;
  }
  
  const regex = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})\s*\(([\d,\s]+)\)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const year = match[1];
    const month = match[2].padStart(2, '0');
    const day = match[3].padStart(2, '0');
    const date = `${year}-${month}-${day}`;
    
    const periods = match[4].split(',').map(p => parseInt(p.trim())).filter(Number.isInteger);
    if (periods.length > 0) availability[date] = periods;
  }
  return availability;
}

function createExamSubjectMap(scheduleData) {
  const examSubjectMap = {};

  scheduleData.dates.forEach(dateStr => {
    const formattedDate = formatDateToYYYYMMDD(dateStr);
    if (!formattedDate) return;

    examSubjectMap[formattedDate] = {};

    const periodsForDate = scheduleData.datePeriods
      ? (scheduleData.datePeriods[formattedDate] || scheduleData.periods)
      : scheduleData.periods;

    for (let p = 1; p <= periodsForDate; p++) {
      examSubjectMap[formattedDate][p] = new Set();

      for (let g = 1; g <= 3; g++) {
        let subjectList = scheduleData.subjects[formattedDate]?.[`period${p}`]?.[`grade${g}`];
        if (subjectList) {
          if (!Array.isArray(subjectList)) {
            subjectList = typeof subjectList === 'object' ? [subjectList] : [{name: subjectList, rooms: null}];
          }

          subjectList.forEach(sub => {
            // ✅ "none"(전체해제) 또는 빈 이름은 충돌 맵 등록 안 함
            if (sub.name && sub.name.trim() !== ''
                && sub.rooms !== 'none'
                && (sub.rooms === null || (Array.isArray(sub.rooms) && sub.rooms.length > 0))) {
              normalizeSubjects(sub.name).forEach(s => examSubjectMap[formattedDate][p].add(s));
            }
          });
        }
      }
    }
  });

  return examSubjectMap;
}

/**
  * [최종 수정] 일반 모드 슬롯 생성
  * - 과목별 객체 구조({name, rooms})를 해석하여 슬롯 생성
  * - 중복 고사실 방지를 위해 Set을 이용해 슬롯 생성 전 고유 고사실 수집 로직 적용
  */
function createProctoringSlots(scheduleData, examSubjectMap) {
  const proctoringSlots = [];
  const allRooms = new Set();

  scheduleData.dates.forEach(dateStr => {
    const formattedDate = formatDateToYYYYMMDD(dateStr);
    if (!formattedDate || !examSubjectMap[formattedDate]) return;

    const periodsForDate = scheduleData.datePeriods
      ? (scheduleData.datePeriods[formattedDate] || scheduleData.periods)
      : scheduleData.periods;

    for (let p = 1; p <= periodsForDate; p++) {
      const subjectsInPeriod = scheduleData.subjects[formattedDate]?.[`period${p}`];
      if (!subjectsInPeriod) continue;

      // ✅ 교실 슬롯용 — "none" 및 0실 제외
      const hasExamInPeriod = [1, 2, 3].some(g => {
        let sList = subjectsInPeriod[`grade${g}`];
        if (!sList) return false;
        if (!Array.isArray(sList)) sList = typeof sList === 'object' ? [sList] : [{name: sList, rooms: null}];
        return sList.some(s => s.name && s.name.trim() !== ''
          && s.rooms !== 'none'
          && (s.rooms === null || (Array.isArray(s.rooms) && s.rooms.length > 0)));
      });

      // ✅ 복도/특별실 슬롯용 — 과목명만 있으면 해당 교시로 인정 ("none" 포함)
      const hasAnySubjectInPeriod = [1, 2, 3].some(g => {
        let sList = subjectsInPeriod[`grade${g}`];
        if (!sList) return false;
        if (!Array.isArray(sList)) sList = typeof sList === 'object' ? [sList] : [{name: sList, rooms: null}];
        return sList.some(s => s.name && s.name.trim() !== '');
      });

      // 아예 과목이 없는 교시는 스킵
      if (!hasAnySubjectInPeriod) continue;

      const isSelfStudy = isAllSelfStudyPeriod(scheduleData, formattedDate, p);

      // 교실 슬롯 생성
      if (hasExamInPeriod) {
        for (let g = 1; g <= 3; g++) {
          let subjectList = subjectsInPeriod[`grade${g}`];
          if (!subjectList) continue;
          if (!Array.isArray(subjectList)) {
            subjectList = typeof subjectList === 'object' ? [subjectList] : [{name: subjectList, rooms: null}];
          }

          const roomsWithExam = new Set();

          subjectList.forEach(sub => {
            const subjectName = sub.name;
            if (!subjectName || subjectName.trim() === '') return;

            // ✅ "none" 또는 배열이 아닌 값이면 슬롯 생성 안 함
            if (sub.rooms === 'none') return;
            if (sub.rooms !== null && !Array.isArray(sub.rooms)) return;

            const globalRooms = scheduleData[`grade${g}Rooms`] || [];
            const targetRooms = (sub.rooms === null) ? globalRooms : sub.rooms;

            // ✅ 최종 배열 확인
            if (!Array.isArray(targetRooms)) return;

            targetRooms.forEach(roomNameRaw => {
              const roomName = String(roomNameRaw).trim();
              if (roomName !== '') {
                roomsWithExam.add(roomName);
                allRooms.add(roomName);
              }
            });
          });

          roomsWithExam.forEach(roomName => {
            proctoringSlots.push({
              date: formattedDate, period: p, room: roomName,
              isHallway: false, assignedTeacher: null, grade: g,
              isSelfStudyPeriod: isSelfStudy
            });
          });
        }
      }

      // ✅ 특별실 슬롯 — hasAnySubjectInPeriod 기준
      (scheduleData.specialRooms || []).forEach(roomRaw => {
        const room = String(roomRaw).trim();
        if (room !== '') {
          allRooms.add(room);
          proctoringSlots.push({
            date: formattedDate, period: p, room,
            isHallway: false, assignedTeacher: null, grade: null,
            isSelfStudyPeriod: isSelfStudy
          });
        }
      });

      // ✅ 복도 감독 슬롯 — hasAnySubjectInPeriod 기준
      if (!isSelfStudy) {
        (scheduleData.hallways || []).forEach(roomRaw => {
          const room = String(roomRaw).trim();
          if (room !== '') {
            allRooms.add(room);
            proctoringSlots.push({
              date: formattedDate, period: p, room,
              isHallway: true, assignedTeacher: null, grade: null,
              isSelfStudyPeriod: isSelfStudy
            });
          }
        });
      }
    }
  });

  return { proctoringSlots, allRooms };
}


/**
  * [최종 수정] 정/부 감독 모드 슬롯 생성
  * - 과목별 선택 고사실 반영 및 자습 시 부감독 제외 로직
  * - 중복 고사실 방지를 위해 Set을 이용해 슬롯 생성 전 고유 고사실 수집 로직 적용
  */
function createMainSubProctoringSlots(scheduleData, examSubjectMap) {
  const proctoringSlots = [];
  const allRooms = new Set();

  const singleRoomsData = getSingleProctorRooms();
  const isSingleRoom = (date, period, room) => {
    const arr = singleRoomsData[date] && singleRoomsData[date][String(period)];
    return Array.isArray(arr) && arr.includes(room);
  };

  scheduleData.dates.forEach(dateStr => {
    const formattedDate = formatDateToYYYYMMDD(dateStr);
    if (!formattedDate || !examSubjectMap[formattedDate]) return;

    const periodsForDate = scheduleData.datePeriods
      ? (scheduleData.datePeriods[formattedDate] || scheduleData.periods)
      : scheduleData.periods;

    for (let p = 1; p <= periodsForDate; p++) {
      const subjectsInPeriod = scheduleData.subjects[formattedDate]?.[`period${p}`];
      if (!subjectsInPeriod) continue;

      // ✅ 교실 슬롯용 — "none" 및 0실 제외
      const hasExamInPeriod = [1, 2, 3].some(g => {
        let sList = subjectsInPeriod[`grade${g}`];
        if (!sList) return false;
        if (!Array.isArray(sList)) sList = typeof sList === 'object' ? [sList] : [{name: sList, rooms: null}];
        return sList.some(s => s.name && s.name.trim() !== ''
          && s.rooms !== 'none'
          && (s.rooms === null || (Array.isArray(s.rooms) && s.rooms.length > 0)));
      });

      // ✅ 복도/특별실 슬롯용 — 과목명만 있으면 해당 교시로 인정
      const hasAnySubjectInPeriod = [1, 2, 3].some(g => {
        let sList = subjectsInPeriod[`grade${g}`];
        if (!sList) return false;
        if (!Array.isArray(sList)) sList = typeof sList === 'object' ? [sList] : [{name: sList, rooms: null}];
        return sList.some(s => s.name && s.name.trim() !== '');
      });

      if (!hasAnySubjectInPeriod) continue;

      const isSelfStudy = isAllSelfStudyPeriod(scheduleData, formattedDate, p);

      // 교실 슬롯 생성
      if (hasExamInPeriod) {
        for (let g = 1; g <= 3; g++) {
          let subjectList = subjectsInPeriod[`grade${g}`];
          if (!subjectList) continue;
          if (!Array.isArray(subjectList)) {
            subjectList = typeof subjectList === 'object' ? [subjectList] : [{name: subjectList, rooms: null}];
          }

          const roomsWithExam = new Set();

          subjectList.forEach(sub => {
            const subjectName = sub.name;
            if (!subjectName || subjectName.trim() === '') return;

            // ✅ "none" 또는 배열이 아닌 값이면 슬롯 생성 안 함
            if (sub.rooms === 'none') return;
            if (sub.rooms !== null && !Array.isArray(sub.rooms)) return;

            const globalRooms = scheduleData[`grade${g}Rooms`] || [];
            const targetRooms = (sub.rooms === null) ? globalRooms : sub.rooms;

            // ✅ 최종 배열 확인
            if (!Array.isArray(targetRooms)) return;

            targetRooms.forEach(roomNameRaw => {
              const roomName = String(roomNameRaw).trim();
              if (roomName !== '') {
                roomsWithExam.add(roomName);
                allRooms.add(roomName);
              }
            });
          });

          roomsWithExam.forEach(roomName => {
            proctoringSlots.push({
              date: formattedDate, period: p, room: roomName,
              isMain: true, assignedTeacher: null, grade: g
            });

            if (!isSelfStudy && !isSingleRoom(formattedDate, p, roomName)) {
              proctoringSlots.push({
                date: formattedDate, period: p, room: roomName,
                isMain: false, assignedTeacher: null, grade: g
              });
            }
          });
        }
      }

      // ✅ 특별실 슬롯 — hasAnySubjectInPeriod 기준
      (scheduleData.specialRooms || []).forEach(roomRaw => {
        const room = String(roomRaw).trim();
        if (room !== '') {
          allRooms.add(room);
          proctoringSlots.push({
            date: formattedDate, period: p, room,
            isMain: true, assignedTeacher: null, grade: null
          });
          if (!isSelfStudy && !isSingleRoom(formattedDate, p, room)) {
            proctoringSlots.push({
              date: formattedDate, period: p, room,
              isMain: false, assignedTeacher: null, grade: null
            });
          }
        }
      });
    }
  });

  return { proctoringSlots, allRooms };
}

/**
 * 교사를 슬롯에 배정하고 관련 데이터를 업데이트합니다.
 * v2: settings 객체에서 가중치를 동적으로 받아와 점수를 계산하도록 수정
 * @param {object} teacher - 교사 객체
 * @param {object} slot - 감독 슬롯 객체
 * @param {object} settings - 세부 설정 객체
 */
function assignTeacherToSlot(teacher, slot, settings) {
    slot.assignedTeacher = teacher.name;
    teacher.assignmentCount++;
    if (slot.isHallway) {
        teacher.hallwayCount++;
    } else {
        teacher.classroomAssignmentCountsByDate[slot.date] = (teacher.classroomAssignmentCountsByDate[slot.date] || 0) + 1;
    }
    // [수정] 고정된 상수 대신 settings 객체의 가중치 값을 사용
    teacher.totalProctorScore += slot.isHallway ? settings.hallwayWeight : settings.classroomWeight;
    teacher.assignments.push({ date: slot.date, period: slot.period, room: slot.room, isHallway: slot.isHallway });
}


function assignTeacherToMainSubSlot(teacher, slot) {
    slot.assignedTeacher = teacher.name;
    teacher.assignmentCount++;
    teacher.totalProctorScore++; // 가중치 없이 1점 증가
    teacher.assignments.push({ date: slot.date, period: slot.period, room: slot.room, isMain: slot.isMain, isHallway: false });
}

function getHallwayAssignmentsTodayCount(teacher, date) {
    return teacher.assignments.filter(a => a.date === date && a.isHallway).length;
}

/**
 * [신규] 후보 교사 적합도 점수 계산 (낮을수록 우선 배정)
 * - 1순위: 사용자 설정 가중치가 반영된 총점 (공정성)
 * - 2순위: 일일 배정 쏠림 방지
 * - 3순위: 역할 적합성 (유연성)
 * - 4순위: 고사실 다양성
 */
function calculateCandidateScore(teacher, slot, settings) {
  // 1. 기본 점수 (✅ 공정성 압도화: 점수 1점 차이도 절대 우선)
  let penalty = teacher.totalProctorScore * 1000000;

  // 2. 일일 쏠림 방지 (동점일 때만 작동)
  const dailyCount = teacher.assignments.filter(a => a.date === slot.date).length;
  penalty += dailyCount * 3000;

  // 3. 역할 적합성
  if (slot.isHallway) {
    // [복도 자리]
    if (teacher.isHallwayOnly) penalty -= 500000;
    else if (teacher.isPriorityHallway) penalty += 0;
    else if (teacher.isRoaming) penalty += 1000;
    else penalty += 5000;
  }
  else if (typeof slot.isMain !== 'undefined') {
    // [정/부 감독 모드]
    if (slot.isMain) {
      if (teacher.isHallwayOnly) penalty += 100000000;
      else if (teacher.isPriorityHallway || teacher.isRoaming) penalty += 5000;
      else penalty += 0;
    } else {
      if (teacher.isHallwayOnly) penalty -= 500000;
      else if (teacher.isPriorityHallway || teacher.isRoaming) penalty -= 2000;
      else penalty += 0;
    }
  }
  else {
    // [일반 교실 자리]
    if (teacher.isHallwayOnly) penalty += 100000000;
    else if (teacher.isPriorityHallway) penalty += 5000;
    else if (teacher.isRoaming) penalty += 5000;
    else penalty += 0;
  }

  // 4. 고사실 다양성 (✅ 가중치 상향: 같은 방 반복 강하게 회피)
  const roomCount = getRoomAssignmentCount(teacher, slot.room);
  if (roomCount > 0) penalty += (roomCount * 8000);

  // 5. 연속 감독 방지
  const previousPeriod = teacher.assignments.find(a => a.date === slot.date && a.period === slot.period - 1);
  if (previousPeriod) penalty += 2500;

  penalty += Math.random() * 100;
  return penalty;
}



/**
 * [최종 수정] 일반 모드 배정 가능 여부 확인
 * - 변경점: 'isHallwayOnly'(복도배치) 교사는 자습 시간이 아닐 때 교실 배정을 원천 차단.
 */

function isAssignable(teacher, slot, examSubjectMap, strictProctoringLimits = true, settings, allowTotalClassroomCountExceed = false, isManualSwap = false) {
    // 1. [절대 불가] 물리적 조건 (제외교시, 담임학급, 다중 이동학급)
    if (teacher.exclusions[slot.date] && teacher.exclusions[slot.date].includes(slot.period)) return false;
    
    // 담임학급 체크
    if (teacher.homeroom && String(teacher.homeroom) === String(slot.room)) return false;
    
    // ✅ 다중 이동학급 체크: 배열 내에 현재 고사실(slot.room)이 포함되어 있는지 확인
    if (teacher.movingClasses && teacher.movingClasses.includes(String(slot.room))) return false;
    
    // ✅ 담당과목 충돌 체크 (복수 과목 대응)
    const subjectsThisPeriod = examSubjectMap[slot.date]?.[slot.period];
    if (subjectsThisPeriod && teacher.subject) {
        const teacherSubjects = normalizeSubjects(teacher.subject); // "국어, 영어" -> ["국어", "영어"]
        // 교사의 담당 과목 중 하나라도 현재 교시 시험 과목(Set)에 포함되어 있으면 제외
        if (teacherSubjects.some(ts => subjectsThisPeriod.has(ts))) return false;
    }

    // 2. [절대 불가] 시간표상 가능 여부
    if (Object.keys(teacher.availability).length > 0) {
        if (teacher.availability['all-unavailable']) return false;
        if (!teacher.availability[slot.date]) return false;
        if (!teacher.availability[slot.date].includes(slot.period)) return false;
    }

    // 3. [핵심] 복도배치 교사의 교실 배정 차단 (자습 시간 제외)
    if (teacher.isHallwayOnly && !slot.isHallway && !slot.isSelfStudyPeriod) {
        if (!isManualSwap) return false; 
    }

    // 4. 수동 배정 패스 (조정 화면용)
    if (isManualSwap) return true;

    // 5. 정책적 제한 (중복 시간 배정 방지 등)
    if (teacher.assignments.some(a => a.date === slot.date && a.period === slot.period)) return false;

    // 배정 횟수 및 가중치 제한 체크
    const currentClassroomAssignmentsToday = teacher.classroomAssignmentCountsByDate[slot.date] || 0;
    const currentHallwayAssignmentsToday = getHallwayAssignmentsTodayCount(teacher, slot.date);
    const currentTotalClassroomAssignments = teacher.assignmentCount - teacher.hallwayCount;

    // 하루 최대 2교시 제한 등 설정값 적용
    if (!settings.allowThirdClassroomProctor && !slot.isHallway && currentClassroomAssignmentsToday >= 2 && currentHallwayAssignmentsToday === 0) return false;
    
    if (teacher.isRoaming) {
        if (slot.isHallway && currentHallwayAssignmentsToday >= settings.maxHallway) return false;
    } else {
        if (strictProctoringLimits && slot.isHallway) {
            if (currentHallwayAssignmentsToday >= settings.maxHallway) return false;
        }
    }

    if (!allowTotalClassroomCountExceed && !slot.isHallway && currentTotalClassroomAssignments >= settings.maxClassroom) {
        return false;
    }
    
    return true;
}

/**
 * [최종 수정] 정/부 감독 배정 가능 여부 확인
 * - 변경점: '복도배치(isHallwayOnly)' 교사는 정감독(Main) 불가, 부감독(Sub)만 가능하도록 강제함.
 */
function isAssignableMainSub(teacher, slot, examSubjectMap, isManualSwap = false) {
    if (teacher.exclusions[slot.date] && teacher.exclusions[slot.date].includes(slot.period)) return false;
    if (teacher.homeroom && String(teacher.homeroom) === String(slot.room)) return false;
    if (teacher.movingClasses && teacher.movingClasses.includes(String(slot.room))) return false;
    
    const subjectsThisPeriod = examSubjectMap[slot.date]?.[slot.period.toString()];
    if (subjectsThisPeriod && teacher.subject && normalizeSubjects(teacher.subject).some(ts => subjectsThisPeriod.has(ts))) return false;

    if (Object.keys(teacher.availability).length > 0) {
        if (teacher.availability['all-unavailable']) return false;
        if (!teacher.availability[slot.date] || !teacher.availability[slot.date].includes(slot.period)) return false;
    }

    // [핵심] 복도배치 교사는 정감독 불가 (자습 제외)
    if (teacher.isHallwayOnly && slot.isMain && !slot.isSelfStudyPeriod) {
        if (!isManualSwap) return false; 
    }

    if (isManualSwap) return true;

    if (teacher.assignments.some(a => a.date === slot.date && a.period === slot.period)) return false;
    return true;
}

/**
 * 특정 교사가 특정 고사실에 배정된 횟수를 계산합니다. (고사실 중복 배정 최소화용)
 * @param {object} teacher - 교사 객체
 * @param {string} room - 고사실 이름
 * @returns {number} - 배정 횟수
 */
function getRoomAssignmentCount(teacher, room) {
    if (!teacher || !teacher.assignments || !room) return 0;
    return teacher.assignments.filter(a => a.room === room).length;
}

// ===============================================================
// --- 결과 시트 생성 및 서식 적용 함수 ---
// ===============================================================

/**
 * ✅ [수정] 결과 시트 생성 함수
 * - 기존 시트 삭제/초기화 로직을 강화하여 '틀 고정' 오류를 방지합니다.
 * - 더 이상 사용하지 않는 rawExclusionData 파라미터를 삭제합니다.
 */
function createResultSheets(slots, teachers, scheduleData, allRooms) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // --- 강력한 시트 초기화 로직 ---
    const sheetNamesToClean = ['교사별 전체 시간표', '고사실별 전체 시간표'];
    ss.getSheets().forEach(sheet => {
        const sheetName = sheet.getName();
        if (sheetNamesToClean.some(name => sheetName.includes(name) && !sheetName.includes('(정부)'))) {
            try {
                ss.deleteSheet(sheet);
            } catch (e) {
                Logger.log(`시트 '${sheetName}' 삭제 실패. 초기화를 진행합니다. 오류: ${e.message}`);
                sheet.clear();
                sheet.setFrozenRows(0);
                sheet.setFrozenColumns(0);
                sheet.clearConditionalFormatRules();
            }
        }
    });
    // --- 초기화 로직 끝 ---

    const examDates = scheduleData.dates.map(dateStr => formatDateToYYYYMMDD(dateStr)).filter(Boolean);
    const periodCount = scheduleData.periods;
    
    // 교사별 누적 배정 횟수 계산
    teachers.forEach(teacher => {
        let currentCumulativeCount = 0;
        teacher.cumulativeAssignmentsByDate = {};
        for (const date of examDates) {
            currentCumulativeCount += teacher.assignments.filter(a => a.date === date).length;
            teacher.cumulativeAssignmentsByDate[date] = currentCumulativeCount;
        }
    });

    // 고사실 정렬
    const sortedRooms = Array.from(allRooms).sort((a, b) => {
        const isClassA = a.match(/^\d+-\d+$/), isClassB = b.match(/^\d+-\d+$/);
        if (isClassA && !isClassB) return -1;
        if (!isClassA && isClassB) return 1;
        if (isClassA && isClassB) {
            const pA = a.split('-').map(Number), pB = b.split('-').map(Number);
            return pA[0] !== pB[0] ? pA[0] - pB[0] : pA[1] - pB[1];
        }
        return a.localeCompare(b);
    });

    // 결과 시트 생성 및 서식 적용
    const teacherSheet = createTeacherResultSheet(ss, teachers, examDates, periodCount);
    applySheetFormatting(teacherSheet, {
        type: 'teacher',
        examDates: examDates,
        periodCount: periodCount,
        cumulativeSectionStartCol: (examDates.length * periodCount) + 3
    });
    const roomSheet = createRoomResultSheet(ss, slots, sortedRooms, examDates, periodCount);
    applySheetFormatting(roomSheet, {
        type: 'room',
        title: '고사실',
        frozenCols: 1,
        examDates: examDates,
        periodCount: periodCount
    });
    
    teacherSheet.activate();
}
/**
 * ✅ [최종 수정] 교사별 결과 시트 생성 함수 (일반 모드)
 * 제외 사유를 teacher 객체에서 직접 읽어오도록 수정합니다.
 */
function createTeacherResultSheet(ss, teachers, examDates, periodCount) {
    const sheet = ss.insertSheet('교사별 전체 시간표', ss.getSheets().length);
    const scheduleData = getSavedScheduleData();
    const examSubjectMap = createExamSubjectMap(scheduleData);

    const subHeader = ['순', '교사명'];
    examDates.forEach(() => { for (let p = 1; p <= periodCount; p++) subHeader.push(`${p}교시`); });
    examDates.forEach(date => subHeader.push(formatDateToMDWeekday(date)));
    subHeader.push('배정점수');
    sheet.getRange(2, 1, 1, subHeader.length).setValues([subHeader]);

    const data = [], backgrounds = [], fontColors = [];
    const disabledFontColor = '#808080';
    const reasonCellBg = '#f3f3f3';
    const roleKeywords = ['시간강사', '비교과', '복도배치', '필수배치']; // 키워드 정의

    teachers.forEach((t, i) => {
        const rowData = [i + 1, t.name];
        const rowBackgrounds = [null, null];
        const rowFontColors = [null, null];

        examDates.forEach(date => {
            for (let p = 1; p <= periodCount; p++) {
                const a = t.assignments.find(as => as.date === date && as.period === p);
                if (a) {
                    let r = a.room;
                    if (String(r).match(/^\d+-\d+$/)) r = "'" + r;
                    rowData.push(r);
                    rowBackgrounds.push(null);
                    rowFontColors.push(null);
                } else {
          // 통합 함수로 교체
          let reasonText = getSlotReasonText(t, date, p, examSubjectMap);
          
          rowData.push(reasonText);
          if (reasonText) {
                        rowBackgrounds.push(reasonCellBg);
                        rowFontColors.push(disabledFontColor);
                    } else {
                        rowBackgrounds.push(null);
                        rowFontColors.push(null);
                    }
                }
            }
        });
        examDates.forEach(date => rowData.push(t.cumulativeAssignmentsByDate[date] || 0));
        rowData.push(t.totalProctorScore);
        data.push(rowData);
        backgrounds.push(rowBackgrounds);
        fontColors.push(rowFontColors);
    });

    if (data.length > 0) {
        sheet.getRange(3, 1, data.length, data[0].length).setValues(data);
        const formatRange = sheet.getRange(3, 3, backgrounds.length, examDates.length * periodCount);
        formatRange.setBackgrounds(backgrounds.map(r => r.slice(2))).setFontColors(fontColors.map(r => r.slice(2)));
    }
    return sheet;
}

/**
 * [최종 수정] 고사실별 결과 시트 생성 (일반 모드)
 * - 전략: 배정이 안 된 경우, 상황(자습/시험없음)에 따라 텍스트를 입력하여 조건부 서식을 유도함
 */
function createRoomResultSheet(ss, slots, sortedRooms, examDates, periodCount) {
  const sheet = ss.insertSheet('고사실별 전체 시간표', ss.getSheets().length);
  const subHeader = ['고사실'];
  
  examDates.forEach(() => {
    for (let p = 1; p <= periodCount; p++) subHeader.push(`${p}교시`);
  });
  sheet.getRange(2, 1, 1, subHeader.length).setValues([subHeader]);
  
  const scheduleData = getSavedScheduleData();
  
  const data = sortedRooms.map(room => {
    const row = [String(room).match(/^\d+-\d+$/) ? "'" + room : room];
    
    examDates.forEach((date) => {
      const formattedDate = formatDateToYYYYMMDD(date);
      for (let p = 1; p <= periodCount; p++) {
        const assignment = slots.find(s => s.date === formattedDate && s.period === p && s.room === room);
        
        if (assignment) {
          // 슬롯은 생성되었으나 배정이 안 된 경우 빈칸(미배정 빨간색) 유지
          row.push(assignment.assignedTeacher || ''); 
        } else {
          // 아예 슬롯이 생성되지 않은 경우 (적용 고사실에서 제외됨)
          const isHallwayRoom = !String(room).match(/^\d+-\d+$/) && (scheduleData.hallways || []).includes(room);
          const isSelfStudy = isAllSelfStudyPeriod(scheduleData, formattedDate, p);
          
          if (isHallwayRoom && isSelfStudy) {
            row.push('자습');
          } else {
            row.push('시험없음'); // 제외된 반은 '시험없음'으로 처리
          }
        }
      }
    });
    return row;
  });
  
  if (data.length > 0) sheet.getRange(3, 1, data.length, data[0].length).setValues(data);
  return sheet;
}


function createMainSubResultSheets(slots, teachers, scheduleData, allRooms) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 기존 시트 삭제/초기화
    const sheetNamesToClean = ['교사별 전체 시간표 (정부)', '고사실별 전체 시간표 (정부)'];
    ss.getSheets().forEach(sheet => {
        const sheetName = sheet.getName();
        if (sheetNamesToClean.some(name => sheetName.includes(name))) {
            try { 
                ss.deleteSheet(sheet); 
            } catch (e) { 
                // ✅ 보완: 삭제 실패 시 내용뿐만 아니라 틀 고정과 조건부 서식까지 완벽히 초기화
                sheet.clear(); 
                sheet.setFrozenRows(0);
                sheet.setFrozenColumns(0);
                sheet.clearConditionalFormatRules();
            }
        }
    });

    const examDates = scheduleData.dates.map(dateStr => formatDateToYYYYMMDD(dateStr)).filter(Boolean);
    const periodCount = scheduleData.periods;
    
    // 고사실 정렬 (선생님께서 완벽하게 수정하신 로직)
    const sortedRooms = Array.from(allRooms).sort((a, b) => {
        const isClassA = a.match(/^\d+-\d+$/), isClassB = b.match(/^\d+-\d+$/);
        if (isClassA && !isClassB) return -1;
        if (!isClassA && isClassB) return 1;
        if (isClassA && isClassB) {
            const pA = a.split('-').map(Number), pB = b.split('-').map(Number);
            return pA !== pB ? pA - pB : pA[1] - pB[1];
        }
        return a.localeCompare(b);
    });

    // 1. 교사별 시트 생성
    const teacherSheet = createMainSubTeacherResultSheet(ss, teachers, examDates, periodCount);
    applySheetFormatting(teacherSheet, {
        type: 'teacher',
        examDates: examDates,
        periodCount: periodCount,
        cumulativeSectionStartCol: (examDates.length * periodCount) + 3
    });

    // 2. 고사실별 시트 생성
    const roomSheet = createMainSubRoomResultSheet(ss, slots, sortedRooms, examDates, periodCount);
    applySheetFormatting(roomSheet, {
        type: 'mainsub-room',
        title: '고사실',
        frozenCols: 1,
        examDates: examDates,
        periodCount: periodCount
    });

    teacherSheet.activate();
}

/**
 * [최종] 교사별 결과 시트 생성 (정/부 모드용)
 * - 불가 사유 텍스트('감독불가' 등) 처리 포함
 */
function createMainSubTeacherResultSheet(ss, teachers, examDates, periodCount) {
    const sheet = ss.insertSheet('교사별 전체 시간표 (정부)', ss.getSheets().length);
    const scheduleData = getSavedScheduleData();
    const examSubjectMap = createExamSubjectMap(scheduleData);

    const subHeader = ['순', '교사명'];
    examDates.forEach(() => { for (let p = 1; p <= periodCount; p++) subHeader.push(`${p}교시`); });
    examDates.forEach(date => subHeader.push(formatDateToMDWeekday(date)));
    subHeader.push('배정점수');
    sheet.getRange(2, 1, 1, subHeader.length).setValues([subHeader]);

    const data = [], backgrounds = [], fontColors = [];
    const disabledFontColor = '#808080';
    const reasonCellBg = '#f3f3f3';
    const roleKeywords = ['시간강사', '비교과', '복도배치', '필수배치'];

    teachers.forEach((t, i) => {
        const rowData = [i + 1, t.name];
        const rowBackgrounds = [null, null];
        const rowFontColors = [null, null];

        examDates.forEach(date => {
            for (let p = 1; p <= periodCount; p++) {
                const a = t.assignments.find(as => as.date === date && as.period === p);
                if (a) {
                    let cell = `${a.room}${a.isMain ? '(정)' : '(부)'}`;
                    if (String(a.room).match(/^\d+-\d+$/)) cell = "'" + cell;
                    rowData.push(cell);
                    rowBackgrounds.push(null);
                    rowFontColors.push(null);
                } else {
          // 통합 함수로 교체
          let reasonText = getSlotReasonText(t, date, p, examSubjectMap);
          
          rowData.push(reasonText);
          if (reasonText) {
                        rowBackgrounds.push(reasonCellBg);
                        rowFontColors.push(disabledFontColor);
                    } else {
                        rowBackgrounds.push(null);
                        rowFontColors.push(null);
                    }
                }
            }
        });
        examDates.forEach(date => {
            const count = t.assignments.filter(a => new Date(a.date) <= new Date(date)).length;
            rowData.push(count);
        });
        rowData.push(t.totalProctorScore);
        data.push(rowData);
        backgrounds.push(rowBackgrounds);
        fontColors.push(rowFontColors);
    });

    if (data.length > 0) {
        sheet.getRange(3, 1, data.length, data[0].length).setValues(data);
        const formatRange = sheet.getRange(3, 3, backgrounds.length, examDates.length * periodCount);
        formatRange.setBackgrounds(backgrounds.map(r => r.slice(2))).setFontColors(fontColors.map(r => r.slice(2)));
    }
    return sheet;
}


/**
 * [최종 수정] 고사실별 결과 시트 생성 (정/부 모드용)
 * - 제외 설정되어 슬롯 자체가 없는 반은 '시험없음'으로 처리
 */

function createMainSubRoomResultSheet(ss, slots, sortedRooms, examDates, periodCount) {
  const sheet = ss.insertSheet('고사실별 전체 시간표 (정부)', ss.getSheets().length);
  const scheduleData = getSavedScheduleData();
  const singleRoomsData = getSingleProctorRooms(); // 다차원 객체 { 날짜: { 교시: [고사실...] } }

  // 단독 여부 안전 판정 (교시 키는 String 으로 통일)
  const isSingleRoom = (date, period, room) => {
    const arr = singleRoomsData[date] && singleRoomsData[date][String(period)];
    return Array.isArray(arr) && arr.includes(room);
  };

  const topH = ['고사실'];
  const subH = [''];
  examDates.forEach(d => {
    for (let p = 1; p <= periodCount; p++) {
      topH.push(`${formatDateToMDWeekday(d)} ${p}교시`, '');
      subH.push('정감독', '부감독');
    }
  });

  sheet.getRange(1, 1, 1, topH.length).setValues([topH]);
  sheet.getRange(2, 1, 1, subH.length).setValues([subH]);

  const data = sortedRooms.map(room => {
    const row = [String(room).match(/^\d+-\d+$/) ? "'" + room : room];

    examDates.forEach((date) => {
      const formattedDate = formatDateToYYYYMMDD(date);
      for (let p = 1; p <= periodCount; p++) {
        const mainP = slots.find(s => s.date === formattedDate && s.period === p && s.room === room && s.isMain);
        const subP = slots.find(s => s.date === formattedDate && s.period === p && s.room === room && !s.isMain);
        const isSelfStudy = isAllSelfStudyPeriod(scheduleData, formattedDate, p);

        // --- 정감독 자리 ---
        if (mainP) {
          row.push(mainP.assignedTeacher || '');
        } else {
          row.push('시험없음');
        }

        // --- 부감독 자리 ---
        if (subP) {
          row.push(subP.assignedTeacher || '');
        } else {
          if (!mainP) {
            row.push('시험없음');
          } else if (isSelfStudy) {
            row.push('자습');
          } else if (isSingleRoom(formattedDate, p, room)) {
            row.push('X'); // ✅ 정감독만 있는 단독 고사실
          } else {
            row.push('시험없음');
          }
        }
      }
    });
    return row;
  });

  // ✅ 열 개수는 data[0].length
  if (data.length > 0) sheet.getRange(3, 1, data.length, data[0].length).setValues(data);
  return sheet;
}


/**
 * [최종 수정] 서식 적용 함수 (디자인 복구 완료)
 * - 2행(교시 헤더)에 Bold, Font Size 12 적용
 * - '자습', '시험없음' 조건부 서식 유지
 */
function applySheetFormatting(sheet, config) {
    const DOTTED_BORDER = SpreadsheetApp.BorderStyle.DOTTED;
    const DOUBLE_BORDER = SpreadsheetApp.BorderStyle.DOUBLE;
    const HEADER_BG_COLOR = '#343a40';
    const HEADER_FONT_COLOR = '#FFFFFF';
    const headerStylePalette = [{ topFontColor: '#1A3353', subBgColor: '#EAF1F7' }, { topFontColor: '#B30000', subBgColor: '#F7EAEA' }, { topFontColor: '#2B8000', subBgColor: '#EAF4E6' }];
    const lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
    
    // 기본 폰트 설정
    sheet.getRange(1, 1, lastRow, lastCol).setFontFamily('Noto Sans').setVerticalAlignment('middle').setHorizontalAlignment('center');
    if (lastRow > 2) sheet.getRange(3, 1, lastRow - 2, lastCol).setFontSize(11);

    // --- 1. 교사별 시트 (기존 유지) ---
    if (config.type === 'teacher') {
        sheet.setFrozenRows(2); sheet.setFrozenColumns(2);
        sheet.setRowHeights(1, lastRow, 30); sheet.setRowHeight(1, 70);
        sheet.setColumnWidth(1, 35); sheet.setColumnWidth(2, 90);
        const mainContentEndCol = config.cumulativeSectionStartCol - 1;
        for (let col = 3; col <= mainContentEndCol; col++) sheet.setColumnWidth(col, 120);
        for (let col = config.cumulativeSectionStartCol; col <= lastCol; col++) sheet.setColumnWidth(col, 80);
        let currentCol = 3;
        config.examDates.forEach((date, i) => {
            const colors = headerStylePalette[i % headerStylePalette.length];
            sheet.getRange(1, currentCol, 1, config.periodCount).merge().setValue(`${formatDateToMDWeekday(date)} 감독 시험시간표`).setBackground(HEADER_BG_COLOR).setFontColor(HEADER_FONT_COLOR).setFontWeight('bold').setFontSize(20);
            sheet.getRange(2, currentCol, 1, config.periodCount).setBackground(colors.subBgColor).setFontColor(colors.topFontColor);
            currentCol += config.periodCount;
        });
        sheet.getRange(1, config.cumulativeSectionStartCol, 1, config.examDates.length + 1).merge().setValue('누계').setBackground('#EAEAEA').setFontColor('#000000').setFontWeight('bold').setFontSize(20);
        
        // 2행 교사별 시트 헤더 서식 (여기서도 적용)
        sheet.getRange(2, 1, 1, lastCol).setFontWeight('bold').setFontSize(12);
        
        sheet.getRange('A2:B2').setBackground(HEADER_BG_COLOR).setFontColor(HEADER_FONT_COLOR);
        sheet.getRange(1, 1, lastRow, lastCol).setBorder(true, true, true, true, true, true, null, DOTTED_BORDER);
        sheet.getRange(1, 2, lastRow, 1).setBorder(null, null, null, true, null, null, 'black', DOUBLE_BORDER);
        config.examDates.forEach((date, index) => {
            const borderColumn = 2 + (index + 1) * config.periodCount;
            sheet.getRange(1, borderColumn, lastRow, 1).setBorder(null, null, null, true, null, null, 'black', DOUBLE_BORDER);
        });
        if (lastRow > 2) {
            const range = sheet.getRange(3, 3, lastRow - 2, config.cumulativeSectionStartCol - 3);
            const rule = SpreadsheetApp.newConditionalFormatRule().whenCellEmpty().setBackground("#f3f3f3").setRanges([range]).build();
            sheet.setConditionalFormatRules([rule]);
        }
    } 
    
    // --- 2. 고사실별 시트 (수정됨) ---
    else if (config.type === 'room' || config.type === 'mainsub-room') {
        const isMainSub = (config.type === 'mainsub-room');
        
        sheet.setFrozenRows(2); sheet.setFrozenColumns(1);
        sheet.setRowHeights(1, lastRow, 30); 
        if (isMainSub) { sheet.setRowHeight(1, 40); sheet.setRowHeight(2, 30); }
        else { sheet.setRowHeight(1, 70); }

        sheet.setColumnWidth(1, 120);
        for (let c = 2; c <= lastCol; c++) sheet.setColumnWidth(c, isMainSub ? 90 : 120);

        // 헤더 생성 (고정 교시 루프)
        let currentCol = 2;
        config.examDates.forEach((date, i) => {
            const colors = headerStylePalette[i % headerStylePalette.length];
            const pCount = config.periodCount; 

            if (isMainSub) {
                for (let p = 1; p <= pCount; p++) {
                    sheet.getRange(1, currentCol, 1, 2).merge().setValue(`${formatDateToMDWeekday(date)} ${p}교시`)
                        .setBackground(colors.subBgColor).setFontColor(colors.topFontColor).setFontWeight('bold').setFontSize(13);
                    sheet.getRange(2, currentCol, 1, 2).setBackground(colors.subBgColor).setFontColor(colors.topFontColor).setFontWeight('bold').setFontSize(11);
                    currentCol += 2;
                }
            } else {
                // [일반 모드 헤더 스타일]
                sheet.getRange(1, currentCol, 1, pCount).merge().setValue(`${formatDateToMDWeekday(date)} 감독 시험시간표`)
                    .setBackground(HEADER_BG_COLOR).setFontColor(HEADER_FONT_COLOR).setFontWeight('bold').setFontSize(20);
                
                // [수정됨] 2행 교시 헤더에 Bold, Size 12 적용
                sheet.getRange(2, currentCol, 1, pCount)
                    .setBackground(colors.subBgColor)
                    .setFontColor(colors.topFontColor)
                    .setFontWeight('bold') // ★ 굵게
                    .setFontSize(12);      // ★ 12포인트
                
                currentCol += pCount;
            }
        });

        // A2 '고사실' 셀 스타일
        if (isMainSub) {
            sheet.getRange(1, 1, 2, 1).merge().setValue('고사실').setBackground(HEADER_BG_COLOR).setFontColor(HEADER_FONT_COLOR).setFontWeight('bold').setFontSize(14);
        } else {
            // [수정됨] 여기도 Bold, Size 12 적용
            sheet.getRange('A2').setValue(config.title)
                .setBackground(HEADER_BG_COLOR)
                .setFontColor(HEADER_FONT_COLOR)
                .setFontWeight('bold') // ★ 굵게
                .setFontSize(12);      // ★ 12포인트
        }

        // 테두리
        sheet.getRange(1, 1, lastRow, lastCol).setBorder(true, true, true, true, true, true, null, DOTTED_BORDER);
        sheet.getRange(2, 1, 1, lastCol).setBorder(null, null, true, null, null, null, 'black', DOUBLE_BORDER);
        sheet.getRange(1, 1, lastRow, 1).setBorder(null, null, null, true, null, null, 'black', DOUBLE_BORDER);
        
        // 날짜 구분선
        const periodMultiplier = isMainSub ? 2 : 1;
        config.examDates.forEach((date, index) => {
            const borderColumn = 1 + (index + 1) * config.periodCount * periodMultiplier;
            if (borderColumn <= lastCol) sheet.getRange(1, borderColumn, lastRow, 1).setBorder(null, null, null, true, null, null, 'black', DOUBLE_BORDER);
        });

        // 조건부 서식
        if (lastRow > 2) {
            const dataRange = sheet.getRange(3, 2, lastRow - 2, lastCol - 1);
            const rules = [];

            rules.push(SpreadsheetApp.newConditionalFormatRule()
                .whenTextEqualTo("자습")
                .setBackground("#f3f3f3")
                .setFontColor("#808080")
                .setRanges([dataRange])
                .build());

            rules.push(SpreadsheetApp.newConditionalFormatRule()
                .whenTextEqualTo("시험없음")
                .setBackground("#f8f9fa") 
                .setFontColor("#cccccc")
                .setRanges([dataRange])
                .build());

            rules.push(SpreadsheetApp.newConditionalFormatRule()
                .whenCellEmpty()
                .setBackground("#FFCCCC")
                .setRanges([dataRange])
                .build());

            sheet.setConditionalFormatRules(rules);
        }
    }
    
    const maxRows = sheet.getMaxRows();
    if (lastRow < maxRows) sheet.deleteRows(lastRow + 1, maxRows - lastRow);
    const maxCols = sheet.getMaxColumns();
    if (lastCol < maxCols) sheet.deleteColumns(lastCol + 1, maxCols - lastCol);
}

// ===============================================================
// --- 수동 배정 및 일자별 시트 생성 관련 함수 ---
// ===============================================================
function getArchivedFileList() {
  try {
    const archiveFolder = getArchiveFolder();
    const files = archiveFolder.getFilesByType(MimeType.GOOGLE_SHEETS);
    const fileList = [];
    while (files.hasNext()) {
        const file = files.next();
        fileList.push({
            name: file.getName(),
            id: file.getId(),
            url: file.getUrl() // URL 정보 추가
        });
    }
    // 이름 역순(최신)으로 정렬하여 반환
    return fileList.sort((a, b) => a.name < b.name ? 1 : -1);
  } catch (e) {
    throw new Error('과거 고사 파일 목록을 불러오는 중 오류가 발생했습니다: ' + e.message);
  }
}




function getInitialSwapData() {
    const scheduleData = getSavedScheduleData();
    if (!scheduleData) throw new Error("저장된 시험 정보가 없습니다.");

    const settings = getProctorSettings();
    const teachers = getTeacherProfiles();
    const examSubjectMap = createExamSubjectMap(scheduleData);
    const examDates = scheduleData.dates.map(d => formatDateToYYYYMMDD(d)).filter(Boolean);
    const periodCount = scheduleData.periods;
    const unavailabilityInfo = {};

    const roleKeywords = ['시간강사', '비교과', '복도배치', '필수배치'];

    teachers.forEach(teacher => {
        examDates.forEach(date => {
            for (let p = 1; p <= periodCount; p++) {
          const key = `${teacher.name}-${date}-${p}`;
          
          // 통합 함수로 교체
          let reason = getSlotReasonText(teacher, date, p, examSubjectMap);

          if (reason) unavailabilityInfo[key] = reason;
        }
        });
    });

    // (이하 기존 로직 동일)
    let currentProctoringSlots = getProctorAssignments();
    if (currentProctoringSlots.length === 0) {
        const { proctoringSlots } = createProctoringSlots(scheduleData, examSubjectMap);
        currentProctoringSlots = proctoringSlots;
    } else {
        teachers.forEach(t => { t.assignments = []; t.assignmentCount = 0; t.hallwayCount = 0; t.totalProctorScore = 0; t.classroomAssignmentCountsByDate = {}; });
        currentProctoringSlots.forEach(slot => {
            if (slot.assignedTeacher) {
                const teacher = teachers.find(t => t.name === slot.assignedTeacher);
                if (teacher) assignTeacherToSlot(teacher, slot, settings);
            }
        });
    }

    const { allRooms } = createProctoringSlots(scheduleData, examSubjectMap);
    const sortedRooms = Array.from(allRooms).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    return {
        proctoringSlots: currentProctoringSlots,
        teachers: teachers,
        examDates: examDates,
        periodCount: periodCount,
        unavailabilityInfo: unavailabilityInfo,
        settings: settings,
        allRooms: sortedRooms,
        scheduleData: scheduleData, 
        hallwayList: scheduleData.hallways || [],
        examSubjectMap: Object.entries(examSubjectMap).reduce((acc, [date, periods]) => {
            acc[date] = Object.entries(periods).reduce((pAcc, [p, s]) => { pAcc[p] = Array.from(s); return pAcc; }, {});
            return acc;
        }, {})
    };
}

/**
 * [신규] 고사실 뷰에서 미배정(빈칸) 클릭 시 교사를 직접 배정하는 함수
 */
function manualAssignTeacher(date, period, room, teacherName) {
    try {
        let currentAssignments = getProctorAssignments();
        const teachers = getTeacherProfiles();
        const targetTeacher = teachers.find(t => t.name === teacherName);
        if (!targetTeacher) throw new Error("교사 정보를 찾을 수 없습니다.");

        // 기존 슬롯 찾기
        const existingIndex = currentAssignments.findIndex(s => s.date === date && s.period === period && s.room === room);
        
        // 슬롯 데이터 구성
        const newAssignment = {
            date: date,
            period: parseInt(period),
            room: room,
            assignedTeacher: teacherName,
            isHallway: !String(room).match(/^\d+-\d+$/), // 임시 판단
            isMain: true // 일반 모드에선 무시됨
        };

        if (existingIndex !== -1) {
            currentAssignments[existingIndex] = newAssignment;
        } else {
            currentAssignments.push(newAssignment);
        }

        // 저장 및 재계산
        // saveProctorManualChanges 함수를 재활용하여 점수 계산 및 시트 생성까지 수행
        return saveProctorManualChanges(currentAssignments);

    } catch (e) {
        throw new Error("배정 중 오류: " + e.message);
    }
}

/**
 * [최종 수정] 정/부 감독 모드용 수동 배정 초기 데이터 로드
 */
function getInitialMainSubSwapData() {
    const scheduleData = getSavedScheduleData();
    if (!scheduleData) throw new Error("저장된 시험 정보가 없습니다.");
    
    let currentProctoringSlots = getProctorAssignments();
    if (!currentProctoringSlots || currentProctoringSlots.length === 0 || typeof currentProctoringSlots[0].isMain === 'undefined') {
        const { proctoringSlots } = createMainSubProctoringSlots(scheduleData, createExamSubjectMap(scheduleData));
        currentProctoringSlots = proctoringSlots;
    }

    const settings = getProctorSettings();
    const teachers = getTeacherProfiles(); 
    const examSubjectMap = createExamSubjectMap(scheduleData);
    const examDates = scheduleData.dates.map(d => formatDateToYYYYMMDD(d)).filter(Boolean);
    const periodCount = scheduleData.periods;
    const unavailabilityInfo = {};

    const roleKeywords = ['시간강사', '비교과','기타', '복도배치', '필수배치'];

    teachers.forEach(teacher => {
        examDates.forEach(date => {
            for (let p = 1; p <= periodCount; p++) {
          const key = `${teacher.name}-${date}-${p}`;
          
          // 통합 함수로 교체
          let reason = getSlotReasonText(teacher, date, p, examSubjectMap);

          if (reason) unavailabilityInfo[key] = reason;
        }
        });
    });

    // (이하 기존 로직 동일)
    teachers.forEach(t => { t.totalProctorScore = 0; });
    currentProctoringSlots.forEach(slot => {
        if (slot.assignedTeacher) {
            const teacher = teachers.find(t => t.name === slot.assignedTeacher);
            if (teacher) teacher.totalProctorScore++;
        }
    });
    
    const roomsData = {};
    currentProctoringSlots.forEach(slot => {
        const p = slot.period.toString();
        if (!roomsData[slot.room]) roomsData[slot.room] = {};
        if (!roomsData[slot.room][slot.date]) roomsData[slot.room][slot.date] = {};
        if (!roomsData[slot.room][slot.date][p]) roomsData[slot.room][slot.date][p] = {};
        roomsData[slot.room][slot.date][p][slot.isMain ? 'main' : 'sub'] = slot.assignedTeacher;
    });

    const { allRooms } = createMainSubProctoringSlots(scheduleData, examSubjectMap);
    const sortedRooms = Array.from(allRooms).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    return {
        proctoringSlots: roomsData,
        teachers: teachers,
        examDates: examDates,
        periodCount: periodCount,
        unavailabilityInfo: unavailabilityInfo,
        settings: settings,
        allRooms: sortedRooms,
        scheduleData: scheduleData,
        hallwayList: scheduleData.hallways || [],
        examSubjectMap: Object.entries(examSubjectMap).reduce((acc, [date, periods]) => {
            acc[date] = Object.entries(periods).reduce((pAcc, [p, s]) => { pAcc[p] = Array.from(s); return pAcc; }, {});
            return acc;
        }, {})
    };
}

/**
 * 수동 배정 변경사항을 저장하고 모든 시트를 다시 생성합니다.
 * v2: 동적 가중치를 사용해 감독 점수를 재계산하도록 수정
 * ✅ [수정] createResultSheets 호출 시 불필요한 getExclusionData() 인자 제거
 */
function saveProctorManualChanges(finalProctoringSlots) {
    try {
        if (!Array.isArray(finalProctoringSlots) || finalProctoringSlots.length === 0) throw new Error("잘못된 데이터 형식입니다.");
        
        const settings = getProctorSettings();
        const isMainSubSystem = typeof finalProctoringSlots[0].isMain !== 'undefined';
        const teachers = getTeacherProfiles();
        const scheduleData = getSavedScheduleData();
        const { allRooms } = isMainSubSystem ? createMainSubProctoringSlots(scheduleData, createExamSubjectMap(scheduleData)) : createProctoringSlots(scheduleData, createExamSubjectMap(scheduleData));
        
        teachers.forEach(t => { t.assignments = []; t.assignmentCount = 0; t.totalProctorScore = 0; });
        finalProctoringSlots.forEach(slot => {
            if (slot.assignedTeacher) {
                const teacher = teachers.find(t => t.name === slot.assignedTeacher);
                if (teacher) {
                    teacher.assignmentCount++;
                    if (isMainSubSystem) {
                        teacher.totalProctorScore++;
                        teacher.assignments.push({ date: slot.date, period: slot.period, room: slot.room, isMain: slot.isMain });
                    } else {
                        teacher.totalProctorScore += slot.isHallway ? settings.hallwayWeight : settings.classroomWeight;
                        teacher.assignments.push({ date: slot.date, period: slot.period, room: slot.room, isHallway: slot.isHallway });
                    }
                }
            }
        });
        
        saveProctorAssignments(finalProctoringSlots);
        
        if (isMainSubSystem) {
            createMainSubResultSheets(finalProctoringSlots, teachers, scheduleData, Array.from(allRooms));
        } else {
            createResultSheets(finalProctoringSlots, teachers, scheduleData, Array.from(allRooms));
        }
        
        return "변경사항이 성공적으로 저장되고 모든 시트에 반영되었습니다.";
    } catch (e) {
        throw new Error('수동 변경사항 저장 중 오류가 발생했습니다: ' + e.message);
    }
}

/**
 * 선택된 날짜와 양식 타입에 대한 일일 감독 시간표 시트를 생성합니다.
 * ✅ [수정] 기존 시트 재사용 시, 틀 고정을 확실히 해제하여 오류를 방지합니다.
 */
function generateDailySheets(selectedDates, sheetType) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const teacherSheetSource = ss.getSheetByName('교사별 전체 시간표') || ss.getSheetByName('교사별 전체 시간표 (정부)');
    const roomSheetSource = ss.getSheetByName('고사실별 전체 시간표') || ss.getSheetByName('고사실별 전체 시간표 (정부)');

    if (!teacherSheetSource || !roomSheetSource) {
        throw new Error('원본 시간표 시트("교사별 전체 시간표", "고사실별 전체 시간표")를 찾을 수 없습니다.');
    }

    const scheduleData = getSavedScheduleData();
    if (!scheduleData) throw new Error("저장된 시험 정보가 없습니다.");

    // 이전 버전의 흔적(getExclusionData)을 제거하고, getTeacherProfiles를 사용합니다.
    const teachers = getTeacherProfiles();
    const examSubjectMap = createExamSubjectMap(scheduleData);
    const periodCount = scheduleData.periods;
    const examDates = scheduleData.dates.map(d => formatDateToYYYYMMDD(d)).filter(Boolean);
    const isMainSubMode = roomSheetSource.getName().includes('(정부)');

    const teacherBodySource = teacherSheetSource.getDataRange().getDisplayValues().slice(2);
    const roomBodySource = roomSheetSource.getDataRange().getDisplayValues().slice(2);

    selectedDates.forEach(date => {
        const dateIndex = examDates.indexOf(date);
        if (dateIndex === -1) return;

        // --- 데이터 추출 ---
        const teacherStartCol = 2 + (dateIndex * periodCount);
        const dailyTeacherData = teacherBodySource.map(row => [row[1], ...row.slice(teacherStartCol, teacherStartCol + periodCount)]);

        let dailyRoomData;
        if (isMainSubMode) {
            const roomStartCol = 1 + (dateIndex * periodCount * 2);
            dailyRoomData = roomBodySource.map(row => {
                const roomName = row[0].startsWith("'") ? row[0].substring(1) : row[0];
                const periodData = [];
                for (let i = 0; i < periodCount; i++) {
                    periodData.push(row[roomStartCol + i * 2] || '');
                    periodData.push(row[roomStartCol + i * 2 + 1] || '');
                }
                return [roomName, ...periodData];
            });
        } else {
            const roomStartCol = 1 + (dateIndex * periodCount);
            dailyRoomData = roomBodySource.map(row => {
                const roomName = row[0].startsWith("'") ? row[0].substring(1) : row[0];
                return [roomName, ...row.slice(roomStartCol, roomStartCol + periodCount)];
            });
        }
        
        // --- 시트 이름 및 생성/초기화 ---
        const baseSheetName = formatDateToMDWeekday(date).replace(/\(.\)/, '');
        let sheetNameSuffix = '';
        if (sheetType === 'teacherOnly') sheetNameSuffix = ' (교사별)';
        else if (sheetType === 'roomOnly') sheetNameSuffix = ' (고사실별)';
        
        const sheetName = `${baseSheetName} 감독시간표${sheetNameSuffix}`;
        let targetSheet = ss.getSheetByName(sheetName);
        
        // ▼▼▼ 수정된 초기화 로직 ▼▼▼
        if (targetSheet) {
            targetSheet.clear(); // 내용 및 서식 삭제
            targetSheet.setFrozenRows(0); // 틀 고정 해제
            targetSheet.setFrozenColumns(0); // 틀 고정 해제
            targetSheet.clearConditionalFormatRules(); // 조건부 서식도 제거
        } else {
            targetSheet = ss.insertSheet(sheetName, ss.getSheets().length);
        }
        
        // --- 서식 적용 함수 호출 ---
        const formatInfo = {
            date, periodCount, scheduleData, isMainSubMode, 
            allTeachers: teachers, // getTeacherProfiles로 가져온 교사 정보 전달
            examSubjectMap,
            // excludedSlots, exclusionReasons 등 이전 방식 데이터 제거
            dailyTeacherData, dailyRoomData
        };
        formatDailySheetForPrinting(targetSheet, sheetType, formatInfo);
    });

    return true;
}

/**
 * 양식 타입에 따라 적절한 서식 적용 함수를 호출하는 디스패처 함수입니다.
 * v4
 */
function formatDailySheetForPrinting(sheet, sheetType, formatInfo) {
    switch(sheetType) {
        case 'teacherOnly':
            formatTeacherOnlySheet(sheet, formatInfo);
            break;
        case 'roomOnly':
            formatRoomOnlySheet(sheet, formatInfo);
            break;
        case 'combined':
        default:
            formatCombinedSheet(sheet, formatInfo);
            break;
    }
}

/**
 * [상세] 통합(교사별+고사실별) 양식의 서식을 적용합니다.
 * ✅ [수정] 감독 불가 사유 확인 시, allTeachers 배열과 teacher 객체의 속성을 사용하도록 로직을 수정합니다.
 */
function formatCombinedSheet(sheet, formatInfo) {
    // 1. formatInfo에서 사용하는 변수를 현재 구조에 맞게 수정합니다.
    const { date, periodCount, scheduleData, isMainSubMode, dailyTeacherData, dailyRoomData,
            allTeachers, examSubjectMap } = formatInfo;

    // --- 데이터 시트 쓰기 ---
    const dataStartRow = 4;
    const teacherTableStartCol = 1;
    const roomTableStartCol = periodCount + 3;
    if (dailyTeacherData.length > 0) sheet.getRange(dataStartRow, teacherTableStartCol, dailyTeacherData.length, dailyTeacherData[0].length).setValues(dailyTeacherData);
    if (dailyRoomData.length > 0) sheet.getRange(dataStartRow, roomTableStartCol, dailyRoomData.length, dailyRoomData[0].length).setValues(dailyRoomData);

    // --- 레이아웃 및 헤더 설정 ---
    const lastDataRow = sheet.getLastRow() > 3 ? sheet.getLastRow() : dataStartRow;
    const teacherTableEndCol = periodCount + 1;
    const roomTableWidth = isMainSubMode ? (periodCount * 2) + 1 : periodCount + 1;
    const roomTableEndCol = roomTableStartCol + roomTableWidth - 1;
    const totalCols = roomTableEndCol;

    const formattedDate = formatDateToMDWeekday(date);
    sheet.getRange(1, teacherTableStartCol, 1, teacherTableEndCol).merge().setValue(`${formattedDate} 교사별 감독시간표`);
    sheet.getRange(1, roomTableStartCol, 1, roomTableWidth).merge().setValue(`${formattedDate} 고사실별 감독시간표`);
    
    const subjectHeader = ['과목', ...Array.from({length: periodCount}, (_, i) => getUniqueSubjectsForPeriod(scheduleData, date, i + 1))];
    sheet.getRange(2, teacherTableStartCol, 1, periodCount + 1).setValues([['교사명', ...Array.from({length: periodCount}, (_, i) => `${i + 1}교시`)]]);
    sheet.getRange(3, teacherTableStartCol, 1, subjectHeader.length).setValues([subjectHeader]);

    if (isMainSubMode) {
        const roomPeriodHeaderTop = ['고사실'], roomPeriodHeaderSub = [''];
        for (let p = 1; p <= periodCount; p++) {
            roomPeriodHeaderTop.push(`${p}교시`, '');
            roomPeriodHeaderSub.push('정감독', '부감독');
        }
        sheet.getRange(2, roomTableStartCol, 1, roomPeriodHeaderTop.length).setValues([roomPeriodHeaderTop]);
        sheet.getRange(3, roomTableStartCol, 1, roomPeriodHeaderSub.length).setValues([roomPeriodHeaderSub]);
        sheet.getRange(2, roomTableStartCol, 2, 1).mergeVertically();
        for(let i=0; i < periodCount; i++) sheet.getRange(2, roomTableStartCol + 1 + i*2, 1, 2).mergeAcross();
    } else {
        sheet.getRange(2, roomTableStartCol, 1, periodCount + 1).setValues([['고사실', ...Array.from({length: periodCount}, (_, i) => `${i + 1}교시`)]]);
        sheet.getRange(3, roomTableStartCol, 1, subjectHeader.length).setValues([subjectHeader]);
    }

    // --- 공통 서식 적용 ---
    const FONT_FAMILY = 'Noto Sans KR', TITLE_BG = '#434343', TITLE_FONT_COLOR = '#FFFFFF';
    const BORDER_COLOR_OUTER = '#000000', BORDER_COLOR_INNER = '#000000';
    const BORDER_STYLE_OUTER = SpreadsheetApp.BorderStyle.SOLID_MEDIUM, BORDER_STYLE_INNER = SpreadsheetApp.BorderStyle.DOTTED;
    const blueTheme = { bg: '#EAF1F7', font: '#1A3353' }, redTheme = { bg: '#F7EAEA', font: '#B30000' };

    sheet.getRange(1, 1, lastDataRow, totalCols).setFontFamily(FONT_FAMILY).setVerticalAlignment('middle').setHorizontalAlignment('center');
    sheet.getRange(1, 1, 1, totalCols).setBackground(TITLE_BG).setFontColor(TITLE_FONT_COLOR).setFontWeight('bold').setFontSize(16);
    
    const tables = [
        { startCol: teacherTableStartCol, endCol: teacherTableEndCol, theme: blueTheme },
        { startCol: roomTableStartCol, endCol: roomTableEndCol, theme: redTheme }
    ];
    tables.forEach(table => {
        const tableRange = sheet.getRange(1, table.startCol, lastDataRow, table.endCol - table.startCol + 1);
        tableRange.setBorder(true, true, true, true, false, false, BORDER_COLOR_OUTER, BORDER_STYLE_OUTER).setBorder(null, null, null, null, true, true, BORDER_COLOR_INNER, BORDER_STYLE_INNER);
        const headerRange = sheet.getRange(2, table.startCol, 2, table.endCol - table.startCol + 1);
        headerRange.setBackground(table.theme.bg).setFontColor(table.theme.font).setFontWeight('bold').setFontSize(12);
        sheet.getRange(3, table.startCol).clearContent();
        sheet.getRange(2, table.startCol, 2, 1).mergeVertically();
    });

    // --- 감독 불가 사유 서식 적용 ---
    if (lastDataRow >= dataStartRow) {
        sheet.getRange(dataStartRow, 1, lastDataRow - dataStartRow + 1, totalCols).setFontSize(11);
        const teacherDataRange = sheet.getRange(dataStartRow, teacherTableStartCol, lastDataRow - dataStartRow + 1, periodCount + 1);
        const teacherValues = teacherDataRange.getDisplayValues();
        const backgroundColors = [], fontColors = [];
        
        teacherValues.forEach(row => {
            const teacherName = row[0];
            const teacher = allTeachers.find(t => t.name === teacherName);
            const rowBackgrounds = [null], rowFontColors = [null]; // '교사명' 열에 대한 서식
            
            for (let p = 1; p <= periodCount; p++) {
                let reason = '';
                // teacher 객체를 찾았을 경우에만 사유를 확인
                if (teacher) {
                    const subjectsThisPeriod = examSubjectMap[date]?.[p];
                    const teacherSubjects = normalizeSubjects(teacher.subject);
                    const hasConflictingSubject = subjectsThisPeriod && teacher.subject && teacherSubjects.some(ts => subjectsThisPeriod.has(ts));

                    // 2. 새로운 방식으로 사유를 확인합니다.
                    if (hasConflictingSubject) {
                        reason = '교과시험';
                    } else if (teacher.exclusions[date] && teacher.exclusions[date].includes(p)) {
                        reason = teacher.exclusionReason || '제외됨'; // teacher 객체에서 직접 사유를 읽음
                    } else if (teacher.notesReason) {
                        if (teacher.availability && teacher.availability['all-unavailable']) {
                            reason = teacher.notesReason;
                        } else if (teacher.isPartiallyAvailable) {
                            if (!teacher.availability[date] || !teacher.availability[date].includes(p)) {
                                reason = teacher.notesReason;
                            }
                        }
                    }
                }
                
                // 셀의 내용이 확인된 사유와 일치할 경우에만 서식을 적용
                if (reason && row[p] === reason) {
                    rowBackgrounds.push('#f3f3f3'); 
                    rowFontColors.push('#808080');
                } else {
                    rowBackgrounds.push(null); 
                    rowFontColors.push(null);
                }
            }
            backgroundColors.push(rowBackgrounds);
            fontColors.push(rowFontColors);
        });
        
        if (backgroundColors.length > 0) {
            teacherDataRange.setBackgrounds(backgroundColors).setFontColors(fontColors);
        }
    }
    
    // --- 최종 크기 및 정리 ---
    const dividerCol = periodCount + 2;
    for(let i = 1; i <= totalCols; i++) { if (i !== dividerCol) sheet.setColumnWidth(i, 120); }
    sheet.setRowHeight(1, 60);
    sheet.setRowHeights(2, 2, 30);
    for (let i = dataStartRow; i <= lastDataRow; i++) sheet.setRowHeight(i, 28);
    sheet.setColumnWidth(dividerCol, 20);
    if (lastDataRow > 0) sheet.getRange(1, dividerCol, lastDataRow, 1).clear({formatOnly: true, contentsOnly: true});

    const maxRows = sheet.getMaxRows(); 
    if (lastDataRow > 0 && lastDataRow < maxRows) sheet.deleteRows(lastDataRow + 1, maxRows - lastDataRow);
    const maxCols = sheet.getMaxColumns(); 
    if (totalCols > 0 && totalCols < maxCols) sheet.deleteColumns(totalCols + 1, maxCols - totalCols);
    sheet.activate();
}

/**
 * [상세] 교사별 시간표 양식의 서식을 적용합니다. (확대 버전)
 * ✅ [수정] 감독 불가 사유 확인 시, allTeachers 배열과 teacher 객체의 속성을 사용하도록 로직을 수정합니다.
 */
function formatTeacherOnlySheet(sheet, formatInfo) {
    // 1. formatInfo에서 사용하는 변수를 현재 구조에 맞게 수정합니다.
    const { date, periodCount, scheduleData, dailyTeacherData,
            allTeachers, examSubjectMap } = formatInfo;
    
    const dataStartRow = 4;
    if (dailyTeacherData.length > 0) {
        sheet.getRange(dataStartRow, 1, dailyTeacherData.length, dailyTeacherData[0].length).setValues(dailyTeacherData);
    }
    
    const lastDataRow = sheet.getLastRow() > 3 ? sheet.getLastRow() : dataStartRow;
    const totalCols = periodCount + 1;
    const formattedDate = formatDateToMDWeekday(date);
    
    const subjectHeader = ['', ...Array.from({length: periodCount}, (_, i) => getUniqueSubjectsForPeriod(scheduleData, date, i + 1))];
    sheet.getRange(1, 1, 1, totalCols).merge().setValue(`${formattedDate} 교사별 감독 시간표`);
    sheet.getRange(2, 1, 1, totalCols).setValues([['교사명', ...Array.from({length: periodCount}, (_, i) => `${i + 1}교시`)]]);
    sheet.getRange(3, 1, 1, subjectHeader.length).setValues([subjectHeader]);
    
    const FONT_FAMILY = 'Noto Sans KR', HEADER_BG = '#434343', HEADER_FONT = '#FFFFFF', SUB_HEADER_BG = '#EAF1F7';
    const BORDER_COLOR = '#000000', BORDER_STYLE = SpreadsheetApp.BorderStyle.DOTTED;

    sheet.getRange(1, 1, lastDataRow, totalCols).setFontFamily(FONT_FAMILY).setVerticalAlignment('middle').setHorizontalAlignment('center');
    sheet.getRange(1, 1, 1, totalCols).setBackground(HEADER_BG).setFontColor(HEADER_FONT).setFontWeight('bold').setFontSize(22);
    sheet.getRange(2, 1, 1, totalCols).setBackground(SUB_HEADER_BG).setFontWeight('bold').setFontSize(14);
    sheet.getRange(3, 1, 1, totalCols).setBackground(SUB_HEADER_BG);
    sheet.getRange(1, 1, lastDataRow, totalCols).setBorder(true, true, true, true, true, true, BORDER_COLOR, BORDER_STYLE);
    
    sheet.getRange(2, 1, 2, 1).mergeVertically();
    sheet.getRange(3, 2, 1, periodCount).setFontSize(12).setFontWeight('bold');
    
    if (lastDataRow >= dataStartRow) {
        sheet.getRange(dataStartRow, 1, lastDataRow - dataStartRow + 1, totalCols).setFontSize(12);
        const teacherDataRange = sheet.getRange(dataStartRow, 1, lastDataRow - dataStartRow + 1, totalCols);
        const teacherValues = teacherDataRange.getDisplayValues();
        const backgroundColors = [], fontColors = [];

        teacherValues.forEach(row => {
            const teacherName = row[0];
            const teacher = allTeachers.find(t => t.name === teacherName);
            const rowBackgrounds = [null], rowFontColors = [null]; // '교사명' 열에 대한 서식

            for (let p = 1; p <= periodCount; p++) {
                let reason = '';
                // teacher 객체를 찾았을 경우에만 사유를 확인
                if (teacher) {
                    const subjectsThisPeriod = examSubjectMap[date]?.[p];
                    const teacherSubjects = normalizeSubjects(teacher.subject);
                    const hasConflictingSubject = subjectsThisPeriod && teacher.subject && teacherSubjects.some(ts => subjectsThisPeriod.has(ts));

                    // 2. 새로운 방식으로 사유를 확인합니다.
                    if (hasConflictingSubject) {
                        reason = '교과시험';
                    } else if (teacher.exclusions[date] && teacher.exclusions[date].includes(p)) {
                        reason = teacher.exclusionReason || '제외됨'; // teacher 객체에서 직접 사유를 읽음
                    } else if (teacher.notesReason) {
                        if (teacher.availability && teacher.availability['all-unavailable']) {
                            reason = teacher.notesReason;
                        } else if (teacher.isPartiallyAvailable) {
                            if (!teacher.availability[date] || !teacher.availability[date].includes(p)) {
                                reason = teacher.notesReason;
                            }
                        }
                    }
                }

                // 셀의 내용이 확인된 사유와 일치할 경우에만 서식을 적용
                if (reason && row[p] === reason) {
                    rowBackgrounds.push('#f3f3f3');
                    rowFontColors.push('#808080');
                } else {
                    rowBackgrounds.push(null);
                    rowFontColors.push(null);
                }
            }
            backgroundColors.push(rowBackgrounds);
            fontColors.push(rowFontColors);
        });

        if (backgroundColors.length > 0) {
            teacherDataRange.setBackgrounds(backgroundColors).setFontColors(fontColors);
        }
    }
    
    sheet.setColumnWidths(1, totalCols, 200);
    sheet.setRowHeight(1, 60);
    sheet.setRowHeight(2, 30);
    sheet.setRowHeight(3, 20);
    for (let i = dataStartRow; i <= lastDataRow; i++) {
        sheet.setRowHeight(i, 25);
    }

    const maxRows = sheet.getMaxRows();
    if (lastDataRow > 0 && lastDataRow < maxRows) sheet.deleteRows(lastDataRow + 1, maxRows - lastDataRow);
    const maxCols = sheet.getMaxColumns();
    if (totalCols > 0 && totalCols < maxCols) sheet.deleteColumns(totalCols + 1, maxCols - totalCols);
    sheet.activate();
}

/**
 * [상세] 고사실별 시간표 양식의 서식을 적용합니다. (확대 버전)
 * v3 - 정감독/부감독 헤더 및 과목명 병합 추가 수정 및 일반 모드 처리 개선
 */
function formatRoomOnlySheet(sheet, formatInfo) {
    const { date, periodCount, scheduleData, isMainSubMode, dailyRoomData } = formatInfo;

    // --- 0. dataStartRow 동적 결정 ---
    // isMainSubMode (정/부감독 모드)일 경우 4행에 정/부감독 헤더가 들어가므로 데이터는 5행부터 시작
    // 일반 모드일 경우 3행에 과목명이 들어가고 데이터는 4행부터 시작
    const dataStartRow = isMainSubMode ? 5 : 4; 

    // --- 1. 데이터 시트 쓰기 ---
    if (dailyRoomData.length > 0) sheet.getRange(dataStartRow, 1, dailyRoomData.length, dailyRoomData[0].length).setValues(dailyRoomData);
    
    // --- 2. 레이아웃 및 헤더 설정 ---
    // lastDataRow 기준도 dataStartRow에 맞춰 동적으로 변경
    const lastDataRow = sheet.getLastRow() > (dataStartRow - 1) ? sheet.getLastRow() : dataStartRow;
    const totalCols = 1 + (isMainSubMode ? periodCount * 2 : periodCount);
    const formattedDate = formatDateToMDWeekday(date);
    
    sheet.getRange(1, 1, 1, totalCols).merge().setValue(`${formattedDate} 고사실별 감독 시간표`);
    
    const subjectHeader = ['과목', ...Array.from({length: periodCount}, (_, i) => getUniqueSubjectsForPeriod(scheduleData, date, i + 1))];
    
    if (isMainSubMode) {
        // 정/부감독 모드 (이전 수정 코드 그대로 유지)
        const roomPeriodHeaderTop = ['고사실'], roomPeriodHeaderSub = ['']; // roomPeriodHeaderSub는 현재 사용되지 않음
        const directorHeaderRow = ['']; // 4행에 들어갈 정감독/부감독 헤더 배열

        for (let p = 1; p <= periodCount; p++) {
            roomPeriodHeaderTop.push(`${p}교시`, ''); 
            directorHeaderRow.push('정감독', '부감독');
        }
        
        // 2행: 교시 헤더 설정 및 병합
        sheet.getRange(2, 1, 1, roomPeriodHeaderTop.length).setValues([roomPeriodHeaderTop]);
        sheet.getRange(2, 1, 1, totalCols).breakApart(); // Clear previous merge
        for(let i=0; i < periodCount; i++) sheet.getRange(2, 2 + i*2, 1, 2).mergeAcross(); // '1교시', '2교시' 병합

        // 3행: 과목명 헤더 설정 및 병합
        let subjectHeaderForRoom = ['']; 
        subjectHeader.slice(1).forEach(sub => subjectHeaderForRoom.push(sub, ''));
        sheet.getRange(3, 1, 1, subjectHeaderForRoom.length).setValues([subjectHeaderForRoom]);
        
        // 과목명 셀 병합 추가
        for(let i=0; i < periodCount; i++) {
            sheet.getRange(3, 2 + i*2, 1, 2).mergeAcross();
        }

        // 4행: 정감독, 부감독 헤더 설정
        sheet.getRange(4, 1, 1, directorHeaderRow.length).setValues([directorHeaderRow]);

        // '고사실' 셀 수직 병합 (2행부터 4행까지 병합)
        sheet.getRange(2, 1, 3, 1).mergeVertically(); 
    } else {
        // 일반 모드 (수정된 부분)
        // 2행: 고사실 + 교시 헤더
        sheet.getRange(2, 1, 1, periodCount + 1).setValues([['고사실', ...Array.from({length: periodCount}, (_, i) => `${i + 1}교시`)]]);
        
        // 3행: 과목명 헤더
        sheet.getRange(3, 1, 1, subjectHeader.length).setValues([subjectHeader]);
        
        // '고사실' 셀 수직 병합 (2행부터 3행까지 병합)
        sheet.getRange(2, 1, 2, 1).mergeVertically();
        
           }
    
    // --- 3. 공통 서식 적용 ---
    const FONT_FAMILY = 'Noto Sans KR', HEADER_BG = '#434343', HEADER_FONT = '#FFFFFF', SUB_HEADER_BG = '#F7EAEA';
    const BORDER_COLOR = '#000000', BORDER_STYLE = SpreadsheetApp.BorderStyle.DOTTED;

    sheet.getRange(1, 1, lastDataRow, totalCols).setFontFamily(FONT_FAMILY).setVerticalAlignment('middle').setHorizontalAlignment('center');
    sheet.getRange(1, 1, 1, totalCols).setBackground(HEADER_BG).setFontColor(HEADER_FONT).setFontWeight('bold').setFontSize(22);
    sheet.getRange(2, 1, 1, totalCols).setBackground(SUB_HEADER_BG).setFontWeight('bold').setFontSize(14);
    sheet.getRange(3, 1, 1, totalCols).setBackground(SUB_HEADER_BG);
    if (isMainSubMode) {
        sheet.getRange(4, 1, 1, totalCols).setBackground(SUB_HEADER_BG).setFontSize(10); // 정/부감독 행 서식
    }
    
    // 과목명 서식 적용
    // 일반 모드에서는 과목명이 3행의 2열부터 시작하고, 각 교시당 1칸이므로 range 범위 수정
    const subjectHeaderRange = isMainSubMode ? sheet.getRange(3, 2, 1, totalCols - 1) : sheet.getRange(3, 2, 1, periodCount);
    subjectHeaderRange.setFontSize(12).setFontWeight('bold');

    sheet.getRange(1, 1, lastDataRow, totalCols).setBorder(true, true, true, true, true, true, BORDER_COLOR, BORDER_STYLE);
    
    const dataRange = sheet.getRange(dataStartRow, 1, lastDataRow - dataStartRow + 1, totalCols);
    dataRange.setFontSize(12);
    const rule = SpreadsheetApp.newConditionalFormatRule().whenCellEmpty().setBackground("#FFCCCC").setRanges([dataRange]).build();
    sheet.setConditionalFormatRules([rule]);
    
    // --- 4. 최종 크기 및 정리 ---
    if (isMainSubMode) {
        sheet.setColumnWidths(1, totalCols, 150); // 정/부감독 모드일 때 열 너비 150
    } else {
        sheet.setColumnWidths(1, totalCols, 200); // 일반 모드일 때 열 너비 200
    }
    sheet.setRowHeight(1, 60);
    sheet.setRowHeight(2, 30);
    sheet.setRowHeight(3, 20); // 과목명 행 높이
    if (isMainSubMode) {
        sheet.setRowHeight(4, 20); // 정감독/부감독 행 높이
    }
    // 데이터 행 높이 설정 (dataStartRow를 기준으로 루프 시작)
    for (let i = dataStartRow; i <= lastDataRow; i++) sheet.setRowHeight(i, 25);

    const maxRows = sheet.getMaxRows(); 
    if (lastDataRow < maxRows) sheet.deleteRows(lastDataRow + 1, maxRows - lastDataRow);
    const maxCols = sheet.getMaxColumns(); 
    if (totalCols < maxCols) sheet.deleteColumns(totalCols + 1, maxCols - totalCols);
    sheet.activate();
}


/**
 * 선택된 날짜와 양식에 해당하는 시트를 찾아 새 스프레드시트 파일로 생성합니다.
 * v3: sheetType 인자를 받아 정확한 시트만 찾도록 로직 수정
 */
function createNewSpreadsheetFromSheets(selectedDates, sheetType) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetsToCopy = [];

    // 1. sheetType에 따라 시트 이름의 접미사를 결정합니다.
    let sheetSuffix = '';
    if (sheetType === 'teacherOnly') {
        sheetSuffix = ' (교사별)';
    } else if (sheetType === 'roomOnly') {
        sheetSuffix = ' (고사실별)';
    }
    // 'combined'의 경우 접미사가 없습니다.

    // 2. 각 날짜에 대해 정확한 이름의 시트를 찾습니다.
    selectedDates.forEach(dateString => {
        const dateMDW = formatDateToMDWeekday(dateString);
        const baseName = dateMDW.replace(/\(.\)/, ''); // '7.7' 과 같은 형식
        
        // 찾으려는 정확한 시트 이름을 조합합니다.
        const sheetNameToFind = `${baseName} 감독시간표${sheetSuffix}`;
        const sheet = ss.getSheetByName(sheetNameToFind);
        
        // 새 파일에 생성될 시트의 이름 (접미사 없음)
        const desiredSheetName = `${dateMDW} 감독시간표`;

        if (sheet) {
            sheetsToCopy.push({ sheet: sheet, desiredName: desiredSheetName });
        }
    });
    
    if (sheetsToCopy.length === 0) {
        // 오류 메시지를 더 구체적으로 변경합니다.
        throw new Error('새 스프레드시트로 만들 시트가 없습니다. 선택한 양식과 일치하는 시트가 현재 파일에 존재하는지 확인해주세요.');
    }
    
    let newSpreadsheetFileName = sheetsToCopy.length === 1 ? sheetsToCopy[0].desiredName : `${sheetsToCopy[0].desiredName} 외 ${sheetsToCopy.length - 1}개`;
    const newSpreadsheet = SpreadsheetApp.create(newSpreadsheetFileName);
    let firstCopiedSheet = null;

    sheetsToCopy.forEach((sheetInfo, index) => {
        const copiedSheet = sheetInfo.sheet.copyTo(newSpreadsheet);
        copiedSheet.setName(sheetInfo.desiredName);
        if (index === 0) {
            firstCopiedSheet = copiedSheet;
        }
    });

    const allSheetsInNewSS = newSpreadsheet.getSheets();
    if (allSheetsInNewSS.length > sheetsToCopy.length) {
        try { newSpreadsheet.deleteSheet(allSheetsInNewSS[0]); } catch(e) {}
    }

    if (firstCopiedSheet) {
        const sheetToActivate = newSpreadsheet.getSheetByName(firstCopiedSheet.getName());
        if (sheetToActivate) {
            newSpreadsheet.setActiveSheet(sheetToActivate);
        }
    }
    
    return { 
        url: newSpreadsheet.getUrl(), 
        name: newSpreadsheetFileName 
    };
}

// ===============================================================
// --- 기타 유틸리티 함수 ---
// ===============================================================

/**
 * [통합 판별 함수] 시트와 UI가 100% 동일한 기준으로 사유를 출력하도록 통합합니다.
 */
function getSlotReasonText(teacher, date, period, examSubjectMap) {
    const roleKeywords = ['시간강사', '비교과', '복도배치', '필수배치']; // 순회 제외, 기타 추가 유지
    
    // 1. 교과 시험 충돌
    const subjectsThisPeriod = examSubjectMap[date]?.[period];
    const teacherSubjects = normalizeSubjects(teacher.subject);
    if (subjectsThisPeriod && teacher.subject && teacherSubjects.some(ts => subjectsThisPeriod.has(ts))) {
        return '교과시험';
    }
    
    // 2. 수동 제외 교시
    if (teacher.exclusions[date] && teacher.exclusions[date].includes(parseInt(period))) {
        return teacher.exclusionReason || '제외됨';
    }
    
    // 3. 달력(가능날짜) 상의 불가 여부 확인
    let isUnavailable = false;
    if (teacher.availability && teacher.availability['all-unavailable']) {
        isUnavailable = true;
    } else if (teacher.isPartiallyAvailable) {
        if (!teacher.availability[date] || !teacher.availability[date].includes(parseInt(period))) {
            isUnavailable = true;
        }
    }
    
    // 4. 감독 불가 상태일 경우 사유 반환
    if (isUnavailable) {
        // 불가 상태인데 비고란에 시간강사, 기타 등이 적혀있으면 '감독불가'로 마스킹
        if (teacher.notesReason && roleKeywords.some(k => teacher.notesReason.includes(k))) {
            return '감독불가';
        }
        // 그 외(순회, 병가 등)는 비고 내용을 그대로 노출 (비고가 없으면 '감독불가')
        return teacher.notesReason || '감독불가';
    }
    
    // 5. ✅ [핵심 수정] 감독 가능 상태인 경우 비고란 내용에 상관없이 무조건 빈 문자열 반환
    // (이 부분이 있어야 배정 가능한 칸이 막히지 않고 정상적으로 작동합니다)
    return '';
}

/**
 * @description 지정된 스프레드시트 파일에서 교사별 배정 점수를 추출하여 반환합니다.
 * @param {string} fileId 점수를 추출할 스프레드시트 파일의 ID
 * @returns {object} { "교사명": 점수, ... } 형태의 객체
 */
function getScoresFromArchivedFile(fileId) {
    if (!fileId) {
        throw new Error("파일 ID가 제공되지 않았습니다.");
    }
    try {
        const targetSs = SpreadsheetApp.openById(fileId);
        // '정부' 모드 시트가 있을 수 있으므로 우선적으로 찾고, 없으면 일반 시트를 찾습니다.
        let teacherSheet = targetSs.getSheetByName('교사별 전체 시간표 (정부)') || targetSs.getSheetByName('교사별 전체 시간표');

        if (!teacherSheet) {
            throw new Error("'교사별 전체 시간표' 시트를 찾을 수 없습니다.");
        }

        const data = teacherSheet.getDataRange().getValues();
        const headers = data[1]; // 두 번째 행에 실제 헤더(순, 교사명, 1교시...)가 있음
        const nameColIndex = headers.indexOf('교사명');
        const scoreColIndex = headers.indexOf('배정점수');

        if (nameColIndex === -1 || scoreColIndex === -1) {
            throw new Error("'교사명' 또는 '배정점수' 열을 찾을 수 없습니다.");
        }

        const scores = {};
        // 3번째 행부터 실제 데이터 시작
        for (let i = 2; i < data.length; i++) {
            const row = data[i];
            const teacherName = row[nameColIndex];
            const score = row[scoreColIndex];
            if (teacherName) {
                scores[teacherName.toString().trim()] = score;
            }
        }
        return scores;

    } catch (e) {
        // 오류 메시지를 클라이언트로 전파하기 위해 다시 throw
        throw new Error("점수 추출 중 오류 발생: " + e.message);
    }
}




/**
 * @description PropertiesService에 임시로 저장된 이전 점수 데이터를 가져옵니다.
 * @returns {object | null} 저장된 점수 객체 또는 null
 */
function getTemporaryScores() {
    const tempScores = PropertiesService.getDocumentProperties().getProperty('temp_previous_scores');
    if (tempScores) {
        // 데이터를 가져온 후에는 삭제하여 다음 실행에 영향을 주지 않도록 합니다.
        PropertiesService.getDocumentProperties().deleteProperty('temp_previous_scores');
        return JSON.parse(tempScores);
    }
    return null;
}

/**
 * @description PropertiesService의 임시 점수 데이터를 삭제합니다.
 */
function deleteTemporaryScores() {
    PropertiesService.getDocumentProperties().deleteProperty('temp_previous_scores');
}




/**
 * @description 파일 ID를 받아 점수를 추출하고 ScriptProperties에 임시 저장합니다.
 * @param {string} fileId 점수를 추출할 스프레드시트 파일의 ID
 */
function saveScoresToTemporaryProperty(fileId) {
    const scores = getScoresFromArchivedFile(fileId); // 이미 만들어 둔 함수 재사용
    if (scores) {
        PropertiesService.getDocumentProperties().setProperty('temp_previous_scores', JSON.stringify(scores));
    }
}



function normalizeSubjects(subjectString) {
    if (!subjectString) return [];
    return subjectString.split(/[/,·・,，、]/).map(s => s.trim()).filter(Boolean).map(s => s.replace(/\s/g, '').toLowerCase());
}

function formatDateToYYYYMMDD(date) {
    if (typeof date === 'string') date = new Date(date);
    if (!(date instanceof Date) || isNaN(date)) return null;
    const year = date.getFullYear(), month = (date.getMonth() + 1).toString().padStart(2, '0'), day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateToMDWeekday(dateString) {
    const dateObj = new Date(dateString);
    if (isNaN(dateObj)) return dateString;
    const month = dateObj.getMonth() + 1, day = dateObj.getDate(), weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    return `${month}.${day}(${weekdays[dateObj.getDay()]})`;
}

function getUniqueSubjectsForPeriod(scheduleData, date, period) {
  const uniqueSubjects = new Set();
  // ✅ new Date() 이중 감싸기 제거
  const formattedDate = formatDateToYYYYMMDD(date);
  const periodSubjects = scheduleData.subjects[formattedDate]?.[`period${period}`];

  if (!periodSubjects) return '';

  for (let g = 1; g <= 3; g++) {
    let subjectList = periodSubjects[`grade${g}`];
    if (subjectList) {
      if (!Array.isArray(subjectList)) {
        subjectList = typeof subjectList === 'object' ? [subjectList] : [{name: subjectList, rooms: null}];
      }

      subjectList.forEach(sub => {
        // ✅ "none"(전체해제)이면 헤더에도 표시 안 함
        if (sub.name
            && sub.rooms !== 'none'
            && (sub.rooms === null || (Array.isArray(sub.rooms) && sub.rooms.length > 0))) {
          sub.name.split(/[,/]/).forEach(s => {
            if (s.trim()) uniqueSubjects.add(s.trim());
          });
        }
      });
    }
  }

  return Array.from(uniqueSubjects).join(', ');
}


// ===== [신규] 정/부 모드 단독 고사실 흐름 =====

/**
 * [연결 함수] 세부설정 저장 후, 정/부 모드면 '단독 고사실 설정' 창을 연다.
 * - SettingsUI의 saveSettings()가 호출.
 * - "show_subproctor_ui" 반환 시 SettingsUI는 스스로 닫히고 단독설정창이 뜸.
 * - "done" 반환 시 일반 모드로 간주하여 기존처럼 배정 여부를 묻는다.
 */
function saveSettingsAndCheckNextStep(settings) {
  try {
    saveProctorSettings(settings);
    if (settings.useMainSubProctoring) {
      showSubProctorSettingDialog();
      return "show_subproctor_ui";
    }
    return "done";
  } catch (e) {
    throw new Error('설정 저장 또는 다음 단계 진행 중 오류가 발생했습니다: ' + e.message);
  }
}

/**
 * [신규] 단독 감독 고사실 설정 모달을 연다.
 * ⚠️ createHtmlOutputFromFile 의 파일명은 실제 Apps Script 파일명과 정확히 일치해야 함.
 */
function showSubProctorSettingDialog() {
  const html = HtmlService.createHtmlOutputFromFile('SubProctorSettingUI') // ← 실제 파일명으로 교체
    .setWidth(800)
    .setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, '단독 감독 고사실 설정');
}

/**
 * [신규] 단독 고사실 설정 UI에 보낼 데이터.
 * - rooms: 정/부 모드에서 시험이 열리는 전체 고사실(정렬됨)
 * - singleRooms: 기존에 저장된 단독 고사실 목록(체크 상태 복원용)
 */
function getRoomsForSubProctorSetting() {
  const scheduleData = getSavedScheduleData();
  if (!scheduleData) throw new Error("저장된 시험 정보가 없습니다. 시험 일정을 먼저 설정하세요.");

  const examDataByDatePeriod = {};
  const examDates = scheduleData.dates.map(d => formatDateToYYYYMMDD(d)).filter(Boolean);

  examDates.forEach(date => {
    examDataByDatePeriod[date] = {};
    const periodsForDate = scheduleData.datePeriods
      ? (scheduleData.datePeriods[date] || scheduleData.periods)
      : scheduleData.periods;

    for (let p = 1; p <= periodsForDate; p++) {
      const roomsInPeriod = new Set();
      const subjectsInPeriod = scheduleData.subjects[date]?.[`period${p}`];
      let hasExamInPeriod = false;

      if (subjectsInPeriod) {
        for (let g = 1; g <= 3; g++) {
          let subList = subjectsInPeriod[`grade${g}`];
          if (subList) {
            if (!Array.isArray(subList)) {
              subList = typeof subList === 'object' ? [subList] : [{name: subList, rooms: null}];
            }

            subList.forEach(sub => {
              if (!sub.name || sub.name.trim() === '') return;

              // ✅ "none" 또는 배열이 아닌 값이면 제외
              if (sub.rooms === 'none') return;
              if (sub.rooms !== null && !Array.isArray(sub.rooms)) return;

              hasExamInPeriod = true;

              const globalRooms = scheduleData[`grade${g}Rooms`] || [];
              // ✅ null → 전체선택, 배열 → 일부선택
              const targetRooms = (sub.rooms === null) ? globalRooms : sub.rooms;

              // ✅ targetRooms가 배열인지 최종 확인
              if (!Array.isArray(targetRooms)) return;

              targetRooms.forEach(r => {
                const rn = String(r).trim();
                if (rn !== '') roomsInPeriod.add(rn);
              });
            });
          }
        }
      }

      if (hasExamInPeriod) {
        (scheduleData.specialRooms || []).forEach(r => {
          const rn = String(r).trim();
          if (rn !== '') roomsInPeriod.add(rn);
        });
      }

      if (roomsInPeriod.size > 0) {
        const sortedRooms = Array.from(roomsInPeriod).sort((a, b) => {
          const isClassA = a.match(/^\d+-\d+$/), isClassB = b.match(/^\d+-\d+$/);
          if (isClassA && !isClassB) return -1;
          if (!isClassA && isClassB) return 1;
          if (isClassA && isClassB) {
            const pA = a.split('-').map(Number), pB = b.split('-').map(Number);
            return pA[0] !== pB[0] ? pA[0] - pB[0] : pA[1] - pB[1];
          }
          return a.localeCompare(b);
        });
        examDataByDatePeriod[date][p] = sortedRooms;
      }
    }
  });

  return { examData: examDataByDatePeriod, singleRooms: getSingleProctorRooms() };
}

/** 
 * [개편] 저장된 단독 고사실 목록 읽기 (배열이 아닌 객체 반환) 
 */
function getSingleProctorRooms() {
  const saved = PropertiesService.getDocumentProperties().getProperty('singleProctorRooms');
  return saved ? JSON.parse(saved) : {};
}


/**
 * [신규] 단독 고사실 저장 + 곧바로 정/부 감독 배정 실행.
 * - Subproctorsetting UI의 saveSettings()가 호출.
 * - 여기서 슬롯 생성 → 배정 → 시트 생성까지 끝난 뒤 결과 메시지를 반환.
 */
function saveSingleProctorRooms(selectedSingleRooms) {
  try {
    // 다차원 객체를 그대로 문자열로 저장
    PropertiesService.getDocumentProperties()
      .setProperty('singleProctorRooms', JSON.stringify(selectedSingleRooms || {}));
    return "done";
  } catch (e) {
    throw new Error('단독 고사실 설정 저장 중 오류가 발생했습니다: ' + e.message);
  }
}

function getTimetableData(scheduleData, teachers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('시간표');
  if (!sheet) return {};

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};

  const timetable = {};
  const teacherLookup = {};

  teachers.forEach(t => {
    if (!t.name) return;
    const shortName = t.name.substring(0, 2);
    if (!teacherLookup[shortName]) teacherLookup[shortName] = [];
    teacherLookup[shortName].push(t);
  });

  const examDates = (scheduleData.dates || [])
    .map(d => formatDateToYYYYMMDD(d))
    .filter(Boolean);

  let colDateMap = {};

  for (let i = 0; i < data.length; i++) {
    const row = data[i];

    // ✅ 헤더행 감지: B열 이후에 "월(29)", "화(30)" 등 요일 패턴
    const isHeaderRow = row.slice(1).some(cell =>
      /^[월화수목금토일]\(\d+\)$/.test(String(cell).trim())
    );

    if (isHeaderRow) {
      colDateMap = {};
      for (let j = 1; j < row.length; j++) {
        const header = String(row[j]).trim();
        const match = header.match(/\((\d+)\)/);
        if (!match) continue;
        const day = match[1].padStart(2, '0');
        const matchedDate = examDates.find(d => d.endsWith('-' + day));
        if (matchedDate) colDateMap[j] = matchedDate;
      }
      continue;
    }

    // ✅ 교시행 감지 — 3가지 형식 모두 대응
    // 형식1: 순수 숫자 (1, 2, 3) — number 타입
    // 형식2: 숫자 문자열 ("1", "2") — string 타입
    // 형식3: "1교시", "2교시" 문자열
    const firstCellStr = String(row[0]).trim();
    let period = null;

    if (typeof row[0] === 'number' && Number.isInteger(row[0]) && row[0] >= 1 && row[0] <= 10) {
      // 형식1: number 타입 순수 숫자
      period = row[0];
    } else {
      // 형식2: "1" 등 순수 숫자 문자열
      // 형식3: "1교시" 등 교시 포함 문자열
      const periodMatch = firstCellStr.match(/^(\d+)교시?$/);
      if (periodMatch) {
        const num = parseInt(periodMatch[1]);
        if (num >= 1 && num <= 10) period = num;
      }
    }

    if (period === null || Object.keys(colDateMap).length === 0) continue;

    for (let j = 1; j < row.length; j++) {
      const dateStr = colDateMap[j];
      if (!dateStr) continue;

      const cellVal = String(row[j]).trim();
      if (!cellVal) continue;

      let parts = cellVal.split('\n').map(s => s.trim()).filter(Boolean);

      if (parts.length < 2) {
        const spaceIdx = cellVal.lastIndexOf(' ');
        if (spaceIdx > -1) {
          parts = [cellVal.substring(0, spaceIdx).trim(), cellVal.substring(spaceIdx + 1).trim()];
        }
      }

      if (parts.length < 2) continue;

      const subject = parts[0];
      const shortName = parts[parts.length - 1].substring(0, 2);

      let matchedTeacher = null;
      if (teacherLookup[shortName]) {
        if (teacherLookup[shortName].length === 1) {
          matchedTeacher = teacherLookup[shortName][0];
        } else {
          const cellSubjects = normalizeSubjects(subject);
          matchedTeacher = teacherLookup[shortName].find(t =>
            t.subject && normalizeSubjects(t.subject).some(ts => cellSubjects.includes(ts))
          );
          if (!matchedTeacher) matchedTeacher = teacherLookup[shortName][0];
        }
      }

      if (!matchedTeacher) continue;

      const fullName = matchedTeacher.name;
      if (!timetable[fullName]) timetable[fullName] = {};
      if (!timetable[fullName][dateStr]) timetable[fullName][dateStr] = [];
      if (!timetable[fullName][dateStr].includes(period)) {
        timetable[fullName][dateStr].push(period);
      }
    }
  }

  return timetable;
}


/**
 * 엑셀 파일(base64)을 Drive에 업로드 후 구글 시트로 변환,
 * 데이터를 '시간표' 시트에 복사하고 임시 파일을 삭제합니다.
 * 여러 파일이면 순차적으로 아래에 이어붙입니다.
 */
function uploadTimetableFiles(fileDataArray) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const token = ScriptApp.getOAuthToken();

  let timetableSheet = ss.getSheetByName('시간표');
  if (timetableSheet) {
    timetableSheet.clearContents();
  } else {
    timetableSheet = ss.insertSheet('시간표');
  }

  let currentRow = 1;
  let successCount = 0;

  for (let f = 0; f < fileDataArray.length; f++) {
    const fileData = fileDataArray[f];
    let tempFileId = null;
    let convertedFileId = null;

    try {
      Logger.log('파일 처리 시작: ' + fileData.filename);

      const bytes = Utilities.base64Decode(fileData.base64);
      const boundary = 'boundary_timetable_' + f;
      const metaData = JSON.stringify({
        name: fileData.filename,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });

      const requestBodyStr = '--' + boundary + '\r\n'
        + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
        + metaData + '\r\n'
        + '--' + boundary + '\r\n'
        + 'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n';

      const requestBodyBytes = Utilities.newBlob(requestBodyStr).getBytes();
      const endBoundaryBytes = Utilities.newBlob('\r\n--' + boundary + '--').getBytes();
      const combinedBytes = requestBodyBytes.concat(bytes).concat(endBoundaryBytes);

      const uploadResponse = UrlFetchApp.fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'multipart/related; boundary=' + boundary
          },
          payload: Utilities.newBlob(combinedBytes),
          muteHttpExceptions: true
        }
      );

      const uploadResult = JSON.parse(uploadResponse.getContentText());
      tempFileId = uploadResult.id;
      if (!tempFileId) throw new Error('업로드 실패: ' + uploadResponse.getContentText());
      Logger.log('업로드 성공: ' + tempFileId);

      const convertResponse = UrlFetchApp.fetch(
        'https://www.googleapis.com/drive/v3/files/' + tempFileId + '/copy',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
          },
          payload: JSON.stringify({
            name: '__temp_timetable_' + f,
            mimeType: 'application/vnd.google-apps.spreadsheet'
          }),
          muteHttpExceptions: true
        }
      );

      const convertResult = JSON.parse(convertResponse.getContentText());
      convertedFileId = convertResult.id;
      if (!convertedFileId) throw new Error('변환 실패: ' + convertResponse.getContentText());
      Logger.log('변환 성공: ' + convertedFileId);

      const convertedSs = SpreadsheetApp.openById(convertedFileId);
      const sheets = convertedSs.getSheets();
      Logger.log('변환된 파일 시트 수: ' + sheets.length);
      sheets.forEach(s => Logger.log('  시트명: ' + s.getName()));

      // ✅ 헤더행(요일 패턴)이 있는 시트를 찾아서 읽기
      let sourceData = null;
      for (let s = 0; s < sheets.length; s++) {
        const sh = sheets[s];
        const lastRow = sh.getLastRow();
        const lastCol = sh.getLastColumn();
        if (lastRow === 0 || lastCol === 0) continue;

        const previewData = sh.getRange(1, 1, Math.min(lastRow, 30), lastCol).getValues();
        const hasTimetableHeader = previewData.some(row =>
          row.slice(1).some(cell => /^[월화수목금토일]\(\d+\)$/.test(String(cell).trim()))
        );

        if (hasTimetableHeader) {
          sourceData = sh.getRange(1, 1, lastRow, lastCol).getValues();
          Logger.log('시간표 시트 발견: ' + sh.getName() + ', 행수: ' + lastRow);
          break;
        } else {
          Logger.log('시트 "' + sh.getName() + '" — 시간표 패턴 없음, 건너뜀');
        }
      }

      if (!sourceData) {
        Logger.log('시간표 형식의 시트를 찾지 못함: ' + fileData.filename);
        continue;
      }

      timetableSheet.getRange(currentRow, 1, sourceData.length, sourceData[0].length)
        .setValues(sourceData);
      currentRow += sourceData.length + 1;
      successCount++;
      Logger.log('시간표 시트 복사 완료: ' + sourceData.length + '행');

    } catch(e) {
      Logger.log('파일 처리 오류 (' + fileData.filename + '): ' + e.message);
    } finally {
      try {
        if (tempFileId) {
          UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + tempFileId, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + token },
            muteHttpExceptions: true
          });
        }
        if (convertedFileId) {
          UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + convertedFileId, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + token },
            muteHttpExceptions: true
          });
        }
      } catch(e) {
        Logger.log('임시파일 삭제 오류: ' + e.message);
      }
    }
  }

  if (successCount === 0) {
    throw new Error('시간표 형식의 시트를 찾지 못했습니다. 파일에 요일(월,화,수...) 헤더가 있는지 확인해주세요.');
  }

  const scheduleData = getSavedScheduleData();
  if (!scheduleData) throw new Error('저장된 시험 정보가 없습니다.');

  const allTeachers = getTeacherProfiles();
  const result = getTimetableData(scheduleData, allTeachers);
Logger.log('최종 timetableData: ' + JSON.stringify(result));
PropertiesService.getDocumentProperties()
  .setProperty('savedTimetableData', JSON.stringify(result));
return result;
}

// ✅ timetableData 저장
function saveTimetableData(timetableData) {
  const props = PropertiesService.getDocumentProperties();
  props.setProperty('savedTimetableData', JSON.stringify(timetableData));
  props.deleteProperty('hasSavedExclusions'); // 💡 새 시간표 업로드 시 수동 저장 플래그 초기화
  return true;
}

// ✅ timetableData 로드
function getSavedTimetableData() {
  const saved = PropertiesService.getDocumentProperties()
    .getProperty('savedTimetableData');
  return saved ? JSON.parse(saved) : {};
}