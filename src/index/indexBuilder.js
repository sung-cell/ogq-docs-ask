/**
 * 문서 인덱스 빌더
 * MYBOX 전체 문서를 인덱싱하여 빠른 검색 지원
 */

import { readdirSync, statSync, lstatSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join, extname, basename } from 'path';
import { createRequire } from 'module';
import { CONTRACTS_INBOX_DIR, CONTRACTS_RAW_DIR, DOCUMENTS_ROOTS } from '../config.js';
import { getCachedText } from '../search/cacheManager.js';
import { extractText } from '../search/textExtractor.js';
import { extractContractMetadata } from '../extract/contractExtractor.js';
import { getDriveDesktopRoots, isDriveDesktopPath } from '../config/driveConfig.js';
import { listNativeDocuments, extractNativeDocumentText, getNativeExtension } from '../integrations/googleDriveNative.js';

const require = createRequire(import.meta.url);
const { getDocumentsIndexPath, getContractsMetaPath, ensureDirectories } = require('../config/runtimePaths.cjs');

const INDEX_FILE = getDocumentsIndexPath();
const CONTRACTS_META_FILE = getContractsMetaPath();
const PARSEABLE_EXTENSIONS = ['.txt', '.xlsx', '.xls', '.csv', '.pdf', '.docx', '.pptx'];

const KEYWORDS = {
  companies: ['KT', 'SKT', 'LG', '네이버', '아프리카TV', 'OGQ', '카카오', '삼성'],
  services: ['채팅+', '마켓', '비즈챗', '메시지앱', 'OGQ마켓', '플러스'],
  docTypes: ['계약서', '협약서', '견적서', '정산서', '제안서', '소개서', '운영비용', '청구서']
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

function normalizeConfiguredRoots(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.map(v => String(v || '').trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(v => String(v || '').trim()).filter(Boolean);
      }
    } catch {}

    return trimmed.split('\n').map(v => v.trim()).filter(Boolean);
  }

  return [];
}

function uniqueKeepOrder(list) {
  const seen = new Set();
  return list.filter(item => {
    const key = String(item || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveIndexRoots(explicitRoots = []) {
  const optionRoots = normalizeConfiguredRoots(explicitRoots);
  if (optionRoots.length > 0) {
    return uniqueKeepOrder(optionRoots.filter(root => existsSync(root)));
  }

  const envRoots = normalizeConfiguredRoots(process.env.OGQ_DOCS_ASK_DOCUMENTS_ROOTS);
  if (envRoots.length > 0) {
    return uniqueKeepOrder(envRoots.filter(root => existsSync(root)));
  }

  const configRoots = normalizeConfiguredRoots(DOCUMENTS_ROOTS);
  if (configRoots.length > 0) {
    return uniqueKeepOrder(configRoots.filter(root => existsSync(root)));
  }

  return uniqueKeepOrder([join(process.env.HOME || '', 'Documents')].filter(root => existsSync(root)));
}
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

  KEYWORDS.companies.forEach(company => {
    if (text.includes(company.toLowerCase())) tags.companies.push(company);
  });

  KEYWORDS.services.forEach(service => {
    if (text.includes(service.toLowerCase())) tags.services.push(service);
  });

  KEYWORDS.docTypes.forEach(docType => {
    if (text.includes(docType.toLowerCase())) tags.docTypes.push(docType);
  });

  return tags;
}

/**
 * 재귀적으로 파일 스캔
 */
function scanAllFilesRecursive(dir, results = [], visited = new Set()) {
  if (!existsSync(dir)) return results;

  const st = statSync(dir);
  const realPath = st.dev + ':' + st.ino;
  if (visited.has(realPath)) return results;
  visited.add(realPath);

  try {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);

      if (entry.startsWith('~') || entry.startsWith('.')) continue;

      try {
        const lstat = lstatSync(fullPath);

        if (lstat.isSymbolicLink()) {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            scanAllFilesRecursive(fullPath, results, visited);
          } else if (stat.isFile()) {
            const ext = extname(entry).toLowerCase();
            if (PARSEABLE_EXTENSIONS.includes(ext)) results.push(fullPath);
          }
        } else if (lstat.isDirectory()) {
          scanAllFilesRecursive(fullPath, results, visited);
        } else if (lstat.isFile()) {
          const ext = extname(entry).toLowerCase();
          if (PARSEABLE_EXTENSIONS.includes(ext)) results.push(fullPath);
        }
      } catch (err) {
        console.warn(`파일 접근 실패: ${fullPath}`);
      }
    }
  } catch (err) {
    console.warn(`디렉토리 접근 실패: ${dir}`);
  }

  return results;
}

