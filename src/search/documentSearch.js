/**
 * 문서 내용 검색
 */
import { scanAllFiles } from '../inbox/scanner.js';
import { extractText } from './textExtractor.js';
import { getCachedText } from './cacheManager.js';
import { loadIndex, searchIndex } from '../index/indexBuilder.js';
import { isDriveDesktopPath } from '../config/driveConfig.js';

const SNIPPET_CONTEXT = 50; // 키워드 전후 50자
const MAX_SNIPPETS = 3; // 파일당 최대 스니펫 수
const MAX_RESULTS = 20; // 최대 결과 파일 수

// 키워드 카테고리 정의
const KEYWORDS = {
  companies: ['KT', 'SKT', 'LG', '네이버', '아프리카TV', 'OGQ', '카카오', '삼성'],
  services: ['채팅+', '마켓', '비즈챗', '메시지앱', 'OGQ마켓', '플러스'],
  docTypes: ['계약', '계약서', '협약', '협약서', '견적', '견적서', '정산', '정산서', '제안서', '소개서', '운영비용', '청구', '청구서'],
  finalStates: ['최종', '최종본', '최종날인', '날인본', '서명본', '체결본', 'signed', 'executed'],
  draftStates: ['v1', 'v2', 'v3', 'v0', '검토', 'draft', '초안', 'review']
};

// 검색 모드
const SEARCH_MODES = {
  FILE_PRIORITY: 'file_priority',  // 파일 찾기 우선
  CONTENT_PRIORITY: 'content_priority'  // 내용 질문
};

// 주제 키워드 동의어 맵 (topic synonym mapping)
const TOPIC_SYNONYMS = {
  'ip활용': ['IP 활용', 'IP활용', 'IP콘텐츠', 'IP 콘텐츠', '콘텐츠 활용', 'IP', '지식재산'],
  '마케팅': ['홍보', '프로모션', '브랜딩', '광고', '캠페인', '마케팅'],
  '프로모션': ['마케팅', '홍보', '이벤트', '프로모션', '캠페인'],
  '브랜드': ['브랜딩', '브랜드', 'BI', '로고', '아이덴티티'],
  '운영': ['운영', '관리', '매니지먼트', 'operation'],
  '정산': ['정산', '결제', '지급', '정산서', '청구'],
  '제안': ['제안', '제안서', 'proposal', 'RFP'],
  '견적': ['견적', '견적서', 'quote', 'quotation'],
  '계약': ['계약', '계약서', 'contract', '협약'],
  '협약': ['협약', '협약서', 'agreement', '계약']
};

/**
 * 주제 키워드를 동의어로 확장
 * @param {string} keyword - 원본 키워드
 * @returns {string[]} - 확장된 키워드 목록 (원본 포함)
 */
function expandTopicKeyword(keyword) {
  const lowerKeyword = keyword.toLowerCase();

  // 동의어 맵에서 매칭되는 항목 찾기
  for (const [key, synonyms] of Object.entries(TOPIC_SYNONYMS)) {
    if (lowerKeyword.includes(key.toLowerCase()) ||
        synonyms.some(syn => lowerKeyword.includes(syn.toLowerCase()))) {
      return [keyword, ...synonyms];
    }
  }

  return [keyword]; // 매칭 없으면 원본만 반환
}

/**
 * 검색 모드 판별 (파일명/폴더명 중심 알고리즘)
 * @param {string} originalQuestion - 원본 질문
 * @returns {string} - SEARCH_MODES 중 하나
 */
