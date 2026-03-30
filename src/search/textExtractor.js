/**
 * 문서에서 텍스트 추출 (PDF, DOCX, PPTX, XLSX)
 */
import { readFileSync } from 'fs';
import { extname } from 'path';
import { createRequire } from 'module';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { extractPdfWithOcr, getOcrConfig } from './pdfOcrExtractor.js';

const require = createRequire(import.meta.url);

// PDF 파서 로드 (안전한 방식 - CommonJS / ES Module 모두 대응)
let pdfParse = null;
try {
  const pdfParseModule = require('pdf-parse');

  // CommonJS default export 또는 일반 export 체크
  if (typeof pdfParseModule === 'function') {
    pdfParse = pdfParseModule;
  } else if (pdfParseModule && typeof pdfParseModule.default === 'function') {
    pdfParse = pdfParseModule.default;
  } else if (pdfParseModule && typeof pdfParseModule.pdfParse === 'function') {
    pdfParse = pdfParseModule.pdfParse;
  } else {
    console.error('[textExtractor] pdf-parse를 함수로 로드할 수 없습니다. 타입:', typeof pdfParseModule);
    console.error('[textExtractor] 사용 가능한 속성:', Object.keys(pdfParseModule || {}));
    pdfParse = null;
  }

  if (pdfParse) {
    console.log('[textExtractor] pdf-parse 로드 성공');
  }
} catch (err) {
  console.error('[textExtractor] pdf-parse 로드 실패:', err.message);
  pdfParse = null;
}

const MIN_TEXT_LENGTH = 50; // 스캔본 판정 기준

/**
 * PDF에서 텍스트 추출 (pdf-parse 우선, 실패 시 OCR)
 * @returns {Promise<{ text: string, error: string|null, ocrUsed: boolean, ocrSucceeded: boolean }>}
 */
async function extractPdf(filePath) {
  let ocrUsed = false;
  let ocrSucceeded = false;

  // pdf-parse 로드 실패 시
  if (!pdfParse) {
    console.warn(`[extractor] PDF 파서를 사용할 수 없습니다: ${filePath}`);
    return { text: '', error: 'PDF 파서 로드 실패', ocrUsed: false, ocrSucceeded: false };
  }

  try {
    const dataBuffer = readFileSync(filePath);

    // pdfParse 함수 타입 재확인 (방어적 처리)
    if (typeof pdfParse !== 'function') {
      console.error(`[extractor] pdfParse가 함수가 아닙니다 (타입: ${typeof pdfParse})`);
      return { text: '', error: 'pdfParse is not a function', ocrUsed: false, ocrSucceeded: false };
    }

    const data = await pdfParse(dataBuffer);
    const text = data?.text || '';

    // 텍스트 추출 통계
    const pages = data?.numpages || 0;
    const textLength = text.length;

    // 텍스트가 충분하면 pdf-parse 결과 사용
    if (textLength >= MIN_TEXT_LENGTH) {
      console.log(`[extractor] PDF 텍스트 추출 성공 (${textLength}자, ${pages}페이지): ${filePath}`);
      return { text, error: null, ocrUsed: false, ocrSucceeded: false };
    }

    // 텍스트가 부족하면 OCR 시도 (OCR이 활성화된 경우만)
    if (textLength < MIN_TEXT_LENGTH && pages > 0) {
      const ocrConfig = getOcrConfig();

      if (!ocrConfig.enabled) {
        // OCR 비활성화 시: 로그 없이 조용히 기존 텍스트 반환
        return { text, error: null, ocrUsed: false, ocrSucceeded: false };
      }

      console.warn(`[extractor] PDF ${pages}페이지이지만 텍스트 부족 (${textLength}자) - OCR 시도: ${filePath}`);

      try {
        const ocrResult = await extractPdfWithOcr(filePath);

        if (ocrResult.ocrSucceeded && ocrResult.text.length > 0) {
          console.log(`[extractor] OCR 성공 (${ocrResult.text.length}자, ${ocrResult.pagesProcessed}페이지): ${filePath}`);
          return {
            text: ocrResult.text,
            error: null,
            ocrUsed: true,
            ocrSucceeded: true
          };
        } else {
          console.warn(`[extractor] OCR 실패 (건너뜀, 기존 텍스트 사용): ${filePath} - ${ocrResult.error || 'No text extracted'}`);
          // OCR 실패 시 원래 추출된 텍스트 사용 (fallback)
          return {
            text,
            error: null,
            ocrUsed: true,
            ocrSucceeded: false
          };
        }
      } catch (ocrErr) {
        console.warn(`[extractor] OCR 오류 (건너뜀, 기존 텍스트 사용): ${filePath} - ${ocrErr.message}`);
        // OCR 에러 시에도 원래 추출된 텍스트 사용 (fallback)
        return {
          text,
          error: null,
          ocrUsed: true,
          ocrSucceeded: false
        };
      }
    }

    return { text, error: null, ocrUsed: false, ocrSucceeded: false };
  } catch (err) {
    console.warn(`[extractor] PDF 추출 실패: ${filePath} - ${err.message}`);
    return { text: '', error: err.message, ocrUsed: false, ocrSucceeded: false };
  }
}

