/**
 * 문서 내용 질문 처리
 */
import { scanAllFiles } from '../inbox/scanner.js';
import { getCachedText } from '../search/cacheManager.js';
import { extractText } from '../search/textExtractor.js';
import { loadIndex, searchIndex } from '../index/indexBuilder.js';

// 우선순위 키워드 (파일명/폴더명 매칭용)
const PRIORITY_KEYWORDS = {
  companies: ['SKT', 'KT', 'LG', '네이버', '아프리카TV', 'OGQ', '카카오', '삼성'],
  services: ['채팅+', '마켓', '비즈챗', '메시지앱', 'OGQ마켓', '플러스'],
  docTypes: ['견적서', '계약서', '협약서', '소개서', '운영비용', '정산서', '청구서', '제안서'],
  topics: ['단가', '가격', '비용', '운영비', '정산', '종료일', '계약기간', '수수료', '요율', '청구', '납품', '검수']
};

const MAX_CANDIDATES = 50; // 최대 후보 문서 수

/**
 * 단어 경계 체크 (정확한 단어 매칭)
 */
function isExactWordMatch(text, word) {
  const lowerText = text.toLowerCase();
  const lowerWord = word.toLowerCase();

  // 정확한 단어 경계 패턴 (앞뒤로 단어 구분자 있어야 함)
  const pattern = new RegExp(`(?:^|[^a-z0-9가-힣])${lowerWord}(?:[^a-z0-9가-힣]|$)`, 'i');
  return pattern.test(lowerText);
}

/**
 * 질문에서 엔티티 추출
 * @param {string} question
 * @returns {Object} - { companies, services, docTypes, topics }
 */
function extractEntities(question) {
  const result = {
    companies: [],
    services: [],
    docTypes: [],
    topics: []
  };

  // 회사명 추출 (정확한 단어 매칭 필요)
  PRIORITY_KEYWORDS.companies.forEach(company => {
    if (isExactWordMatch(question, company)) {
      result.companies.push(company);
    }
  });

  // 서비스명 추출
  PRIORITY_KEYWORDS.services.forEach(service => {
    if (question.toLowerCase().includes(service.toLowerCase())) {
      result.services.push(service);
    }
  });

  // 문서유형 추출
  PRIORITY_KEYWORDS.docTypes.forEach(docType => {
    if (question.includes(docType)) {
      result.docTypes.push(docType);
    }
  });

  // 주제 추출
  PRIORITY_KEYWORDS.topics.forEach(topic => {
    if (question.includes(topic)) {
      result.topics.push(topic);
    }
  });

  return result;
}

/**
 * 질문 유형 분류
 * @param {string} question
 * @returns {string} - 'file_find', 'content_question', 'schedule_amount'
 */
function classifyQuestion(question) {
  const lowerQ = question.toLowerCase();

  // 문서 내용 질문 키워드 (우선 체크)
  // 계약 종료일, 시작일, 단가, 금액 등은 문서에서 찾아야 하는 내용
  const contentKeywords = [
    '종료일', '종료', '시작일', '계약기간', '기간',
    '단가', '가격', '비용', '운영비', '수수료', '요율',
    '요약', '내용', '설명', '무슨', '뭐야'
  ];

  for (const keyword of contentKeywords) {
    if (question.includes(keyword) || lowerQ.includes(keyword)) {
      console.log(`[classifyQuestion] 📋 문서 내용 질문으로 분류: "${question}" (키워드: ${keyword})`);
      return 'content_question';
    }
  }

  // 파일 찾기 키워드
  if (lowerQ.includes('찾아') || lowerQ.includes('어디') || lowerQ.includes('위치')) {
    console.log(`[classifyQuestion] 🔍 파일 찾기로 분류: "${question}"`);
    return 'file_find';
  }

  // 일정/금액 집계 키워드 (events_master.xlsx 기반)
  if (lowerQ.includes('일정') || lowerQ.includes('총액') || lowerQ.includes('합계')) {
    console.log(`[classifyQuestion] 📅 일정/금액 집계로 분류: "${question}"`);
    return 'schedule_amount';
  }

  // 기본값: 내용 질문
  console.log(`[classifyQuestion] 📄 기본값(내용 질문)으로 분류: "${question}"`);
  return 'content_question';
}

/**
 * 파일명/폴더명 기준으로 후보 필터링 및 스코어링
 * @param {Array<{path, ext, dir}>} files - 전체 파일 목록
 * @param {Array<string>} keywords - 검색 키워드 배열
 * @param {Object} entities - 추출된 엔티티
 * @returns {Array<{path, fileName, folderPath, score}>}
 */