function detectSearchMode(originalQuestion) {
  const lowerQ = originalQuestion.toLowerCase();

  // 파일 찾기 우선 키워드 (문서 찾기, 요약)
  const filePriorityKeywords = [
    '찾아줘', '찾아', '어디', '위치', '폴더',
    '요약해줘', '요약해', '요약', '정리해줘', '정리',
    '계약서', '협약서', '견적서', '소개서', '제안서', '청구서'
  ];
  const hasFilePriorityKeyword = filePriorityKeywords.some(kw => lowerQ.includes(kw));

  // 내용 질문 키워드 (본문 분석 필요)
  const contentKeywords = ['내용', '뭐야', '무슨', '조항', '단가', '얼마', '언제', '기간'];
  const hasContentKeyword = contentKeywords.some(kw => lowerQ.includes(kw));

  // 파일 찾기/요약 키워드가 있으면 파일 우선
  if (hasFilePriorityKeyword) {
    return SEARCH_MODES.FILE_PRIORITY;
  }

  // 내용 키워드만 있으면 내용 우선
  if (hasContentKeyword) {
    return SEARCH_MODES.CONTENT_PRIORITY;
  }

  // 기본값: 파일 우선
  return SEARCH_MODES.FILE_PRIORITY;
}

/**
 * 키워드에서 회사명/서비스명/문서유형 추출 (정확한 매칭)
 * @param {string} keyword
 * @returns {Object} - { companies, services, docTypes }
 */
function extractKeywordCategories(keyword) {
  const lowerKeyword = keyword.toLowerCase();
  const words = keyword.split(/\s+/);

  const result = {
    companies: [],
    services: [],
    docTypes: []
  };

  // 각 단어와 전체 키워드에서 매칭
  [...words, keyword].forEach(word => {
    const lowerWord = word.trim().toLowerCase();
    if (lowerWord.length < 2) return;

    // 회사명 매칭 (정확한 일치만)
    KEYWORDS.companies.forEach(company => {
      const lowerCompany = company.toLowerCase();
      // 정확히 일치하거나 단어 경계가 있는 경우만
      if (lowerWord === lowerCompany || isExactWordMatch(word, company)) {
        if (!result.companies.includes(company)) {
          result.companies.push(company);
        }
      }
    });

    // 서비스명 매칭 (띄어쓰기 무시)
    KEYWORDS.services.forEach(service => {
      if (matchesWithOrWithoutSpaces(word, service)) {
        if (!result.services.includes(service)) {
          result.services.push(service);
        }
      }
    });

    // 문서유형 매칭 (띄어쓰기 무시)
    KEYWORDS.docTypes.forEach(docType => {
      if (matchesWithOrWithoutSpaces(word, docType)) {
        if (!result.docTypes.includes(docType)) {
          result.docTypes.push(docType);
        }
      }
    });
  });

  return result;
}

/**
 * 텍스트에서 키워드 위치 찾기
 */
function findKeywordPositions(text, keyword) {
  const positions = [];
  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();

  let index = 0;
  while (true) {
    index = lowerText.indexOf(lowerKeyword, index);
    if (index === -1) break;
    positions.push(index);
    index += lowerKeyword.length;
  }

  return positions;
}

/**
 * 스니펫 생성 (키워드 전후 컨텍스트)
 */
function createSnippet(text, position, keyword) {
  const start = Math.max(0, position - SNIPPET_CONTEXT);
  const end = Math.min(text.length, position + keyword.length + SNIPPET_CONTEXT);

  let snippet = text.substring(start, end);

  // 앞뒤 생략 표시
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  // 키워드 강조
  const regex = new RegExp(`(${keyword})`, 'gi');
  snippet = snippet.replace(regex, '**$1**');

  return snippet.trim();
}

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
 * 텍스트에서 모든 공백 제거 (검색 정규화용)
 */
function removeSpaces(text) {
  if (!text) return '';
  return text.replace(/\s+/g, '');
}

/**
 * 텍스트 매칭 (띄어쓰기 무시 옵션)
 * @param {string} text - 검색 대상 텍스트
 * @param {string} keyword - 검색 키워드
 * @returns {boolean} - 매칭 여부
 */
function matchesWithOrWithoutSpaces(text, keyword) {
  if (!text || !keyword) return false;

  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();

  // 1. 원본 그대로 매칭
  if (lowerText.includes(lowerKeyword)) {
    return true;
  }

  // 2. 공백 제거 후 매칭
  const textNoSpace = removeSpaces(lowerText);
  const keywordNoSpace = removeSpaces(lowerKeyword);

  return textNoSpace.includes(keywordNoSpace);
}