/**
 * 기존 인덱스 로드
 */
function loadExistingIndex() {
  try {
    if (existsSync(INDEX_FILE)) {
      const content = readFileSync(INDEX_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.warn('기존 인덱스 로드 실패:', err.message);
  }
  return { documents: [], indexedAt: null };
}

/**
 * 기존 계약 메타데이터 로드
 */
function loadExistingContractsMeta() {
  try {
    if (existsSync(CONTRACTS_META_FILE)) {
      const content = readFileSync(CONTRACTS_META_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.warn('기존 계약 메타데이터 로드 실패:', err.message);
  }
  return { contracts: [], indexedAt: null };
}

export async function buildIndex(options = {}) {
  const { force = false, roots: explicitRoots = [] } = options;

  console.log('📚 문서 인덱싱 시작...\n');

  // 기존 인덱스 로드
  const existingIndex = loadExistingIndex();
  const existingMap = new Map(
    existingIndex.documents.map(doc => [doc.path, doc])
  );

  // 기존 계약 메타데이터 로드
  const existingContractsMeta = loadExistingContractsMeta();
  const existingContractsMap = new Map(
    existingContractsMeta.contracts.map(contract => [contract.sourceFile, contract])
  );

  console.log('파일 스캔 중...');
  const allFiles = [];
  const scanRoots = resolveIndexRoots(explicitRoots);

  console.log(`\n[스캔 루트] ${scanRoots.length}개 경로:`);
  if (scanRoots.length === 0) {
    console.log('  ⚠️  설정된 문서 폴더가 없습니다.');
    console.log('  ℹ️  설정 화면에서 문서 폴더를 추가하거나, Downloads/Google Drive 자동감시를 활성화하세요.\n');
  } else {
    scanRoots.forEach(root => console.log(`  - ${root}`));
    console.log('');

    scanRoots.forEach(root => {
      const before = allFiles.length;
      scanAllFilesRecursive(root, allFiles);
      const added = allFiles.length - before;
      console.log(`✓ ${root}: +${added}개 파일, 누적=${allFiles.length}개`);
    });
  }

  // Google Drive Desktop 스캔 (옵션 기능 - 실패해도 계속 진행)
  try {
    const driveRoots = getDriveDesktopRoots();

    if (driveRoots.length > 0) {
      console.log(`\n[Google Drive Desktop] ${driveRoots.length}개 경로:`);
      driveRoots.forEach(root => console.log(`  - ${root}`));
      console.log('');

      const normalizedScanRoots = new Set(scanRoots);
      driveRoots.forEach(root => {
        if (normalizedScanRoots.has(root)) {
          console.log(`⊙ ${root}: 이미 스캔됨 (중복 제외)`);
          return;
        }
        const before = allFiles.length;
        scanAllFilesRecursive(root, allFiles);
        const added = allFiles.length - before;
        console.log(`✓ ${root}: +${added}개 파일, 누적=${allFiles.length}개`);
      });
    }
  } catch (err) {
    console.warn('Google Drive Desktop 스캔 실패 (무시하고 계속):', err.message);
  }

  const dedupedFiles = uniqueKeepOrder(allFiles);
  allFiles.length = 0;
  allFiles.push(...dedupedFiles);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 총 ${allFiles.length}개 파일 발견`);
  console.log(`   (지원 확장자: ${PARSEABLE_EXTENSIONS.join(', ')})`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Google Drive Native 문서 가져오기
  let nativeDocuments = [];
  try {
    nativeDocuments = await listNativeDocuments({ silent: false });
    console.log(`Google Drive native 문서: ${nativeDocuments.length}개\n`);
  } catch (err) {
    console.warn('Google Drive native 문서 조회 실패 (무시하고 계속):', err.message);
  }

  const documents = [];
  const contractsMetadata = [];
  let newCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < allFiles.length; i++) {
    const filePath = allFiles[i];
    const fileName = basename(filePath);
    const folderPath = filePath.split('/').slice(0, -1).join('/');
    const ext = extname(filePath).toLowerCase();

    try {
      const stats = statSync(filePath);
      const mtime = stats.mtime.toISOString();

      const existing = existingMap.get(filePath);
      if (existing && existing.mtime === mtime && !force) {
        documents.push(existing);

        const existingMeta = existingContractsMap.get(filePath);
        if (existingMeta) {
          contractsMetadata.push(existingMeta);
        } else {
          const metadata = extractContractMetadata(filePath, fileName, folderPath, null);
          contractsMetadata.push(metadata);
        }

        skippedCount++;
        continue;
      }

      const tags = extractTags(fileName, folderPath);

      let textPreview = '';
      let fullText = null;
      let isScanned = false;

      try {
        const result = await getCachedText(filePath, extractText);
        const { text, isScanned: scanned } = result;

        if (text) {
          textPreview = text.substring(0, 500);
          fullText = text;
        }
        isScanned = scanned || false;
      } catch {}

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
        sourceType,
        isScanned  // 스캔본 PDF 여부 (본문 검색 제한)
      };

      documents.push(doc);

      const metadata = extractContractMetadata(filePath, fileName, folderPath, fullText);
      contractsMetadata.push(metadata);

      if (existing) updatedCount++;
      else newCount++;

    } catch (err) {
      console.warn(`인덱싱 실패: ${fileName}`);
    }
  }

  console.log(`완료: ${allFiles.length}/${allFiles.length}\n`);

  // Google Drive Native 문서 인덱싱
  if (nativeDocuments.length > 0) {
    console.log(`\nGoogle Drive native 문서 인덱싱 중...\n`);

    for (let i = 0; i < nativeDocuments.length; i++) {
      const file = nativeDocuments[i];
      const { id, name, mimeType, modifiedTime, webViewLink, size } = file;

      try {
        const ext = getNativeExtension(mimeType);
        const virtualPath = `gdrive://${id}`;
        const existing = existingMap.get(virtualPath);

        // modifiedTime 비교 (force 옵션 체크)
        if (existing && existing.mtime === modifiedTime && !force) {
          documents.push(existing);

          const existingMeta = existingContractsMap.get(virtualPath);
          if (existingMeta) {
            contractsMetadata.push(existingMeta);
          } else {
            const metadata = extractContractMetadata(virtualPath, name, '', null);
            contractsMetadata.push(metadata);
          }

          skippedCount++;
          continue;
        }

        // 태그 추출
        const tags = extractTags(name, '');

        // 텍스트 추출
        let textPreview = '';
        let fullText = null;

        try {
          const text = await extractNativeDocumentText(file);
          if (text) {
            textPreview = text.substring(0, 500);
            fullText = text;
          }
        } catch (err) {
          console.warn(`텍스트 추출 실패: ${name}`);
        }

        const doc = {
          fileName: name,
          path: virtualPath,
          folderPath: '',
          folderNames: [],
          ext,
          mtime: modifiedTime,
          size: size || 0,
          tags,
          textPreview,
          sourceType: 'gdrive-native',
          driveFileId: id,
          webViewLink
        };

        documents.push(doc);

        const metadata = extractContractMetadata(virtualPath, name, '', fullText);
        contractsMetadata.push(metadata);

        if (existing) updatedCount++;
        else newCount++;

        // 진행 상황 출력 (10개마다)
        if ((i + 1) % 10 === 0) {
          process.stdout.write(`\r처리 중: ${i + 1}/${nativeDocuments.length}`);
        }
      } catch (err) {
        console.warn(`인덱싱 실패: ${name} - ${err.message}`);
      }
    }

    console.log(`\r완료: ${nativeDocuments.length}/${nativeDocuments.length}\n`);
  }

  const index = {
    documents,
    indexedAt: new Date().toISOString(),
    totalDocuments: documents.length
  };

  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), 'utf-8');

  ensureDirectories();

  const contractsMeta = {
    contracts: contractsMetadata,
    indexedAt: new Date().toISOString(),
    totalContracts: contractsMetadata.length
  };

  writeFileSync(CONTRACTS_META_FILE, JSON.stringify(contractsMeta, null, 2), 'utf-8');

  console.log(`✅ 완료: ${documents.length}개`);
  return index;
}