function filterAndScoreCandidates(files, keywords, entities) {
  const scored = [];

  for (const file of files) {
    const fileName = file.path.split('/').pop();
    const folderPath = file.path.split('/').slice(0, -1).join('/');
    const folderName = folderPath.split('/').pop() || '';

    let score = 0;

    // 키워드별 매칭 점수 계산
    for (const keyword of keywords) {
      const lowerKeyword = keyword.toLowerCase();
      const lowerFileName = fileName.toLowerCase();
      const lowerFolderName = folderName.toLowerCase();

      // 파일명 직접 매칭: +10점
      if (lowerFileName.includes(lowerKeyword)) {
        score += 10;
      }

      // 폴더명 매칭: +5점
      if (lowerFolderName.includes(lowerKeyword)) {
        score += 5;
      }
    }

    // 엔티티 기반 스코어링 (정확한 매칭)
    entities.companies.forEach(company => {
      if (isExactWordMatch(fileName, company)) {
        score += 20;
      }
      if (isExactWordMatch(folderPath, company)) {
        score += 10;
      }
    });

    entities.services.forEach(service => {
      if (fileName.toLowerCase().includes(service.toLowerCase())) {
        score += 15;
      }
    });

    entities.docTypes.forEach(docType => {
      if (fileName.includes(docType)) {
        score += 12;
      }
    });

    // 주제 키워드 매칭
    entities.topics.forEach(topic => {
      if (fileName.includes(topic)) {
        score += 8;
      }
    });

    // 점수가 있는 파일만 추가
    if (score > 0) {
      scored.push({
        path: file.path,
        fileName,
        folderPath,
        score
      });
    }
  }

  // 점수 순 정렬 후 상위 MAX_CANDIDATES개 반환
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_CANDIDATES);
}

/**
 * 질문에서 키워드 추출
 * @param {string} question
 * @returns {string}
 */
function extractQuestionKeywords(question) {
  const stopwords = [
    '어디', '있어', '있나', '있는지', '있는',
    '문서', '파일', '폴더',
    '찾아', '찾아줘', '줘', '주세요',
    '들어가', '들어가있는', '들어가는',
    '관련', '관련된',
    '알려줘', '알려주세요',
    '보여줘', '보여주세요',
    '내용', '뭐야', '무슨',
    '요약해줘', '요약',
    '언제', '얼마'
  ];

  let keyword = question;

  // 특수문자 제거
  keyword = keyword.replace(/[?？!！.。]/g, ' ');

  // stopwords 제거
  stopwords.forEach(word => {
    keyword = keyword.replace(new RegExp(word, 'gi'), ' ');
  });

  // 공백 기준으로 분리 후 2글자 이상만 추출
  const words = keyword.split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 2);

  // 핵심 키워드 조합
  return words.join(' ').trim();
}

/**
 * 텍스트에서 질문 관련 스니펫 추출
 * @param {string} text - 문서 텍스트
 * @param {Array<string>} keywords - 검색 키워드 배열
 * @param {number} contextSize - 키워드 전후 컨텍스트 크기
 * @returns {Array<string>}
 */
function extractRelevantSnippets(text, keywords, contextSize = 100) {
  if (!text) return [];

  const snippets = [];
  const lowerText = text.toLowerCase();

  for (const keyword of keywords) {
    const lowerKeyword = keyword.toLowerCase();
    let index = 0;

    while (true) {
      index = lowerText.indexOf(lowerKeyword, index);
      if (index === -1) break;

      const start = Math.max(0, index - contextSize);
      const end = Math.min(text.length, index + keyword.length + contextSize);

      let snippet = text.substring(start, end);

      // 앞뒤 생략 표시
      if (start > 0) snippet = '...' + snippet;
      if (end < text.length) snippet = snippet + '...';

      snippets.push(snippet.trim());

      index += keyword.length;

      // 최대 3개까지만
      if (snippets.length >= 3) break;
    }

    if (snippets.length >= 3) break;
  }

  return snippets;
}

/**
 * 문서 내용 질문 처리 (데이터 반환)
 * @param {string} question - 사용자 질문
 * @returns {Promise<Object>}
 */
