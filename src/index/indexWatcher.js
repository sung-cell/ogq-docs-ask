/**
 * 자동 인덱싱 감시자
 * 파일 시스템 변경 감지 시 증분 인덱스 업데이트
 */

import chokidar from 'chokidar';
import { existsSync, statSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { basename, dirname, extname } from 'path';
import { createRequire } from 'module';
import { loadIndex } from './indexBuilder.js';
import { getCachedText } from '../search/cacheManager.js';
import { extractText } from '../search/textExtractor.js';
import { extractContractMetadata } from '../extract/contractExtractor.js';
import { getDriveDesktopRoots, isDriveDesktopPath } from '../config/driveConfig.js';

const require = createRequire(import.meta.url);
const { getDocumentsIndexPath, getContractsMetaPath, getIndexDir, ensureDirectories } = require('../config/runtimePaths.cjs');

const INDEX_FILE = getDocumentsIndexPath();
const CONTRACTS_META_FILE = getContractsMetaPath();
const PARSEABLE_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.pdf', '.docx', '.pptx', '.txt'];

// 키워드 카테고리
const KEYWORDS = {
  companies: ['KT', 'SKT', 'LG', '네이버', '아프리카TV', 'OGQ', '카카오', '삼성'],
  services: ['채팅+', '마켓', '비즈챗', '메시지앱', 'OGQ마켓', '플러스'],
  docTypes: ['계약서', '협약서', '견적서', '정산서', '제안서', '소개서', '운영비용', '청구서']
};

// 디바운스 맵 (파일별 타이머)
const debounceTimers = new Map();
const DEBOUNCE_DELAY = 1500; // 1.5초

/**
 * 파일명/경로에서 태그 추출
 */
function extractTags(fileName, folderPath) {
  const text = `${fileName} ${folderPath}`.toLowerCase();
  const tags = {
    companies: [],
    services: [],
    docTypes: []
  };

  // 회사명 추출
  KEYWORDS.companies.forEach(company => {
    if (text.includes(company.toLowerCase())) {
      tags.companies.push(company);
    }
  });

  // 서비스명 추출
  KEYWORDS.services.forEach(service => {
    if (text.includes(service.toLowerCase())) {
      tags.services.push(service);
    }
  });

  // 문서유형 추출
  KEYWORDS.docTypes.forEach(docType => {
    if (text.includes(docType.toLowerCase())) {
      tags.docTypes.push(docType);
    }
  });

  return tags;
}

/**
 * 인덱스 저장 (통계 재계산 포함)
 */
function saveIndex(documents) {
  const index = {
    documents,
    indexedAt: new Date().toISOString(),
    totalDocuments: documents.length,
    stats: {
      byExt: {},
      byCompany: {},
      byService: {},
      byDocType: {}
    }
  };

  // 통계 계산
  documents.forEach(doc => {
    // 확장자별
    index.stats.byExt[doc.ext] = (index.stats.byExt[doc.ext] || 0) + 1;

    // 회사별
    doc.tags.companies.forEach(company => {
      index.stats.byCompany[company] = (index.stats.byCompany[company] || 0) + 1;
    });

    // 서비스별
    doc.tags.services.forEach(service => {
      index.stats.byService[service] = (index.stats.byService[service] || 0) + 1;
    });

    // 문서유형별
    doc.tags.docTypes.forEach(docType => {
      index.stats.byDocType[docType] = (index.stats.byDocType[docType] || 0) + 1;
    });
  });

  // 인덱스 디렉토리 생성
  ensureDirectories();

  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), 'utf-8');
}

/**
 * 계약 메타데이터 로드
 */