/**
 * 인덱스 로드
 */
export function loadIndex() {
  if (!existsSync(INDEX_FILE)) {
    return null;
  }

  try {
    const content = readFileSync(INDEX_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.warn('인덱스 로드 실패:', err.message);
    return null;
  }
}

/**
 * 문서유형 정규화
 * "계약" -> "계약서", "협약" -> "협약서" 등
 */
function normalizeDocType(term) {
  const normalized = {
    '계약': '계약서',
    '협약': '협약서',
    '견적': '견적서',
    '정산': '정산서',
    '제안': '제안서',
    '소개': '소개서',
    '청구': '청구서'
  };
  return normalized[term] || term;
}

/**
 * 문서유형의 기본형 추출
 * "계약서" -> "계약", "협약서" -> "협약" 등
 */
function getDocTypeBase(term) {
  if (term.endsWith('서') && term.length > 1) {
    return term.slice(0, -1);
  }
  return term;
}

/**
 * 문서 점수 계산
 * @param {Object} doc - 문서 객체
 * @param {Array<string>} allKeywords - 모든 검색 키워드
 * @param {string|null} detectedCompany - 감지된 회사명
 * @param {string|null} detectedDocType - 감지된 문서유형
 * @returns {number} - 문서 점수
 */
function scoreDocumentMatch(doc, allKeywords, detectedCompany, detectedDocType) {
  let score = 0;
  const lowerFileName = doc.fileName.toLowerCase();
  const lowerFolderPath = doc.folderPath.toLowerCase();
  const lowerTextPreview = doc.textPreview ? doc.textPreview.toLowerCase() : '';

  // 1. 회사명 매칭 (최우선 - 100~200점대)
  if (detectedCompany) {
    const lowerCompany = detectedCompany.toLowerCase();

    // 파일명에 회사명 - 최우선
    if (lowerFileName.includes(lowerCompany)) {
      score += 150;
    }

    // 폴더명에 회사명
    if (lowerFolderPath.includes(lowerCompany)) {
      score += 70;
    }

    // 태그에 회사명 (대소문자 구분 없이 비교)
    const hasCompanyTag = doc.tags.companies.some(c => c.toLowerCase() === lowerCompany);
    if (hasCompanyTag) {
      score += 60;
    }

    // 텍스트에 회사명
    if (lowerTextPreview.includes(lowerCompany)) {
      score += 40;
    }
  }

  // 2. 문서유형 매칭 (우선순위 2 - 80~150점대)
  if (detectedDocType) {
    const normalized = normalizeDocType(detectedDocType);
    const base = getDocTypeBase(detectedDocType);
    const lowerDocType = detectedDocType.toLowerCase();
    const lowerNormalized = normalized.toLowerCase();
    const lowerBase = base.toLowerCase();

    // 파일명에 문서유형
    if (lowerFileName.includes(lowerDocType)) {
      score += 120; // 정확한 문서유형
    } else if (lowerFileName.includes(lowerNormalized)) {
      score += 100; // 정규화된 문서유형 (예: "계약" 검색 시 "계약서" 파일)
    } else if (lowerFileName.includes(lowerBase)) {
      score += 90; // 기본형 (예: "계약서" 검색 시 "계약" 파일)
    }

    // 텍스트에 문서유형
    if (lowerTextPreview.includes(lowerDocType)) {
      score += 35; // 정확한 문서유형
    } else if (lowerTextPreview.includes(lowerNormalized)) {
      score += 30; // 정규화된 문서유형
    } else if (lowerTextPreview.includes(lowerBase)) {
      score += 25; // 기본형
    }

    // 태그에 문서유형 (대소문자 구분 없이 비교)
    const hasExactDocTypeTag = doc.tags.docTypes.some(d => d.toLowerCase() === lowerDocType);
    const hasNormalizedDocTypeTag = doc.tags.docTypes.some(d => d.toLowerCase() === lowerNormalized);
    const hasBaseDocTypeTag = doc.tags.docTypes.some(d => d.toLowerCase() === lowerBase);

    if (hasExactDocTypeTag) {
      score += 50; // 정확한 문서유형
    } else if (hasNormalizedDocTypeTag) {
      score += 45; // 정규화된 문서유형
    } else if (hasBaseDocTypeTag) {
      score += 40; // 기본형
    }
  }

  // 3. 나머지 키워드 매칭 (보조 - 5~20점대)
  const otherKeywords = allKeywords.filter(k => {
    const lowerK = k.toLowerCase();
    if (detectedCompany && lowerK === detectedCompany.toLowerCase()) return false;
    if (detectedDocType && lowerK === detectedDocType.toLowerCase()) return false;
    return true;
  });

  otherKeywords.forEach(keyword => {
    const lowerKeyword = keyword.toLowerCase();
    const isNumberOnly = /^\d+$/.test(keyword);

    // 숫자-only 키워드는 높은 가점 부여 (파일명/문서번호 검색)
    if (isNumberOnly) {
      // 파일명 exact match (확장자 제외)
      const fileNameWithoutExt = doc.fileName.replace(/\.[^.]+$/, '');
      if (fileNameWithoutExt.toLowerCase() === lowerKeyword) {
        score += 200; // 최고 점수
      }
      // 파일명에 포함
      else if (lowerFileName.includes(lowerKeyword)) {
        score += 150;
      }

      // 폴더명/경로에 포함
      doc.folderNames.forEach(folder => {
        if (folder.toLowerCase().includes(lowerKeyword)) {
          score += 80;
        }
      });

      // 텍스트에 포함
      if (lowerTextPreview.includes(lowerKeyword)) {
        score += 50;
      }
    } else {
      // 일반 키워드는 기존 점수 유지
      // 파일명에 키워드
      if (lowerFileName.includes(lowerKeyword)) {
        score += 20;
      }

      // 폴더명에 키워드
      doc.folderNames.forEach(folder => {
        if (folder.toLowerCase().includes(lowerKeyword)) {
          score += 10;
        }
      });

      // 텍스트에 키워드
      if (lowerTextPreview.includes(lowerKeyword)) {
        score += 8;
      }
    }
  });

  return score;
}

/**
 * 인덱스 기반 검색
 */
export function searchIndex(keywords, options = {}) {
  const index = loadIndex();
  if (!index) {
    return { results: [], fromIndex: false };
  }

  const { companies = [], services = [], docTypes = [], sourceType = null } = options;
  // 숫자는 1자리도 포함, 문자는 2자 이상
  const allKeywords = keywords.split(/\s+/).filter(k => {
    if (/^\d+$/.test(k)) return true; // 숫자만 있으면 길이 무관
    return k.length >= 2; // 문자는 2자 이상
  });

  // 키워드에서 회사명과 문서유형 자동 감지
  let detectedCompany = null;
  let detectedDocType = null;

  // 회사명 감지
  for (const keyword of allKeywords) {
    const lowerKeyword = keyword.toLowerCase();
    const company = KEYWORDS.companies.find(c => c.toLowerCase() === lowerKeyword);
    if (company) {
      detectedCompany = company;
      break;
    }
  }

  // 문서유형 감지 (정확한 매칭 또는 기본형 매칭)
  for (const keyword of allKeywords) {
    const lowerKeyword = keyword.toLowerCase();

    // 정확한 문서유형 매칭 (예: "계약서")
    const exactDocType = KEYWORDS.docTypes.find(d => d.toLowerCase() === lowerKeyword);
    if (exactDocType) {
      detectedDocType = exactDocType;
      break;
    }

    // 기본형 매칭 (예: "계약" -> "계약서" 찾기)
    const normalizedDocType = KEYWORDS.docTypes.find(d => {
      const base = getDocTypeBase(d);
      return base.toLowerCase() === lowerKeyword;
    });
    if (normalizedDocType) {
      detectedDocType = getDocTypeBase(normalizedDocType);
      break;
    }
  }

  // 숫자-only 검색 감지
  const isNumberOnlySearch = allKeywords.length > 0 && allKeywords.every(k => /^\d+$/.test(k));

  // 3단계 검색 결과 저장소
  const allResults = {
    strict: [],    // company + normalized docType 모두 필수
    relaxed: [],   // company + raw docType 모두 필수
    fallback: []   // company만 필수, docType은 점수 가점
  };

  // 모든 문서 순회 및 분류
  for (const doc of index.documents) {
    // sourceType 필터링
    if (sourceType && doc.sourceType !== sourceType) {
      continue;
    }

    // 점수 계산
    const score = scoreDocumentMatch(doc, allKeywords, detectedCompany, detectedDocType);

    if (score <= 0) continue;

    // 문서 분류를 위한 준비
    const lowerFileName = doc.fileName.toLowerCase();
    const lowerFolderPath = doc.folderPath.toLowerCase();
    const lowerTextPreview = doc.textPreview ? doc.textPreview.toLowerCase() : '';

    let category = null;

    if (detectedCompany && detectedDocType) {
      const lowerCompany = detectedCompany.toLowerCase();
      const rawDocType = detectedDocType.toLowerCase();
      const normalizedDocType = normalizeDocType(detectedDocType).toLowerCase();

      // company 존재 여부 체크
      const hasCompany = lowerFileName.includes(lowerCompany) ||
                        lowerFolderPath.includes(lowerCompany) ||
                        lowerTextPreview.includes(lowerCompany) ||
                        doc.tags.companies.some(c => c.toLowerCase() === lowerCompany);

      // normalized docType 존재 여부 체크
      const hasNormalizedDocType = lowerFileName.includes(normalizedDocType) ||
                                   lowerTextPreview.includes(normalizedDocType) ||
                                   doc.tags.docTypes.some(d => d.toLowerCase() === normalizedDocType);

      // raw docType 존재 여부 체크
      const hasRawDocType = lowerFileName.includes(rawDocType) ||
                           lowerTextPreview.includes(rawDocType) ||
                           doc.tags.docTypes.some(d => d.toLowerCase() === rawDocType);

      if (hasCompany && hasNormalizedDocType) {
        category = 'strict';
      } else if (hasCompany && hasRawDocType) {
        category = 'relaxed';
      } else if (hasCompany) {
        category = 'fallback';
      } else {
        // company도 없으면 제외
        continue;
      }
    } else if (detectedCompany) {
      // docType 없고 company만 있으면 fallback
      const lowerCompany = detectedCompany.toLowerCase();
      const hasCompany = lowerFileName.includes(lowerCompany) ||
                        lowerFolderPath.includes(lowerCompany) ||
                        lowerTextPreview.includes(lowerCompany) ||
                        doc.tags.companies.some(c => c.toLowerCase() === lowerCompany);

      if (hasCompany) {
        category = 'fallback';
      }
    } else if (detectedDocType) {
      // company 없고 docType만 있으면 fallback
      category = 'fallback';
    } else {
      // 둘 다 없으면 -> 주제 키워드로 검색 (topic-based search with synonyms)
      const topicKeywords = allKeywords; // 원본 키워드 유지
      let topicMatchCount = 0;
      const matchedKeywords = new Set();

      for (const topicKeyword of topicKeywords) {
        // 키워드를 동의어로 확장
        const expandedKeywords = expandTopicKeyword(topicKeyword);

        // 확장된 키워드 중 하나라도 매칭되는지 확인
        let keywordMatched = false;
        for (const expandedKw of expandedKeywords) {
          const lowerExpanded = expandedKw.toLowerCase();

          if (lowerFileName.includes(lowerExpanded) ||
              lowerFolderPath.includes(lowerExpanded) ||
              lowerTextPreview.includes(lowerExpanded)) {
            keywordMatched = true;
            break;
          }
        }

        if (keywordMatched) {
          topicMatchCount++;
          matchedKeywords.add(topicKeyword);
        }
      }

      // 매칭 로직:
      // - 모든 키워드가 매칭되면 (strict) → fallback 포함
      // - 키워드 중 50% 이상 매칭되면 (relaxed) → fallback 포함
      if (topicMatchCount > 0 && topicMatchCount >= topicKeywords.length * 0.5) {
        category = 'fallback';
      }
    }

    if (category) {
      allResults[category].push({ ...doc, score });
    }
  }

  // 가장 엄격한 단계부터 결과 선택
  let results = [];
  let selectedCategory = null;

  if (allResults.strict.length > 0) {
    results = allResults.strict;
    selectedCategory = 'strict';
    console.log('[searchIndex] Using strict results (company + normalized docType)');
  } else if (allResults.relaxed.length > 0) {
    results = allResults.relaxed;
    selectedCategory = 'relaxed';
    console.log('[searchIndex] Using relaxed results (company + raw docType)');
  } else if (allResults.fallback.length > 0) {
    results = allResults.fallback;
    selectedCategory = 'fallback';
    console.log('[searchIndex] Using fallback results (company only)');
  }

  // 점수 기준 내림차순 정렬
  results.sort((a, b) => b.score - a.score);

  // 상위 5개 결과 로그
  if (results.length > 0) {
    console.log(`[searchIndex] 상위 ${Math.min(5, results.length)}개 결과 (${selectedCategory}):`);
    results.slice(0, 5).forEach((r, idx) => {
      console.log(`  ${idx + 1}. ${r.fileName} (점수: ${r.score})`);
    });
  } else {
    console.log('[searchIndex] 모든 단계에서 결과 없음');
  }

  return {
    results,
    fromIndex: true,
    totalInIndex: index.totalDocuments
  };
}