export async function handleDocumentQuestionForData(question) {
  console.log(`\n[handleDocumentQuestion] ========== 질문 분석 시작 ==========`);
  console.log(`[handleDocumentQuestion] 질문: "${question}"`);

  const keywords = extractQuestionKeywords(question);
  const entities = extractEntities(question);
  const questionType = classifyQuestion(question);

  console.log(`[handleDocumentQuestion] 추출된 키워드: "${keywords}"`);
  console.log(`[handleDocumentQuestion] 추출된 엔티티:`, JSON.stringify(entities));
  console.log(`[handleDocumentQuestion] 질문 유형: ${questionType}`);
  console.log(`[handleDocumentQuestion] =======================================\n`);

  if (!keywords) {
    return {
      error: '질문에서 키워드를 추출할 수 없습니다.',
      judgment: null,
      documents: [],
      certainty: 'insufficient',
      candidateCount: 0,
      analyzedCount: 0,
      entities,
      questionType
    };
  }

  const keywordArray = keywords.split(/\s+/).filter(k => k.length >= 2);

  // 1단계: 인덱스 기반 검색 시도
  const index = loadIndex();
  let candidateFiles = [];
  let usingIndex = false;

  if (index) {
    // 인덱스 사용
    const indexResults = searchIndex(keywords, {
      companies: entities.companies,
      services: entities.services,
      docTypes: entities.docTypes
    });

    if (indexResults.results.length > 0) {
      candidateFiles = indexResults.results.slice(0, MAX_CANDIDATES).map(doc => ({
        path: doc.path,
        ext: doc.ext
      }));
      usingIndex = true;
    }
  }

  // 인덱스 없거나 결과 없으면 전체 스캔
  if (!usingIndex || candidateFiles.length === 0) {
    const { files, truncated } = scanAllFiles();

    if (files.length === 0) {
      return {
        error: null,
        judgment: `문서를 찾을 수 없습니다.`,
        documents: [],
        certainty: 'insufficient',
        candidateCount: 0,
        analyzedCount: 0,
        entities,
        questionType
      };
    }

    candidateFiles = files;
  }

  // 2단계: 파일명/폴더명 기준 후보 필터링 및 스코어링
  const candidates = filterAndScoreCandidates(candidateFiles, keywordArray, entities);

  if (candidates.length === 0) {
    return {
      error: null,
      judgment: `"${keywords}" 관련 문서를 찾을 수 없습니다.`,
      documents: [],
      certainty: 'insufficient',
      candidateCount: 0,
      analyzedCount: 0,
      scopeNote: null,
      entities,
      questionType
    };
  }

  // 3단계: 후보 문서의 텍스트 검색 및 스니펫 추출
  const processedDocs = [];

  for (const candidate of candidates) {
    try {
      const { text, isScanned } = await getCachedText(candidate.path, extractText);

      if (isScanned || !text) {
        continue;
      }

      // 질문 관련 스니펫 추출
      const snippets = extractRelevantSnippets(text, keywordArray, 150);

      if (snippets.length > 0) {
        processedDocs.push({
          fileName: candidate.fileName,
          filePath: candidate.path,
          folderPath: candidate.folderPath,
          snippets: snippets.slice(0, 3),
          score: candidate.score
        });
      }

      // 상위 10개 문서에서 충분한 결과를 얻으면 중단
      if (processedDocs.length >= 10) {
        break;
      }
    } catch (err) {
      console.warn(`문서 처리 오류: ${candidate.fileName}`);
    }
  }

  // 4단계: 자연어 답변 생성
  let judgment = '';
  let naturalAnswer = '';
  let certainty = 'uncertain';

  // 질문 유형 분석
  const lowerQ = question.toLowerCase();
  let questionCategory = 'general';

  if (lowerQ.match(/정산|수익배분|금액|배분|비율|수수료|단가/)) {
    questionCategory = 'amount';
  } else if (lowerQ.match(/운영비|비용|청구|지불|납품/)) {
    questionCategory = 'cost';
  } else if (lowerQ.match(/해지|위약금|종료|계약종료|만료/)) {
    questionCategory = 'termination';
  } else if (lowerQ.match(/기간|시작|시작일|종료일|언제/)) {
    questionCategory = 'period';
  }

  if (processedDocs.length === 0) {
    // 문서를 찾지 못한 경우
    judgment = `관련 문서는 찾았지만 "${keywords}" 관련 답변 근거가 부족합니다.`;
    certainty = 'insufficient';

    // 자연어 답변 생성
    let intro = '';
    if (entities.companies.length > 0) {
      intro = entities.companies.join(', ');
    }
    if (entities.services.length > 0) {
      intro += (intro ? ' ' : '') + entities.services.join(', ');
    }

    if (intro) {
      naturalAnswer = `${intro} 관련 문서에서 질문에 직접 대응되는 내용을 찾지 못했습니다.\n문서 직접 확인이 필요합니다.`;
    } else {
      naturalAnswer = `"${keywords}" 관련 문서에서 질문에 직접 대응되는 내용을 찾지 못했습니다.\n문서 직접 확인이 필요합니다.`;
    }
  } else {
    // 문서를 찾은 경우
    const docCount = processedDocs.length;
    judgment = `${docCount}개 문서에서 "${keywords}" 관련 내용을 찾았습니다.\n아래 근거 스니펫을 참고하여 직접 확인하시기 바랍니다.`;
    certainty = 'found';

    // 자연어 답변 생성
    let intro = '';
    if (entities.companies.length > 0) {
      intro = entities.companies.join(', ');
    }
    if (entities.services.length > 0) {
      intro += (intro ? ' ' : '') + entities.services.join(', ');
    }

    // 스니펫 수집 및 정렬
    const allSnippets = [];
    processedDocs.forEach(doc => {
      doc.snippets.forEach(snippet => {
        allSnippets.push(snippet);
      });
    });

    // 질문 카테고리별 키워드로 스니펫 정렬
    const categoryKeywords = {
      amount: ['금액', '정산', '수익', '배분', '비율', '수수료', '단가'],
      cost: ['운영비', '비용', '청구', '지불', '납품'],
      termination: ['해지', '위약금', '종료', '만료'],
      period: ['기간', '시작', '종료일', '시작일']
    };

    if (questionCategory !== 'general' && categoryKeywords[questionCategory]) {
      allSnippets.sort((a, b) => {
        const aScore = categoryKeywords[questionCategory].reduce((score, keyword) => {
          return score + (a.includes(keyword) ? 1 : 0);
        }, 0);
        const bScore = categoryKeywords[questionCategory].reduce((score, keyword) => {
          return score + (b.includes(keyword) ? 1 : 0);
        }, 0);
        return bScore - aScore;
      });
    }

    // 자연어 인트로
    const answerLines = [];
    if (intro) {
      answerLines.push(`${intro} 관련 문서에서 다음 내용이 확인됩니다:`);
    } else {
      answerLines.push(`관련 문서에서 다음 내용이 확인됩니다:`);
    }
    answerLines.push('');

    // 상위 3~5개 스니펫 표시
    const displaySnippets = allSnippets.slice(0, 5);
    if (displaySnippets.length > 0) {
      displaySnippets.forEach(snippet => {
        // 스니펫을 150자로 제한
        let displaySnippet = snippet;
        if (displaySnippet.length > 150) {
          displaySnippet = displaySnippet.substring(0, 147) + '...';
        }
        answerLines.push(`• ${displaySnippet}`);
      });
    } else {
      // 스니펫이 없는 경우
      answerLines.push(`• 명확한 내용은 확인되지 않음`);
    }

    naturalAnswer = answerLines.join('\n');
  }

  return {
    error: null,
    keywords,
    judgment,
    naturalAnswer, // 새로 추가: 자연어 답변
    documents: processedDocs.slice(0, 5), // 최종 결과는 상위 5개만
    certainty,
    candidateCount: candidates.length,
    analyzedCount: Math.min(candidates.length, processedDocs.length + (candidates.length - processedDocs.length)),
    scopeNote: usingIndex && candidates.length >= MAX_CANDIDATES
      ? `인덱스를 활용하여 상위 ${MAX_CANDIDATES}개 관련 문서를 분석했습니다.`
      : null,
    entities,
    questionType,
    questionCategory // 새로 추가: 질문 카테고리
  };
}

