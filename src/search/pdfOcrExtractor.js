/**
 * PDF OCR 추출 함수
 * pdf.js + tesseract.js를 사용하여 스캔본 PDF에서 텍스트 추출
 */
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { createWorker } from 'tesseract.js';
import { createCanvas } from 'canvas';

const require = createRequire(import.meta.url);

// OCR 설정 로드 (기본값: 비활성화)
// 활성화하려면 config/ocr.config.json에서 "enabled": true로 설정
let ocrConfig = {
  enabled: false,  // 기본 비활성화 (인덱싱 안정성 우선)
  languages: ['kor', 'eng'],
  maxPages: 3,
  fullDocumentFallback: false,
  minTextLength: 50,
  tesseractOptions: {
    // logger는 함수여야 함. null이면 에러 발생하므로 조용한 함수 사용
    logger: () => {}
  }
};

try {
  if (existsSync('config/ocr.config.json')) {
    const configContent = readFileSync('config/ocr.config.json', 'utf-8');
    ocrConfig = { ...ocrConfig, ...JSON.parse(configContent) };
  }
} catch (err) {
  console.warn('[OCR] 설정 파일 로드 실패, 기본값 사용:', err.message);
}

// pdf.js 로드
let pdfjsLib = null;
try {
  // CommonJS 방식으로 import
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjsLib = pdfjs;

  // Worker 경로 설정 (Node.js 환경에서는 필요 없을 수 있음)
  if (pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
  }
} catch (err) {
  console.error('[OCR] pdfjs-dist 로드 실패:', err.message);
}

/**
 * PDF 페이지를 canvas 이미지로 렌더링
 * @param {Object} page - PDF.js page 객체
 * @param {number} scale - 렌더링 스케일 (기본 2.0)
 * @returns {Promise<Canvas>}
 */
async function renderPageToCanvas(page, scale = 2.0) {
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext('2d');

  const renderContext = {
    canvasContext: context,
    viewport: viewport
  };

  await page.render(renderContext).promise;
  return canvas;
}

/**
 * Canvas 이미지에서 OCR 텍스트 추출
 * @param {Canvas} canvas
 * @param {Tesseract.Worker} worker
 * @returns {Promise<string>}
 */
async function extractTextFromCanvas(canvas, worker) {
  try {
    const imageData = canvas.toDataURL('image/png');
    const { data } = await worker.recognize(imageData);
    return data.text || '';
  } catch (err) {
    console.warn('[OCR] 이미지 인식 실패:', err.message);
    return '';
  }
}

/**
 * PDF 파일에서 OCR 텍스트 추출
 * @param {string} filePath - PDF 파일 경로
 * @param {Object} options - OCR 옵션
 * @returns {Promise<{ text: string, ocrUsed: boolean, ocrSucceeded: boolean, pagesProcessed: number, error: string|null }>}
 */
export async function extractPdfWithOcr(filePath, options = {}) {
  if (!ocrConfig.enabled) {
    return {
      text: '',
      ocrUsed: false,
      ocrSucceeded: false,
      pagesProcessed: 0,
      error: 'OCR disabled'
    };
  }

  if (!pdfjsLib) {
    return {
      text: '',
      ocrUsed: false,
      ocrSucceeded: false,
      pagesProcessed: 0,
      error: 'pdfjs-dist not loaded'
    };
  }

  const maxPages = options.maxPages || ocrConfig.maxPages;
  let worker = null;

  try {
    // PDF 파일 로드
    const dataBuffer = readFileSync(filePath);
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(dataBuffer),
      useSystemFonts: true,
      standardFontDataUrl: null
    });

    const pdfDocument = await loadingTask.promise;
    const numPages = pdfDocument.numPages;

    console.log(`[OCR] 시작: ${filePath} (${numPages}페이지 중 최대 ${maxPages}페이지 처리)`);

    // Tesseract worker 생성
    worker = await createWorker(ocrConfig.languages, 1, {
      ...ocrConfig.tesseractOptions
    });

    let fullText = '';
    const pagesToProcess = Math.min(numPages, maxPages);

    // 페이지별로 OCR 수행
    for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
      try {
        const page = await pdfDocument.getPage(pageNum);
        const canvas = await renderPageToCanvas(page);
        const pageText = await extractTextFromCanvas(canvas, worker);

        if (pageText) {
          fullText += pageText + '\n\n';
        }

        console.log(`[OCR] 페이지 ${pageNum}/${pagesToProcess} 완료 (${pageText.length}자)`);
      } catch (pageErr) {
        console.warn(`[OCR] 페이지 ${pageNum} 처리 실패:`, pageErr.message);
      }
    }

    await worker.terminate();

    const succeeded = fullText.trim().length > 0;

    return {
      text: fullText.trim(),
      ocrUsed: true,
      ocrSucceeded: succeeded,
      pagesProcessed: pagesToProcess,
      error: succeeded ? null : 'No text extracted'
    };
  } catch (err) {
    console.warn(`[OCR] PDF 처리 실패 (건너뜀): ${filePath} - ${err.message}`);

    if (worker) {
      try {
        await worker.terminate();
      } catch (terminateErr) {
        // Ignore termination errors
      }
    }

    return {
      text: '',
      ocrUsed: true,
      ocrSucceeded: false,
      pagesProcessed: 0,
      error: err.message
    };
  }
}

/**
 * OCR 설정 반환
 */
export function getOcrConfig() {
  return ocrConfig;
}
