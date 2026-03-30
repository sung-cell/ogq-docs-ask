/**
 * Excel 읽기 모듈 (exceljs)
 *
 * data/events_master.xlsx → 원시 행(raw row) 배열 반환
 * - 1행을 헤더로 사용
 * - 빈 셀은 null 반환
 * - 날짜 셀은 JS Date 객체로 반환 (exceljs 기본 동작)
 */
import ExcelJS from 'exceljs';
import { existsSync } from 'fs';
import { EVENTS_MASTER_PATH } from '../config.js';

/**
 * 셀 값을 정규화한다.
 * - RichText 객체 → 문자열
 * - 수식 셀 → result 값
 * - null / undefined → null
 * @param {ExcelJS.Cell} cell
 * @returns {string|number|boolean|Date|null}
 */
function getCellValue(cell) {
  const val = cell.value;
  if (val === null || val === undefined) return null;
  if (val instanceof Date)               return val;
  if (typeof val === 'object') {
    if (val.richText)  return val.richText.map(r => r.text).join('');
    if (val.result !== undefined) return val.result ?? null; // 수식
    if (val.text)      return String(val.text);
  }
  return val;
}

/**
 * Excel 파일을 읽어 원시 행 배열을 반환한다.
 * @param {string} [filePath]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function readEventsXlsx(filePath = EVENTS_MASTER_PATH) {
  if (!existsSync(filePath)) {
    console.warn(`[excelParser] 파일 없음: ${filePath}`);
    return [];
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  // 1행에서 헤더 수집
  const headers = {};
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const key = String(getCellValue(cell) ?? '').trim();
    if (key) headers[colNumber] = key;
  });

  const maxCol = Math.max(...Object.keys(headers).map(Number));

  // 2행부터 데이터 행 수집
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const obj = {};
    for (let col = 1; col <= maxCol; col++) {
      const key = headers[col];
      if (!key) continue;
      obj[key] = getCellValue(row.getCell(col));
    }
    rows.push(obj);
  });

  return rows;
}