/**
 * 문서 내용 질문 처리 (콘솔 출력 - 자연어 답변형)
 * @param {string} question
 */
export async function handleDocumentQuestion(question) {
  console.log(`📖 "${question}" 관련 문서 내용 검색 중...\n`);

  const result = await handleDocumentQuestionForData(question);

  if (result.error) {
    console.log(`오류: ${result.error}`);
    return;
  }

  // 질문 유형 분석 (우선순위 결정)
  const lowerQ = question.toLowerCase();
  let questionCategory = 'general';

  if (lowerQ.match(/정산|수익배분|금액|배분|비율|수수료|단가/)) {
    questionCategory = 'amount';
  } else if (lowerQ.match(/운영비|비용|청구|지불|납품/)) {
    questionCategory = 'cost';
  } else if (lowerQ.match(/해지|위약금|종료|계약종료|만료/)) {
    questionCategory = 'termination';
  } else if (lowerQ.match(/기간|시작|시작일|종료일|언제/)) {
    questionCategory = 'period';
  }

  console.log('='.repeat(80));
  console.log(`📝 답변\n`);

  // 1. 자연어 인트로 생성
  if (result.certainty === 'insufficient') {
    console.log(`"${result.keywords || question}" 관련 문서에서 질문에 직접 대응되는 내용을 찾지 못했습니다.`);
    console.log(`문서 직접 확인이 필요합니다.\n`);
  } else if (result.documents.length === 0) {
    console.log(`관련 문서를 찾을 수 없습니다.\n`);
  } else {
    // 엔티티 기반 인트로 생성
    let intro = '';
    if (result.entities.companies.length > 0) {
      intro = result.entities.companies.join(', ');
    }
    if (result.entities.services.length > 0) {
      intro += (intro ? ' ' : '') + result.entities.services.join(', ');
    }

    if (intro) {
      console.log(`${intro} 관련 문서에서 다음 내용이 확인됩니다:\n`);
    } else {
      console.log(`관련 문서에서 다음 내용이 확인됩니다:\n`);
    }

    // 2. 핵심 스니펫 표시 (질문 유형별 우선순위 적용)
    const allSnippets = [];
    result.documents.forEach(doc => {
      doc.snippets.forEach(snippet => {
        allSnippets.push({
          snippet,
          fileName: doc.fileName,
          filePath: doc.filePath
        });
      });
    });

    // 질문 카테고리별 키워드로 스니펫 정렬
    const categoryKeywords = {
      amount: ['금액', '정산', '수익', '배분', '비율', '수수료', '단가'],
      cost: ['운영비', '비용', '청구', '지불', '납품'],
      termination: ['해지', '위약금', '종료', '만료'],
      period: ['기간', '시작', '종료일', '시작일']
    };

    if (questionCategory !== 'general' && categoryKeywords[questionCategory]) {
      allSnippets.sort((a, b) => {
        const aScore = categoryKeywords[questionCategory].reduce((score, keyword) => {
          return score + (a.snippet.includes(keyword) ? 1 : 0);
        }, 0);
        const bScore = categoryKeywords[questionCategory].reduce((score, keyword) => {
          return score + (b.snippet.includes(keyword) ? 1 : 0);
        }, 0);
        return bScore - aScore;
      });
    }

    // 상위 3~5개 스니펫만 표시
    const displaySnippets = allSnippets.slice(0, 5);
    displaySnippets.forEach((item, idx) => {
      // 스니펫을 짧게 요약 (150자 이하)
      let displaySnippet = item.snippet;
      if (displaySnippet.length > 150) {
        displaySnippet = displaySnippet.substring(0, 147) + '...';
      }
      console.log(`• ${displaySnippet}`);
    });

    console.log('');
  }

  // 3. 참고 문서 목록
  if (result.documents.length > 0) {
    console.log(`📚 참고 문서 (${result.documents.length}개)\n`);

    for (let i = 0; i < result.documents.length; i++) {
      const doc = result.documents[i];
      console.log(`  ${i + 1}. ${doc.fileName}`);
    }

    console.log('');
  }

  console.log('='.repeat(80));

  // 4. 상세 근거 (기존 형식 유지하되 섹션 분리)
  if (result.documents.length > 0) {
    console.log('📄 상세 근거\n');

    for (let i = 0; i < result.documents.length; i++) {
      const doc = result.documents[i];
      const isGDriveNative = doc.filePath && doc.filePath.startsWith('gdrive://');
      const displayLocation = isGDriveNative ? 'Google Drive' : doc.folderPath;

      console.log(`[${i + 1}] ${doc.fileName}`);
      console.log(`    위치: ${displayLocation}`);
      if (isGDriveNative) {
        const driveLink = doc.webViewLink || doc.filePath;
        console.log(`    Drive에서 열기: ${driveLink}`);
      }
      console.log(`    근거:`);

      doc.snippets.forEach((snippet, idx) => {
        console.log(`      - ${snippet}`);
      });
      console.log('');
    }

    console.log('='.repeat(80));
  }

  // 5. 확인 필요 안내 (확실성이 낮을 때만)
  if (result.certainty === 'found') {
    console.log('\n💡 위 내용은 문서에서 추출한 것입니다. 정확한 정보는 문서를 직접 확인하시기 바랍니다.');
  } else if (result.certainty === 'uncertain') {
    console.log('\n⚠️  관련 문서는 찾았으나 명확한 답변이 어렵습니다. 문서 직접 확인이 필요합니다.');
  }
}