function loadContractsMeta() {
  try {
    if (existsSync(CONTRACTS_META_FILE)) {
      const content = readFileSync(CONTRACTS_META_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.warn('[watch] 계약 메타데이터 로드 실패:', err.message);
  }
  return { contracts: [], indexedAt: null, totalContracts: 0 };
}

/**
 * 계약 메타데이터 저장
 */
function saveContractsMeta(contracts) {
  const contractsMeta = {
    contracts,
    indexedAt: new Date().toISOString(),
    totalContracts: contracts.length
  };

  const metaDir = dirname(CONTRACTS_META_FILE);
  if (!existsSync(metaDir)) {
    mkdirSync(metaDir, { recursive: true });
  }

  writeFileSync(CONTRACTS_META_FILE, JSON.stringify(contractsMeta, null, 2), 'utf-8');
}

/**
 * 단일 파일 인덱싱
 */
async function indexFile(filePath) {
  const fileName = basename(filePath);
  const folderPath = dirname(filePath);
  const ext = extname(fileName).toLowerCase();

  if (!PARSEABLE_EXTENSIONS.includes(ext)) {
    return null;
  }

  try {
    const stats = statSync(filePath);
    const mtime = stats.mtime.toISOString();
    const tags = extractTags(fileName, folderPath);

    // 텍스트 추출 (미리보기 500자)
    let textPreview = '';
    let fullText = null;
    let isScanned = false;

    try {
      const { text, isScanned: scanned } = await getCachedText(filePath, extractText);
      isScanned = scanned;
      if (text && !isScanned) {
        textPreview = text.substring(0, 500).replace(/\s+/g, ' ').trim();
        fullText = text;
      }
    } catch (err) {
      // 텍스트 추출 실패해도 인덱싱은 계속
    }

    // sourceType 결정
    const sourceType = isDriveDesktopPath(filePath) ? 'gdrive-desktop' : 'local';

    const doc = {
      fileName,
      path: filePath,
      folderPath,
      folderNames: folderPath.split('/').filter(f => f.length > 0),
      ext,
      mtime,
      size: stats.size,
      tags,
      textPreview,
      isScanned,
      sourceType
    };

    // 계약 메타데이터 추출
    const metadata = extractContractMetadata(filePath, fileName, folderPath, fullText);

    return { doc, metadata };
  } catch (err) {
    console.error(`[watch] 인덱싱 실패: ${fileName} - ${err.message}`);
    return null;
  }
}

/**
 * 파일 추가/수정 처리
 */
async function handleFileChange(filePath, eventType) {
  // 디바운스: 기존 타이머 취소
  if (debounceTimers.has(filePath)) {
    clearTimeout(debounceTimers.get(filePath));
  }

  // 새 타이머 설정
  debounceTimers.set(filePath, setTimeout(async () => {
    debounceTimers.delete(filePath);

    const fileName = basename(filePath);

    // 파일 존재 확인
    if (!existsSync(filePath)) {
      return;
    }

    console.log(`[watch] ${eventType === 'add' ? '추가' : '수정'} 감지: ${fileName}`);

    try {
      // 파일 인덱싱
      const result = await indexFile(filePath);
      if (!result) {
        return;
      }

      const { doc, metadata } = result;

      // 기존 인덱스 로드
      let index = loadIndex();
      if (!index) {
        // 인덱스 없으면 초기화
        index = {
          documents: [],
          indexedAt: new Date().toISOString(),
          totalDocuments: 0,
          stats: {}
        };
      }

      // 기존 문서 찾기
      const existingIndex = index.documents.findIndex(d => d.path === filePath);

      if (existingIndex >= 0) {
        // 기존 문서 업데이트
        index.documents[existingIndex] = doc;
      } else {
        // 새 문서 추가
        index.documents.push(doc);
      }

      // 인덱스 저장
      saveIndex(index.documents);

      // 계약 메타데이터 로드
      let contractsMeta = loadContractsMeta();

      // 기존 메타데이터 찾기
      const existingMetaIndex = contractsMeta.contracts.findIndex(c => c.sourceFile === filePath);

      if (existingMetaIndex >= 0) {
        // 기존 메타데이터 업데이트
        contractsMeta.contracts[existingMetaIndex] = metadata;
      } else {
        // 새 메타데이터 추가
        contractsMeta.contracts.push(metadata);
      }

      // 메타데이터 저장
      saveContractsMeta(contractsMeta.contracts);

      console.log(`[watch] ✓ 인덱스 갱신 완료: ${fileName} (총 ${index.documents.length}개)`);
    } catch (err) {
      console.error(`[watch] ✗ 인덱스 갱신 실패: ${fileName} - ${err.message}`);
    }
  }, DEBOUNCE_DELAY));
}

/**
 * 파일 삭제 처리
 */
function handleFileDelete(filePath) {
  // 디바운스: 기존 타이머 취소
  if (debounceTimers.has(filePath)) {
    clearTimeout(debounceTimers.get(filePath));
    debounceTimers.delete(filePath);
  }

  const fileName = basename(filePath);

  console.log(`[watch] 삭제 감지: ${fileName}`);

  try {
    // 기존 인덱스 로드
    const index = loadIndex();
    if (!index) {
      return;
    }

    // 문서 제거
    const beforeCount = index.documents.length;
    index.documents = index.documents.filter(d => d.path !== filePath);
    const afterCount = index.documents.length;

    if (beforeCount !== afterCount) {
      // 인덱스 저장
      saveIndex(index.documents);
      console.log(`[watch] ✓ 인덱스에서 제거: ${fileName} (총 ${afterCount}개)`);
    }

    // 계약 메타데이터에서도 제거
    const contractsMeta = loadContractsMeta();
    const beforeMetaCount = contractsMeta.contracts.length;
    contractsMeta.contracts = contractsMeta.contracts.filter(c => c.sourceFile !== filePath);
    const afterMetaCount = contractsMeta.contracts.length;

    if (beforeMetaCount !== afterMetaCount) {
      saveContractsMeta(contractsMeta.contracts);
    }
  } catch (err) {
    console.error(`[watch] ✗ 삭제 처리 실패: ${fileName} - ${err.message}`);
  }
}

/**
 * 파일 감시 시작
 */
export function startWatching(watchPaths) {
  console.log('🔍 파일 감시 시작...\n');

  watchPaths.forEach(path => {
    console.log(`[watch] 감시 경로: ${path}`);
  });

  console.log('\n💡 파일 추가/수정/삭제 시 자동으로 인덱스가 갱신됩니다.');
  console.log('   종료하려면 Ctrl+C를 누르세요.\n');

  const watcher = chokidar.watch(watchPaths, {
    ignored: [
      /(^|[\/\\])\../,        // 숨김 파일
      /~\$/,                   // Office 임시 파일
      /\.tmp$/,                // 임시 파일
      /\.DS_Store$/,           // macOS 메타데이터
      /\._/,                   // macOS 리소스 포크
      '**/node_modules/**',    // node_modules
      '**/.git/**'             // git
    ],
    persistent: true,
    ignoreInitial: true,       // 초기 스캔 무시 (기존 파일은 add 이벤트 발생 안 함)
    followSymlinks: true,      // 심볼릭 링크 따라가기
    awaitWriteFinish: {        // 쓰기 완료 대기
      stabilityThreshold: 1000,
      pollInterval: 100
    }
  });

  // 이벤트 핸들러
  watcher
    .on('add', (filePath) => {
      const ext = extname(filePath).toLowerCase();
      if (PARSEABLE_EXTENSIONS.includes(ext)) {
        handleFileChange(filePath, 'add');
      }
    })
    .on('change', (filePath) => {
      const ext = extname(filePath).toLowerCase();
      if (PARSEABLE_EXTENSIONS.includes(ext)) {
        handleFileChange(filePath, 'change');
      }
    })
    .on('unlink', (filePath) => {
      const ext = extname(filePath).toLowerCase();
      if (PARSEABLE_EXTENSIONS.includes(ext)) {
        handleFileDelete(filePath);
      }
    })
    .on('error', (error) => {
      console.error(`[watch] 오류: ${error.message}`);
    });

  // Ctrl+C 처리
  process.on('SIGINT', () => {
    console.log('\n\n[watch] 감시 종료 중...');
    watcher.close().then(() => {
      console.log('[watch] 감시 종료됨');
      process.exit(0);
    });
  });

  return watcher;
}
