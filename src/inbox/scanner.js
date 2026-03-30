/**
 * inbox 폴더 스캔 및 엑셀 파일 파싱 (재귀 탐색 지원)
 */
import { readdirSync, statSync, lstatSync, existsSync } from 'fs';
import { join, extname } from 'path';
import ExcelJS from 'exceljs';
import { CONTRACTS_INBOX_DIR, CONTRACTS_RAW_DIR } from '../config.js';

const MAX_FILES = Infinity;
const PARSEABLE_EXTENSIONS = ['.xlsx', '.xls', '.csv']; // 파싱 가능
const DISCOVERABLE_EXTENSIONS = ['.pdf', '.docx', '.pptx']; // 발견만
const ALL_EXTENSIONS = [...PARSEABLE_EXTENSIONS, ...DISCOVERABLE_EXTENSIONS];

/**
 * 셀 값 추출
 * @param {ExcelJS.Cell} cell
 * @returns {string|number|boolean|Date|null}
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
 * 재귀적으로 파일 스캔 (심볼릭 링크 대상 포함)
 * @param {string} dir - 스캔할 디렉토리
 * @param {Array} results - 누적 결과 배열 [{path, ext, dir}]
 * @param {Set<string>} visited - 방문한 디렉토리 세트 (순환 방지)
 * @returns {Array} - 파일 정보 목록
 */
function scanRecursive(dir, results = [], visited = new Set()) {
  if (!existsSync(dir)) return results;

  // 파일 수 제한 체크
  if (results.length >= MAX_FILES) {
    return results;
  }

  // 순환 참조 방지
  const realPath = statSync(dir).isSymbolicLink()
    ? statSync(dir).dev + ':' + statSync(dir).ino
    : dir;

  if (visited.has(realPath)) return results;
  visited.add(realPath);

  try {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      if (results.length >= MAX_FILES) break;

      const fullPath = join(dir, entry);

      // 임시 파일 제외
      if (entry.startsWith('~') || entry.startsWith('.')) continue;

      try {
        const lstat = lstatSync(fullPath);

        // 심볼릭 링크 처리
        if (lstat.isSymbolicLink()) {
          const stat = statSync(fullPath); // 링크 대상의 실제 정보
          if (stat.isDirectory()) {
            scanRecursive(fullPath, results, visited);
          } else if (stat.isFile()) {
            const ext = extname(entry).toLowerCase();
            if (ALL_EXTENSIONS.includes(ext)) {
              results.push({ path: fullPath, ext, dir });
            }
          }
        } else if (lstat.isDirectory()) {
          scanRecursive(fullPath, results, visited);
        } else if (lstat.isFile()) {
          const ext = extname(entry).toLowerCase();
          if (ALL_EXTENSIONS.includes(ext)) {
            results.push({ path: fullPath, ext, dir });
          }
        }
      } catch (err) {
        console.warn(`[scanner] 파일 접근 실패: ${fullPath} - ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`[scanner] 디렉토리 접근 실패: ${dir} - ${err.message}`);
  }

  return results;
}

/**
 * inbox 및 contracts_raw 폴더의 모든 지원 파일 스캔
 * @returns {{ files: Array<{path, ext, dir}>, truncated: boolean, stats: object }}
 */
export function scanAllFiles() {
  const results = [];
  const visited = new Set();

  // inbox 스캔
  scanRecursive(CONTRACTS_INBOX_DIR, results, visited);

  // contracts_raw 스캔
  scanRecursive(CONTRACTS_RAW_DIR, results, visited);

  const truncated = false;
  const sliced = results;

  // 통계 계산
  const stats = {
    total: results.length,
    parseable: sliced.filter(f => PARSEABLE_EXTENSIONS.includes(f.ext)).length,
    discoverable: sliced.filter(f => DISCOVERABLE_EXTENSIONS.includes(f.ext)).length,
    byExt: {},
    byDir: {}
  };

  // 확장자별 카운트
  sliced.forEach(f => {
    stats.byExt[f.ext] = (stats.byExt[f.ext] || 0) + 1;
  });

  // 디렉토리별 카운트
  sliced.forEach(f => {
    stats.byDir[f.dir] = (stats.byDir[f.dir] || 0) + 1;
  });

  return {
    files: sliced,
    truncated,
    stats
  };
}

/**
 * 파일에서 일정 후보 추출 (타입별 처리)
 * @param {string} filePath - 파일 경로
 * @returns {Promise<Array>} - 후보 행 배열
 */
export async function extractCandidates(filePath) {
  const ext = extname(filePath).toLowerCase();

  // Excel 파일 처리 (.xlsx, .xls)
  if (ext === '.xlsx' || ext === '.xls') {
    return await extractFromExcel(filePath);
  }

  // CSV 파일 처리 (현재 미구현)
  if (ext === '.csv') {
    return [];
  }

  // 발견만 대상 파일 (.pdf, .docx, .pptx)
  if (DISCOVERABLE_EXTENSIONS.includes(ext)) {
    return [];
  }

  return [];
}

/**
 * Excel 파일에서 후보 추출
 * @param {string} filePath
 * @returns {Promise<Array>}
 */
async function extractFromExcel(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const candidates = [];
  const fileName = filePath.split('/').pop();

  for (const sheet of workbook.worksheets) {
    // 1행을 헤더로 가정
    const headers = {};
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const key = String(getCellValue(cell) ?? '').trim();
      if (key) headers[colNumber] = key;
    });

    if (Object.keys(headers).length === 0) continue;

    const maxCol = Math.max(...Object.keys(headers).map(Number));

    // 2행부터 데이터 읽기
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;

      const obj = { _source_file: fileName, _sheet: sheet.name };
      for (let col = 1; col <= maxCol; col++) {
        const key = headers[col];
        if (!key) continue;
        obj[key] = getCellValue(row.getCell(col));
      }

      // 최소한 type이나 title이 있는 행만
      if (obj.type || obj.title) {
        candidates.push(obj);
      }
    });
  }

  return candidates;
}