// 파일명/표시명 결정 헬퍼
function resolveDisplayFileName(doc = {}) {
  const candidates = [doc.fileName, doc.title, doc.name, doc.displayName]
    .map(v => typeof v === 'string' ? v.trim() : '')
    .filter(Boolean);

  for (const value of candidates) {
    if (!value.startsWith('gdrive://')) {
      return value;
    }
  }

  const pathValue = typeof doc.path === 'string' ? doc.path.trim() : '';
  if (pathValue.startsWith('gdrive://')) {
    return 'Google Drive 문서';
  }

  if (pathValue) {
    return pathValue.split('/').pop();
  }

  return '문서';
}

/**
 * 파일명이 제목 없는 일반 이름인지 확인
 */
function isGenericFileName(fileName) {
  return /^(제목 없는 문서|Google Drive 문서|문서|gdrive:\/\/)/.test(fileName);
}

/**
 * 결과 포함 여부 판단
 */
function shouldIncludeResult(fileScore, finalScore, highAccuracy, matchInfo, usingIndex) {
  // 1. finalScore가 있으면 무조건 포함
  if (finalScore > 0) return true;

  // 2. 인덱스 사용 중이고 fileScore > 0이면 포함
  if (usingIndex && fileScore > 0) return true;

  // 3. 인덱스 사용 중이고 highAccuracy이면 포함
  if (usingIndex && highAccuracy) return true;

  // 4. 인덱스 사용 중이고 파일명/폴더명 매칭이 있으면 포함
  if (usingIndex && matchInfo && matchInfo.length > 0) {
    const hasFileOrFolderMatch = matchInfo.some(info =>
      info.includes('파일명') || info.includes('폴더명')
    );
    if (hasFileOrFolderMatch) return true;
  }

  return false;
}

/**
 * 파일/폴더 기반 스코어 계산 (파일명/폴더명 중심 알고리즘)
 * @param {string} fileName
 * @param {string} folderPath
 * @param {Array<string>} allKeywords - 검색 키워드 배열
 * @param {Object} categories - 추출된 카테고리
 * @returns {Object} - { score, matchInfo, highAccuracy }
 */
