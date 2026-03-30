/**
 * Google Drive 설정 로더
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const DRIVE_CONFIG_FILE = 'config/drive.config.json';

/**
 * Google Drive 설정 로드
 */
export function loadDriveConfig() {
  try {
    if (existsSync(DRIVE_CONFIG_FILE)) {
      const content = readFileSync(DRIVE_CONFIG_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.warn('Google Drive 설정 로드 실패:', err.message);
  }

  // 기본 설정
  return {
    enabled: false,
    mode: 'desktop',
    desktopRoots: [],
    api: {
      enabled: false
    }
  };
}

/**
 * Google Drive Desktop 경로 목록 가져오기
 */
export function getDriveDesktopRoots() {
  const config = loadDriveConfig();

  if (!config.enabled || config.mode !== 'desktop') {
    return [];
  }

  // 존재하는 경로만 반환
  return config.desktopRoots.filter(root => {
    if (existsSync(root)) {
      return true;
    } else {
      console.warn(`Google Drive 경로를 찾을 수 없습니다: ${root}`);
      return false;
    }
  });
}

/**
 * 경로가 Google Drive Desktop 경로인지 확인
 */
export function isDriveDesktopPath(filePath) {
  const driveRoots = getDriveDesktopRoots();
  return driveRoots.some(root => filePath.startsWith(root));
}