/**
 * DOCX에서 텍스트 추출
 */
async function extractDocx(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || '';
  } catch (err) {
    console.warn(`[extractor] DOCX 추출 실패: ${filePath} - ${err.message}`);
    return '';
  }
}

/**
 * PPTX에서 텍스트 추출 (슬라이드 텍스트만)
 */
async function extractPptx(filePath) {
  try {
    const dataBuffer = readFileSync(filePath);
    const zip = await JSZip.loadAsync(dataBuffer);

    let text = '';

    // 슬라이드 파일들 찾기 (ppt/slides/slide*.xml)
    const slideFiles = Object.keys(zip.files)
      .filter(name => name.match(/ppt\/slides\/slide\d+\.xml/));

    for (const slideName of slideFiles) {
      const slideXml = await zip.file(slideName).async('string');

      // <a:t> 태그 내의 텍스트 추출
      const matches = slideXml.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g);
      for (const match of matches) {
        text += match[1] + ' ';
      }
    }

    return text.trim();
  } catch (err) {
    console.warn(`[extractor] PPTX 추출 실패: ${filePath} - ${err.message}`);
    return '';
  }
}

/**
 * XLSX에서 텍스트 추출 (간단한 텍스트화)
 */
async function extractXlsx(filePath) {
  try {
    const fileBuffer = readFileSync(filePath);
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });

    if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
      console.warn(`[extractor] XLSX 워크북이 비어있습니다: ${filePath}`);
      return '';
    }

    let text = '';

    // 모든 시트 순회
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      try {
        // 시트를 2차원 배열로 변환 (header: 1은 첫 행부터 데이터로 취급)
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

        // 각 행의 셀들을 텍스트로 결합
        for (const row of rows) {
          if (Array.isArray(row) && row.length > 0) {
            text += row.filter(cell => cell !== null && cell !== undefined).join(' ') + '\n';
          }
        }
      } catch (sheetErr) {
        console.warn(`[extractor] XLSX 시트 추출 실패 (${sheetName}): ${sheetErr.message}`);
      }
    }

    return text.trim();
  } catch (err) {
    console.warn(`[extractor] XLSX 추출 실패: ${filePath} - ${err.message}`);
    return '';
  }
}

/**
 * CSV에서 텍스트 추출
 */
function extractCsv(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content;
  } catch (err) {
    console.warn(`[extractor] CSV 추출 실패: ${filePath} - ${err.message}`);
    return '';
  }
}

/**
 * 파일에서 텍스트 추출 (타입별 처리)
 * @param {string} filePath
 * @returns {Promise<{ text: string, isScanned: boolean, extractedTextAvailable: boolean, extractionError: string|null, ocrUsed: boolean, ocrSucceeded: boolean }>}
 */
export async function extractText(filePath) {
  const ext = extname(filePath).toLowerCase();
  let text = '';
  let extractionError = null;
  let ocrUsed = false;
  let ocrSucceeded = false;

  switch (ext) {
    case '.pdf': {
      const result = await extractPdf(filePath);
      text = result.text;
      extractionError = result.error;
      ocrUsed = result.ocrUsed || false;
      ocrSucceeded = result.ocrSucceeded || false;
      break;
    }
    case '.docx':
      text = await extractDocx(filePath);
      break;
    case '.pptx':
      text = await extractPptx(filePath);
      break;
    case '.xlsx':
    case '.xls':
      text = await extractXlsx(filePath);
      break;
    case '.csv':
      text = extractCsv(filePath);
      break;
    default:
      return {
        text: '',
        isScanned: false,
        extractedTextAvailable: false,
        extractionError: null,
        ocrUsed: false,
        ocrSucceeded: false
      };
  }

  // 스캔본 판정 (텍스트가 거의 없으면)
  // OCR 성공 시에는 스캔본이지만 텍스트가 추출된 상태
  const isScanned = text.trim().length < MIN_TEXT_LENGTH || (ocrUsed && !ocrSucceeded);

  // 텍스트 추출 가능 여부
  const extractedTextAvailable = text.trim().length > 0 && !extractionError;

  return {
    text,
    isScanned,
    extractedTextAvailable,
    extractionError,
    ocrUsed,
    ocrSucceeded
  };
}