function calculateFileScore(fileName, folderPath, allKeywords, categories) {
  // macOS NFD 유니코드 정규화 (한글 자모 분리 문제 해결)
  const normalizedFileName = fileName.normalize('NFC');
  const lowerFileName = normalizedFileName.toLowerCase();
  const lowerFolderPath = folderPath.toLowerCase();
  const folderName = folderPath.split('/').pop() || '';
  const lowerFolderName = folderName.toLowerCase();

  let score = 0;
  const matchInfo = [];
  let highAccuracy = false;
  let isFinalDocument = false;

  // 0. 문서 상태 체크 (최종/검토)
  let hasFinalState = false;
  KEYWORDS.finalStates.forEach(state => {
    if (lowerFileName.includes(state.toLowerCase())) {
      score += 30;
      matchInfo.push(`최종 문서: ${state}`);
      hasFinalState = true;
      isFinalDocument = true;
    }
  });

  // 검토 문서 감점
  let isDraftDocument = false;
  KEYWORDS.draftStates.forEach(state => {
    if (lowerFileName.includes(state.toLowerCase())) {
      score -= 15;
      matchInfo.push(`검토본: ${state}`);
      isDraftDocument = true;
    }
  });

  // 1. 파일명에 회사명 포함 +25
  let hasCompanyInFile = false;
  categories.companies.forEach(company => {
    const lowerCompany = company.toLowerCase();

    if (
      isExactWordMatch(fileName, company) ||
      matchesWithOrWithoutSpaces(fileName, company)
    ) {
      score += 25;
      matchInfo.push(`파일명: ${company}`);
      hasCompanyInFile = true;
    }
  });

  // 2. 파일명에 문서유형 포함 +20 (기본형 매칭 강화)
  let hasDocTypeInFile = false;
  categories.docTypes.forEach(docType => {
    const lowerDocType = docType.toLowerCase();

    // 1. 정확 매칭 (띄어쓰기 무시)
    if (matchesWithOrWithoutSpaces(fileName, docType)) {
      score += 20;
      matchInfo.push(`파일명: ${docType}`);
      hasDocTypeInFile = true;
      return;
    }

    // 2. 기본형 매칭 (계약서 → 계약, 띄어쓰기 무시)
    const baseForm = docType.replace(/서$/, '');
    if (baseForm && matchesWithOrWithoutSpaces(fileName, baseForm)) {
      score += 18; // 강화
      matchInfo.push(`파일명(기본형): ${baseForm}`);
      hasDocTypeInFile = true;
      return;
    }
  });

  // 3. 회사명 + 문서유형 동시 포함 보너스 +40 (추가 보너스)
  if (hasCompanyInFile && hasDocTypeInFile) {
    score += 40;
    matchInfo.push('✓ 완전 매칭');
    highAccuracy = true;
  }

  // 4. 폴더명에 회사명 포함 +18
  categories.companies.forEach(company => {
    if (isExactWordMatch(folderName, company)) {
      score += 18;
      matchInfo.push(`폴더명: ${company}`);
    }
  });

  // 5. 폴더명에 문서유형 포함 +12
  categories.docTypes.forEach(docType => {
    if (matchesWithOrWithoutSpaces(folderName, docType)) {
      score += 12;
      matchInfo.push(`폴더명: ${docType}`);
    }
  });

  // 6. 서비스명 포함 +10
  categories.services.forEach(service => {
    if (matchesWithOrWithoutSpaces(fileName, service)) {
      score += 10;
      matchInfo.push(`서비스: ${service}`);
    }
    if (matchesWithOrWithoutSpaces(folderPath, service)) {
      score += 5;
    }
  });

  // 7. 회사명 불일치 패널티 -15 (약화)
  // 단, 파일명에 질문의 회사명이 있으면 패널티 약화
  if (categories.companies.length > 0 && !hasCompanyInFile) {
    const otherCompanies = KEYWORDS.companies.filter(c =>
      !categories.companies.includes(c)
    );

    otherCompanies.forEach(otherCompany => {
      if (isExactWordMatch(fileName, otherCompany)) {
        score -= 15;
        matchInfo.push(`타사: ${otherCompany}`);
      }
    });
  }

  // fallback 1: docType만 있어도 최소 점수 부여 (후보 탈락 방지)
  if (score === 0 && categories.docTypes.length > 0) {
    score += 10;
    matchInfo.push('fallback: docType');
  }

  // fallback 2: 주제 키워드 매칭 (company/docType/service가 없을 때)
  if (categories.companies.length === 0 && categories.docTypes.length === 0 && categories.services.length === 0) {
    // 모든 키워드를 주제 키워드로 취급 (동의어 확장 적용)
    allKeywords.forEach(keyword => {
      // 키워드를 동의어로 확장
      const expandedKeywords = expandTopicKeyword(keyword);
      let keywordMatched = false;

      // 확장된 키워드 중 하나라도 매칭되는지 확인
      for (const expandedKw of expandedKeywords) {
        // 파일명 매칭 (띄어쓰기 무시)
        if (matchesWithOrWithoutSpaces(fileName, expandedKw)) {
          score += 20;
          if (!keywordMatched) {
            matchInfo.push(`주제: ${keyword}`);
            keywordMatched = true;
          }
        }

        // 폴더명 매칭 (띄어쓰기 무시)
        if (matchesWithOrWithoutSpaces(folderPath, expandedKw)) {
          score += 8;
          if (!keywordMatched) {
            keywordMatched = true;
          }
        }

        // 하나라도 매칭되면 다음 키워드로
        if (keywordMatched) break;
      }
    });

    // 최소 점수 보장 (키워드가 하나라도 매칭되면)
    if (score === 0 && allKeywords.length > 0) {
      // 키워드 중 일부라도 파일명/폴더명에 있는지 체크 (동의어 포함, 띄어쓰기 무시)
      const hasAnyMatch = allKeywords.some(keyword => {
        const expandedKeywords = expandTopicKeyword(keyword);
        return expandedKeywords.some(expandedKw => {
          return matchesWithOrWithoutSpaces(fileName, expandedKw) ||
                 matchesWithOrWithoutSpaces(folderPath, expandedKw);
        });
      });

      if (hasAnyMatch) {
        score += 5;
        matchInfo.push('주제 부분 매칭');
      }
    }
  }

  return { score, matchInfo, highAccuracy, isFinalDocument };
}

