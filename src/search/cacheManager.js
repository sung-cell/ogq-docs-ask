/**
 * 텍스트 추출 캐시 관리
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getCacheDir, ensureDirectories } = require('../config/runtimePaths.cjs');

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = getCacheDir();

// 캐시 디렉토리 생성
ensureDirectories();

/**
 * 파일 경로의 해시 생성 (캐시 키로 사용)
 */
function getFileHash(filePath) {
  return createHash('md5').update(filePath).digest('hex');
}

/**
 * 캐시 파일 경로 생성
 */
function getCachePath(filePath) {
  const hash = getFileHash(filePath);
  return join(CACHE_DIR, `${hash}.json`);
}

/**
 * 캐시에서 텍스트 가져오기
 * @param {string} filePath - 원본 파일 경로
 * @returns {{ text: string, isScanned: boolean, extractedTextAvailable: boolean, extractionError: string|null, ocrUsed: boolean, ocrSucceeded: boolean } | null}
 */
export function getCache(filePath) {
  try {
    const cachePath = getCachePath(filePath);

    if (!existsSync(cachePath)) {
      return null;
    }

    // 원본 파일의 수정 시간 확인
    const originalStat = statSync(filePath);
    const cacheStat = statSync(cachePath);

    // 원본이 캐시보다 최신이면 무효화
    if (originalStat.mtime > cacheStat.mtime) {
      return null;
    }

    const cacheData = JSON.parse(readFileSync(cachePath, 'utf-8'));
    return cacheData;
  } catch (err) {
    return null;
  }
}

/**
 * 캐시에 텍스트 저장
 * @param {string} filePath - 원본 파일 경로
 * @param {{ text: string, isScanned: boolean, extractedTextAvailable: boolean, extractionError: string|null, ocrUsed: boolean, ocrSucceeded: boolean }} data
 */
export function setCache(filePath, data) {
  try {
    const cachePath = getCachePath(filePath);
    writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[cache] 캐시 저장 실패: ${filePath} - ${err.message}`);
  }
}

/**
 * 캐시와 함께 텍스트 추출
 * @param {string} filePath
 * @param {Function} extractFn - 텍스트 추출 함수
 * @returns {Promise<{ text: string, isScanned: boolean, extractedTextAvailable: boolean, extractionError: string|null, ocrUsed: boolean, ocrSucceeded: boolean, fromCache: boolean }>}
 */
export async function getCachedText(filePath, extractFn) {
  // 캐시 확인
  const cached = getCache(filePath);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  // 캐시 없으면 추출
  const result = await extractFn(filePath);

  // 캐시 저장
  setCache(filePath, result);

  return { ...result, fromCache: false };
}
