/**
 * PDF 추출 테스트
 */
import { extractText } from './src/search/textExtractor.js';
import { loadIndex } from './src/index/indexBuilder.js';

async function testPdf() {
  console.log('📄 PDF 추출 테스트 시작\n');

  // 인덱스에서 PDF 파일 찾기
  const index = loadIndex();
  if (!index) {
    console.error('인덱스를 찾을 수 없습니다. 먼저 인덱싱을 실행하세요.');
    return;
  }

  const pdfFiles = index.documents.filter(doc => doc.ext === '.pdf');

  if (pdfFiles.length === 0) {
    console.log('PDF 파일이 없습니다.');
    return;
  }

  // 첫 번째 PDF 파일 테스트
  const testFile = pdfFiles[0];
  console.log(`테스트 파일: ${testFile.fileName}`);
  console.log(`경로: ${testFile.path}\n`);

  try {
    const { text, isScanned, extractedTextAvailable, extractionError, ocrUsed, ocrSucceeded } = await extractText(testFile.path);

    console.log('✅ 추출 완료!');
    console.log(`스캔본 여부: ${isScanned}`);
    console.log(`텍스트 추출 가능: ${extractedTextAvailable}`);
    console.log(`OCR 사용: ${ocrUsed}`);
    console.log(`OCR 성공: ${ocrSucceeded}`);
    console.log(`추출 오류: ${extractionError || '없음'}`);
    console.log(`추출된 텍스트 길이: ${text.length}자`);
    console.log(`\n--- 추출된 텍스트 미리보기 (처음 500자) ---`);
    console.log(text.substring(0, 500));
    console.log('---\n');

    if (ocrUsed && ocrSucceeded) {
      console.log('✅ OCR 성공! 스캔본 PDF에서 텍스트 추출 완료!');
    } else if (ocrUsed && !ocrSucceeded) {
      console.log('❌ OCR 실패. 스캔본 PDF에서 텍스트 추출 불가.');
    } else if (extractedTextAvailable) {
      console.log('✅ PDF 추출이 정상적으로 동작합니다! (pdf-parse 사용)');
    } else if (isScanned) {
      console.log('⚠️  스캔본 PDF로 판정되었습니다. OCR이 필요합니다.');
    } else if (extractionError) {
      console.log(`❌ 추출 오류: ${extractionError}`);
    } else {
      console.log('⚠️  텍스트가 추출되지 않았습니다.');
    }
  } catch (err) {
    console.error('❌ 추출 실패:', err.message);
    console.error(err.stack);
  }
}

testPdf();