/**
 * 키워드로 문서 검색
 * @param {string} keyword - 검색 키워드
 * @param {Object} options - 검색 옵션
 * @param {boolean} options.silent - true면 콘솔 로그 출력 안 함
 * @param {string} options.originalQuestion - 원본 질문 (검색 모드 판별용)
 * @returns {Promise<Object>} - { results, truncated, searchMode, categories }
 */
export async function searchDocuments(keyword, options = {}) {
  const { silent = false, originalQuestion = '', sourceType = null } = options;

  // 검색 모드 판별
  const searchMode = detectSearchMode(originalQuestion || keyword);

  // 키워드 카테고리 추출
  const categories = extractKeywordCategories(keyword);
  // 숫자는 1자리도 포함, 문자는 2자 이상
  const allKeywords = keyword.split(/\s+/).filter(k => {
    if (/^\d+$/.test(k)) return true; // 숫자만 있으면 길이 무관
    return k.length >= 2; // 문자는 2자 이상
  });

  if (!silent) {
    let searchLabel = `"${keyword}" 검색 중...`;
    if (sourceType === 'gdrive-desktop') {
      searchLabel += ' (Google Drive)';
    } else if (sourceType === 'local') {
      searchLabel += ' (로컬)';
    }
    console.log(searchLabel);
    console.log(`검색 모드: ${searchMode === SEARCH_MODES.FILE_PRIORITY ? '파일 찾기 우선' : '내용 질문'}\n`);
  }

  // 인덱스 기반 검색 시도
  const index = loadIndex();
  let candidateFiles = [];
  let usingIndex = false;

  if (index) {
    // 인덱스 사용
    if (!silent) {
      console.log(`📚 인덱스 사용 (총 ${index.totalDocuments}개 문서 인덱싱됨)`);
    }

    const indexOptions = {
      companies: categories.companies,
      services: categories.services,
      docTypes: categories.docTypes
    };

    if (sourceType) {
      indexOptions.sourceType = sourceType;
    }

    const indexResults = searchIndex(keyword, indexOptions);

    if (indexResults.results.length > 0) {
      // 상위 50개 후보만 추출 (gdrive-native의 경우 textPreview와 webViewLink도 포함)
      candidateFiles = indexResults.results.slice(0, 50).map(doc => ({
        path: doc.path,
        fileName: resolveDisplayFileName(doc),
        ext: doc.ext,
        textPreview: doc.textPreview,
        sourceType: doc.sourceType,
        webViewLink: doc.webViewLink
      }));

      usingIndex = true;
      if (!silent) {
        console.log(`   → ${indexResults.results.length}개 후보 발견, 상위 ${candidateFiles.length}개 상세 분석\n`);
      }
    } else {
      if (!silent) {
        console.log(`   → 인덱스에서 일치하는 문서 없음, 전체 스캔으로 전환\n`);
      }
    }
  } else {
    // 인덱스 없음
    if (!silent) {
      console.log(`💡 팁: 'node index.js reindex' 명령으로 인덱스를 생성하면 검색이 더 빨라집니다.\n`);
    }
  }

  // 인덱스 사용하지 않거나 후보가 없으면 전체 스캔
  if (!usingIndex || candidateFiles.length === 0) {
    const { files, truncated } = scanAllFiles();

    if (files.length === 0) {
      return { results: [], truncated: false, searchMode, categories };
    }

    candidateFiles = files;

    if (!silent) {
      console.log(`스캔된 파일: ${files.length}개`);
      if (truncated) {
        console.log(`⚠️  파일 수 제한(200개) 도달\n`);
      } else {
        console.log('');
      }
    }
  }

  const results = [];
  let processed = 0;
  let cached = 0;

  for (const file of candidateFiles) {
    const filePath = file.path;
    const fileName = file.fileName || resolveDisplayFileName(file);
    const folderPath = filePath.split('/').slice(0, -1).join('/');
    const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();

    // sourceType 결정
    let fileSourceType = 'local';
    if (filePath.startsWith('gdrive://')) {
      fileSourceType = 'gdrive-native';
    } else if (isDriveDesktopPath(filePath)) {
      fileSourceType = 'gdrive-desktop';
    }

    // sourceType 필터링
    if (sourceType && fileSourceType !== sourceType) {
      continue;
    }

    try {
      // 파일명/폴더명 기반 스코어 계산
      const { score: fileScore, matchInfo, highAccuracy, isFinalDocument } = calculateFileScore(
        fileName,
        folderPath,
        allKeywords,
        categories
      );

      // 디버그 로그
      if (!silent && fileScore > 0) {
        console.log(`[후보] ${fileName} (preScore: ${fileScore}${highAccuracy ? ', 정확도높음' : ''})`);
      }

      // 텍스트 가져오기
      let text = '';
      let isScanned = false;
      let fromCache = false;
      let extractedTextAvailable = true;
      let extractionError = null;
      let ocrUsed = false;
      let ocrSucceeded = false;

      if (fileSourceType === 'gdrive-native') {
        // gdrive-native는 인덱스의 textPreview 사용 (file에 이미 포함되어 있음)
        text = file.textPreview || '';
        fromCache = true;
        extractedTextAvailable = text.length > 0;
      } else {
        // 로컬 파일 또는 gdrive-desktop는 캐시된 텍스트 가져오기
        const result = await getCachedText(filePath, extractText);
        text = result.text;
        isScanned = result.isScanned;
        fromCache = result.fromCache;
        extractedTextAvailable = result.extractedTextAvailable;
        extractionError = result.extractionError;
        ocrUsed = result.ocrUsed;
        ocrSucceeded = result.ocrSucceeded;
      }

      if (fromCache) cached++;
      processed++;

      // 진행 상황 출력 (10개마다)
      if (!silent && processed % 10 === 0) {
        process.stdout.write(`\r처리 중: ${processed}/${candidateFiles.length} (캐시: ${cached})`);
      }

      let finalScore = fileScore;
      let snippets = [];

      // 스캔본 또는 텍스트 추출 실패 처리
      if (!extractedTextAvailable && ext === '.pdf') {
        if (fileScore > 0) {
          let statusMessage = '';

          if (ocrUsed && !ocrSucceeded) {
            statusMessage = '[스캔본 PDF] OCR 실패 - 텍스트 추출 불가';
          } else if (extractionError) {
            statusMessage = `[추출 오류] ${extractionError}`;
          } else if (isScanned) {
            statusMessage = '[스캔본 PDF] 텍스트 추출 불가 - OCR 필요';
          } else {
            statusMessage = '[텍스트 없음] 내용 분석 제한';
          }

          results.push({
            filePath,
            fileName,
            isScanned: true,
            extractedTextAvailable: false,
            extractionError,
            ocrUsed: ocrUsed || false,
            ocrSucceeded: ocrSucceeded || false,
            snippets: [statusMessage],
            score: fileScore,
            matchInfo,
            highAccuracy,
            isFinalDocument
          });
        }
        continue;
      }

      // 텍스트 본문 검색 (보조 점수 - 매우 제한적)
      if (text) {
        const positions = findKeywordPositions(text, keyword);

        if (positions.length > 0) {
          snippets = positions
            .slice(0, MAX_SNIPPETS)
            .map(pos => createSnippet(text, pos, keyword));

          // 짧은 회사명(KT, SK, LG) 체크
          const hasShortCompany = categories.companies.some(c =>
            ['KT', 'SKT', 'LG'].includes(c)
          );

          // 본문 점수 계산
          let contentScore = 0;
          if (searchMode === SEARCH_MODES.FILE_PRIORITY) {
            // 파일 찾기 모드: 본문 매칭은 최대 +5점
            // 짧은 회사명인 경우 본문 점수 거의 안 줌 (최대 +1점만)
            if (hasShortCompany) {
              contentScore = Math.min(positions.length * 0.2, 1);
            } else {
              contentScore = Math.min(positions.length, 5);
            }
          } else {
            // 내용 질문 모드: 본문 매칭도 중요하므로 +10점까지
            if (hasShortCompany) {
              contentScore = Math.min(positions.length * 0.5, 5);
            } else {
              contentScore = Math.min(positions.length * 2, 10);
            }
          }

          finalScore += contentScore;

          if (contentScore > 0) {
            matchInfo.push(`본문: ${positions.length}회`);
          }
        }
      }

      // 결과 포함 여부 판단
      const include = shouldIncludeResult(fileScore, finalScore, highAccuracy, matchInfo, usingIndex);

      if (!silent && fileScore > 0) {
        console.log(`  finalScore: ${finalScore}, snippets: ${snippets.length}개`);
        if (!include) {
          console.log(`  ❌ 탈락`);
        }
      }

      if (include) {
        const resultObj = {
          filePath,
          fileName,
          isScanned: false,
          snippets: snippets.length > 0 ? snippets : ['(파일명/폴더명 매칭)'],
          score: finalScore > 0 ? finalScore : fileScore,
          matchInfo: matchInfo.length > 0 ? matchInfo : ['기본 매칭'],
          highAccuracy,
          isFinalDocument,
          sourceType: fileSourceType
        };

        if (fileSourceType === 'gdrive-native' && file.webViewLink) {
          resultObj.webViewLink = file.webViewLink;
        }

        if (!silent) {
          console.log(`  ✅ 포함 (점수: ${resultObj.score})`);
        }

        results.push(resultObj);
      }
    } catch (err) {
      if (!silent) {
        console.warn(`\n오류: ${fileName} - ${err.message}`);
      }
    }
  }

  if (!silent) {
    console.log(`\r처리 완료: ${processed}/${candidateFiles.length} (캐시: ${cached})\n`);
  }

  // 정렬 규칙: 점수 우선, 같은 점수면 품질 기준 정렬
  results.sort((a, b) => {
    // 1. 점수 우선
    if (a.score !== b.score) {
      return b.score - a.score;
    }

    // 2. 점수가 같을 때 세부 기준
    const aIsGeneric = isGenericFileName(a.fileName);
    const bIsGeneric = isGenericFileName(b.fileName);

    // 일반 이름은 최하위
    if (aIsGeneric && !bIsGeneric) return 1;
    if (!aIsGeneric && bIsGeneric) return -1;

    // highAccuracy 우선
    if (a.highAccuracy && !b.highAccuracy) return -1;
    if (!a.highAccuracy && b.highAccuracy) return 1;

    // 회사명 매칭 우선
    const aHasCompany = a.matchInfo && a.matchInfo.some(info => KEYWORDS.companies.some(c => info.includes(c)));
    const bHasCompany = b.matchInfo && b.matchInfo.some(info => KEYWORDS.companies.some(c => info.includes(c)));
    if (aHasCompany && !bHasCompany) return -1;
    if (!aHasCompany && bHasCompany) return 1;

    return 0;
  });

  // fallback 결과(score 10) 제한: 최대 2개까지만
  const highQualityResults = results.filter(r => r.score >= 18);
  const fallbackResults = results.filter(r => r.score < 18).slice(0, 2);
  const filteredResults = [...highQualityResults, ...fallbackResults];

  if (!silent && fallbackResults.length < results.filter(r => r.score < 18).length) {
    console.log(`⚠️  저품질 fallback 결과 ${results.filter(r => r.score < 18).length - fallbackResults.length}개 제외됨\n`);
  }

  return {
    results: filteredResults.slice(0, MAX_RESULTS),
    truncated: usingIndex ? false : (candidateFiles.length >= 200),
    searchMode,
    categories,
    usingIndex,
    totalCandidates: candidateFiles.length
  };
}
