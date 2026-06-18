/**
 * 계약 폴더 파서 구조
 *
 * data/contracts_inbox/ 스캔 → 파일 메타데이터 배열 반환
 * 향후 PDF / DOCX 파서를 parsedContent 에 연결한다.
 *
 * 확장 방법:
 *   1. pdf-parse  → parsePdf(fileMeta)
 *   2. mammoth    → parseDocx(fileMeta)
 *   3. 결과를 parsedContent 에 주입 후 normalizer 로 전달
 */
import { readdirSync, statSync, existsSync } from 'fs';
import { resolve, extname } from 'path';
import { CONTRACTS_INBOX_DIR } from '../config.js';

/** 지원 확장자 */
const SUPPORTED_EXT = new Set(['.pdf', '.docx', '.txt', '.md']);

/**
 * @typedef {Object} ContractFileMeta
 * @property {string}      filename
 * @property {string}      path
 * @property {string}      ext
 * @property {number}      sizeBytes
 * @property {Date}        modifiedAt
 * @property {ParsedContract|null} parsedContent  - 파서 연결 후 채워짐
 */

/**
 * @typedef {Object} ParsedContract
 * @property {string|null} client
 * @property {Date|null}   startDate
 * @property {Date|null}   endDate
 * @property {number|null} amount
 * @property {string|null} raw  - 원문 텍스트
 */

/**
 * contracts_inbox/ 디렉토리를 스캔하여 지원 파일 목록을 반환한다.
 * @param {string} [dirPath]
 * @returns {ContractFileMeta[]}
 */
export function scanContractsInbox(dirPath = CONTRACTS_INBOX_DIR) {
  if (!existsSync(dirPath)) {
    console.warn(`[contractParser] 폴더 없음: ${dirPath}`);
    return [];
  }

  return readdirSync(dirPath)
    .filter(name => SUPPORTED_EXT.has(extname(name).toLowerCase()))
    .map(name => {
      const filePath = resolve(dirPath, name);
      const stat     = statSync(filePath);
      return {
        filename:      name,
        path:          filePath,
        ext:           extname(name).toLowerCase(),
        sizeBytes:     stat.size,
        modifiedAt:    stat.mtime,
        parsedContent: null,
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename, 'ko'));
}

/**
 * 단일 계약 파일에서 주요 정보를 추출한다.
 * 현재는 스텁(stub) — 확장자별 파서를 연결하면 된다.
 *
 * @param {ContractFileMeta} fileMeta
 * @returns {ContractFileMeta}
 */
export function parseContractFile(fileMeta) {
  // TODO: 확장자별 파서 분기
  // if (fileMeta.ext === '.pdf')  return parsePdf(fileMeta);
  // if (fileMeta.ext === '.docx') return parseDocx(fileMeta);
  // if (fileMeta.ext === '.txt')  return parseTxt(fileMeta);

  return {
    ...fileMeta,
    parsedContent: {
      client:    null,
      startDate: null,
      endDate:   null,
      amount:    null,
      raw:       null,
    },
  };
}

/**
 * scanContractsInbox + parseContractFile 일괄 실행.
 * @param {string} [dirPath]
 * @returns {ContractFileMeta[]}
 */
export function loadAllContracts(dirPath = CONTRACTS_INBOX_DIR) {
  return scanContractsInbox(dirPath).map(parseContractFile);
}
