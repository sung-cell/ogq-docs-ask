/**
 * InboxCandidates 시트 관리
 */
import ExcelJS from 'exceljs';
import { existsSync } from 'fs';
import dayjs from 'dayjs';
import { EVENTS_MASTER_PATH } from '../config.js';

const SHEET_NAME = 'InboxCandidates';

const CANDIDATE_HEADERS = [
  'type', 'title', 'client', 'start_date', 'end_date',
  'billing_cycle', 'invoice_date', 'due_date',
  'amount', 'currency', 'fee_rate', 'notes',
  'certain', 'source', '_source_file', '_sheet', '_added_at'
];

/**
 * 중복 체크용 키 생성 (거래처+기간+제목)
 */
function getDuplicateKey(row) {
  const client = String(row.client || '').trim();
  const title = String(row.title || '').trim();
  const date = row.start_date instanceof Date
    ? dayjs(row.start_date).format('YYYY-MM')
    : '';
  return `${client}|${date}|${title}`.toLowerCase();
}

/**
 * InboxCandidates 시트 가져오기 또는 생성
 */
function getOrCreateSheet(workbook) {
  let sheet = workbook.getWorksheet(SHEET_NAME);

  if (!sheet) {
    sheet = workbook.addWorksheet(SHEET_NAME);
    // 헤더 추가
    sheet.addRow(CANDIDATE_HEADERS);
  }

  return sheet;
}

/**
 * 기존 후보 목록의 중복 키 세트 생성
 */
function getExistingKeys(sheet) {
  const keys = new Set();
  const headers = {};

  // 1행 헤더 읽기
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value).trim();
  });

  // 2행부터 데이터 읽기
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const obj = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber];
      if (key) obj[key] = cell.value;
    });

    const dupKey = getDuplicateKey(obj);
    if (dupKey) keys.add(dupKey);
  });

  return keys;
}

/**
 * 후보를 InboxCandidates 시트에 추가
 * @param {Array} candidates - 후보 배열
 * @returns {Promise<{ added: number, skipped: number, total: number }>}
 */
export async function addCandidates(candidates) {
  if (!existsSync(EVENTS_MASTER_PATH)) {
    throw new Error(`events_master.xlsx 파일이 없습니다: ${EVENTS_MASTER_PATH}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EVENTS_MASTER_PATH);

  const sheet = getOrCreateSheet(workbook);
  const existingKeys = getExistingKeys(sheet);

  let added = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const dupKey = getDuplicateKey(candidate);

    if (existingKeys.has(dupKey)) {
      skipped++;
      continue;
    }

    // 새 행 추가
    const rowData = CANDIDATE_HEADERS.map(header => {
      if (header === '_added_at') {
        return new Date();
      }
      return candidate[header] ?? '';
    });

    sheet.addRow(rowData);
    existingKeys.add(dupKey);
    added++;
  }

  // 저장
  await workbook.xlsx.writeFile(EVENTS_MASTER_PATH);

  return {
    added,
    skipped,
    total: candidates.length
  };
}

/**
 * 셀 값 추출 헬퍼
 */
function getCellValue(cell) {
  const val = cell.value;
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'object') {
    if (val.richText) return val.richText.map(r => r.text).join('');
    if (val.result !== undefined) return val.result ?? null;
    if (val.text) return String(val.text);
  }
  return val;
}

/**
 * InboxCandidates 시트의 모든 후보 읽기
 * @returns {Promise<Array<{ rowNumber: number, data: object }>>}
 */
export async function getCandidates() {
  if (!existsSync(EVENTS_MASTER_PATH)) {
    throw new Error(`events_master.xlsx 파일이 없습니다: ${EVENTS_MASTER_PATH}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EVENTS_MASTER_PATH);

  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet || sheet.rowCount <= 1) {
    return [];
  }

  const headers = {};
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(getCellValue(cell)).trim();
  });

  const candidates = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const data = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber];
      if (key) data[key] = getCellValue(cell);
    });

    candidates.push({ rowNumber, data });
  });

  return candidates;
}

/**
 * Events 시트의 기존 키 세트 가져오기
 */
function getEventsKeys(workbook) {
  const sheet = workbook.getWorksheet('Events');
  if (!sheet) return new Set();

  const headers = {};
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(getCellValue(cell)).trim();
  });

  const keys = new Set();
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const obj = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber];
      if (key) obj[key] = getCellValue(cell);
    });

    const dupKey = getDuplicateKey(obj);
    if (dupKey) keys.add(dupKey);
  });

  return keys;
}

/**
 * 후보를 Events 시트로 승인 (InboxCandidates에서 삭제)
 * @param {number[]} rowNumbers - 승인할 행 번호 배열 (1부터 시작, 헤더 제외)
 * @returns {Promise<{ approved: number, failed: number }>}
 */
export async function approveCandidates(rowNumbers) {
  if (!existsSync(EVENTS_MASTER_PATH)) {
    throw new Error(`events_master.xlsx 파일이 없습니다: ${EVENTS_MASTER_PATH}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EVENTS_MASTER_PATH);

  const candidatesSheet = workbook.getWorksheet(SHEET_NAME);
  if (!candidatesSheet || candidatesSheet.rowCount <= 1) {
    return { approved: 0, failed: rowNumbers.length };
  }

  const eventsSheet = workbook.getWorksheet('Events');
  if (!eventsSheet) {
    throw new Error('Events 시트가 없습니다.');
  }

  // Events 시트의 기존 키 가져오기
  const eventsKeys = getEventsKeys(workbook);

  // InboxCandidates 헤더 읽기
  const headers = {};
  candidatesSheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(getCellValue(cell)).trim();
  });

  // Events 시트 헤더 읽기
  const eventsHeaders = {};
  eventsSheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    eventsHeaders[colNumber] = String(getCellValue(cell)).trim();
  });

  let approved = 0;
  let failed = 0;
  const rowsToDelete = [];

  for (const num of rowNumbers) {
    const actualRowNumber = num + 1; // 1-based index + header row

    if (actualRowNumber > candidatesSheet.rowCount) {
      failed++;
      continue;
    }

    const row = candidatesSheet.getRow(actualRowNumber);
    const data = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber];
      if (key) data[key] = getCellValue(cell);
    });

    // 중복 체크
    const dupKey = getDuplicateKey(data);
    if (eventsKeys.has(dupKey)) {
      failed++;
      continue;
    }

    // Events 시트에 추가 (내부 필드 제외)
    const eventRow = [];
    eventsSheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const headerKey = eventsHeaders[colNumber];
      eventRow[colNumber] = data[headerKey] ?? '';
    });

    eventsSheet.addRow(eventRow);
    eventsKeys.add(dupKey);
    approved++;
    rowsToDelete.push(actualRowNumber);
  }

  // InboxCandidates에서 승인된 행 삭제 (역순으로)
  rowsToDelete.sort((a, b) => b - a);
  for (const rowNumber of rowsToDelete) {
    candidatesSheet.spliceRows(rowNumber, 1);
  }

  // 저장
  await workbook.xlsx.writeFile(EVENTS_MASTER_PATH);

  return { approved, failed };
}
