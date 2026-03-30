/**
 * XLSX 추출 테스트
 */
import { extractText } from './src/search/textExtractor.js';
import { loadIndex } from './src/index/indexBuilder.js';

async function testXlsx() {
  console.log('📊 XLSX 추출 테스트 시작\n');

  // 인덱스에서 xlsx 파일 찾기
  const index = loadIndex();
  if (!index) {
    console.error('인덱스를 찾을 수 없습니다. 먼저 인덱싱을 실행하세요.');
    return;
  }

  const xlsxFiles = index.documents.filter(doc =>
    doc.ext === '.xlsx' || doc.ext === '.xls'
  );

  if (xlsxFiles.length === 0) {
    console.log('xlsx/xls 파일이 없습니다.');
    return;
  }

  // 첫 번째 xlsx 파일 테스트
  const testFile = xlsxFiles[0];
  console.log(`테스트 파일: ${testFile.fileName}`);
  console.log(`경로: ${testFile.path}\n`);

  try {
    const { text, isScanned } = await extractText(testFile.path);

    console.log('✅ 추출 성공!');
    console.log(`스캔본 여부: ${isScanned}`);
    console.log(`추출된 텍스트 길이: ${text.length}자`);
    console.log(`\n--- 추출된 텍스트 미리보기 (처음 500자) ---`);
    console.log(text.substring(0, 500));
    console.log('---\n');

    if (text.length > 0) {
      console.log('✅ Excel 추출이 정상적으로 동작합니다!');
    } else {
      console.log('⚠️  텍스트가 추출되지 않았습니다.');
    }
  } catch (err) {
    console.error('❌ 추출 실패:', err.message);
    console.error(err.stack);
  }
}

testXlsx();
