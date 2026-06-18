/**
 * Google Drive API를 통한 Native 문서 (.gdoc, .gsheet, .gslides) 검색
 */

import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);

/**
 * drive.config.json 안전하게 로드
 */
function loadDriveConfig() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const configPath = join(__dirname, '../../config/drive.config.json');

    if (existsSync(configPath)) {
      return require('../../config/drive.config.json');
    } else {
      console.warn('[GoogleDrive] drive.config.json 파일이 없습니다 - Google Drive 자동감시 비활성화');
      return {
        api: {
          enabled: false,
          includeNativeGoogleDocs: false,
          credentialsPath: '~/.config/ogq-docs-ask/credentials.json',
          tokenPath: '~/.config/ogq-docs-ask/token.json'
        }
      };
    }
  } catch (err) {
    console.warn('[GoogleDrive] drive.config.json 로드 실패:', err.message, '- Google Drive 자동감시 비활성화');
    return {
      api: {
        enabled: false,
        includeNativeGoogleDocs: false,
        credentialsPath: '~/.config/ogq-docs-ask/credentials.json',
        tokenPath: '~/.config/ogq-docs-ask/token.json'
      }
    };
  }
}

const driveConfig = loadDriveConfig();

// 경로 확장 (~ 처리)
function expandPath(path) {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

/**
 * credentials.json 경로 결정
 * - 여러 경로를 확인하여 존재하는 첫 번째 파일 사용
 * - 1순위: 앱 내부 config/credentials.json
 * - 2순위: ~/.config/ogq-docs-ask/credentials.json (사용자 홈)
 * - 3순위: client_secret_*.json (Google Cloud에서 다운로드한 파일명)
 */
function getCredentialsPath() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // 패키징 여부 확인
  const isPackaged = __dirname.includes('app.asar') || process.env.CS_ASK_PACKAGED === 'true';

  const candidates = [];

  if (isPackaged) {
    // 패키징된 경우
    const appPath = __dirname.split('app.asar')[0] || __dirname;
    candidates.push(join(appPath, 'config', 'credentials.json'));
    candidates.push(join(appPath, 'config', 'client_secret.json'));
  } else {
    // 개발 환경
    candidates.push(join(__dirname, '../../config/credentials.json'));
    candidates.push(join(__dirname, '../../config/client_secret.json'));
  }

  // 공통 fallback: 사용자 홈 디렉토리
  const userConfigPath = join(homedir(), '.config', 'ogq-docs-ask', 'credentials.json');
  candidates.push(userConfigPath);
  candidates.push(join(homedir(), '.config', 'ogq-docs-ask', 'client_secret.json'));

  // 존재하는 첫 번째 파일 반환
  for (const path of candidates) {
    if (existsSync(path)) {
      // 보안: 파일 경로 로그 제거
      return path;
    }
  }

  // 파일이 없으면 기본 경로 반환 (나중에 에러 메시지에서 사용)
  return candidates[0]; // 첫 번째 후보를 기본값으로
}

const CREDENTIALS_PATH = getCredentialsPath();
const TOKEN_PATH = join(homedir(), '.config', 'ogq-docs-ask', 'token.json');

// OAuth 2.0 인증
let authClient = null;

/**
 * OAuth 클라이언트 초기화
 */
async function getAuthClient() {
  if (authClient) return authClient;

  try {
    // credentials 파일 확인
    if (!existsSync(CREDENTIALS_PATH)) {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const isPackaged = __dirname.includes('app.asar') || process.env.CS_ASK_PACKAGED === 'true';

      let errorMessage = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
      errorMessage += '❌ Google Drive 인증 파일이 없습니다\n';
      errorMessage += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
      errorMessage += '📋 필요한 파일명:\n';
      errorMessage += '  • credentials.json (권장)\n';
      errorMessage += '  • client_secret_*.json (Google Cloud에서 다운로드한 원본 파일명)\n\n';
      errorMessage += '📂 파일을 넣어야 할 위치 (아래 중 한 곳):\n';

      if (isPackaged) {
        const appPath = __dirname.split('app.asar')[0] || __dirname;
        errorMessage += `  1. ${join(appPath, 'config', 'credentials.json')}\n`;
      } else {
        errorMessage += `  1. ${join(__dirname, '../../config/credentials.json')}\n`;
      }

      const userConfigPath = join(homedir(), '.config', 'ogq-docs-ask', 'credentials.json');
      errorMessage += `  2. ${userConfigPath}\n\n`;
      errorMessage += '🔧 설정 방법:\n';
      errorMessage += '  1. Google Cloud Console (https://console.cloud.google.com)\n';
      errorMessage += '  2. API 및 서비스 > 사용자 인증 정보\n';
      errorMessage += '  3. OAuth 2.0 클라이언트 ID 생성 (애플리케이션 유형: 데스크톱 앱)\n';
      errorMessage += '  4. JSON 다운로드 후 위 경로 중 한 곳에 저장\n';
      errorMessage += '  5. 파일명을 credentials.json으로 변경 (권장)\n\n';
      errorMessage += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

      throw new Error(errorMessage);
    }

    const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8'));
    const { client_secret, client_id } = credentials.installed || credentials.web;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      'urn:ietf:wg:oauth:2.0:oob'  // Out-of-band: 브라우저에 코드 직접 표시
    );

    // token 파일 확인
    if (!existsSync(TOKEN_PATH)) {
      let errorMessage = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
      errorMessage += '❌ Google Drive 인증 토큰이 없습니다\n';
      errorMessage += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
      errorMessage += `📂 토큰 저장 위치: ${TOKEN_PATH}\n\n`;
      errorMessage += '🔧 초기 인증 방법:\n';
      errorMessage += '  앱에서 "Google Drive 연결" 버튼을 클릭하거나\n';
      errorMessage += '  터미널에서 다음 명령을 실행하세요:\n\n';
      errorMessage += '  node index.js auth-google\n\n';
      errorMessage += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

      throw new Error(errorMessage);
    }

    const token = JSON.parse(readFileSync(TOKEN_PATH, 'utf-8'));
    oauth2Client.setCredentials(token);

    authClient = oauth2Client;
    return authClient;
  } catch (err) {
    console.error('Google Drive API 인증 실패:', err.message);
    throw err;
  }
}

/**
 * Google Drive에서 Native 문서 목록 가져오기
 * @returns {Promise<Array>} - 문서 배열
 */
export async function listNativeDocuments(options = {}) {
  const { silent = false } = options;

  if (!driveConfig.api.enabled || !driveConfig.api.includeNativeGoogleDocs) {
    return [];
  }

  try {
    const auth = await getAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    const query = [
      "mimeType='application/vnd.google-apps.document'",
      "or mimeType='application/vnd.google-apps.spreadsheet'",
      "or mimeType='application/vnd.google-apps.presentation'",
      "and trashed=false"
    ].join(' ');

    if (!silent) {
      console.log('Google Drive native 문서 조회 중...');
    }

    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType, modifiedTime, webViewLink, size)',
      pageSize: 1000,
      spaces: 'drive'
    });

    const files = response.data.files || [];

    if (!silent) {
      console.log(`  → ${files.length}개 native 문서 발견\n`);
    }

    return files;
  } catch (err) {
    if (!silent) {
      console.warn('Google Drive API 조회 실패:', err.message);
    }
    return [];
  }
}

/**
 * Google Docs를 텍스트로 export
 */
async function exportGoogleDoc(fileId, auth) {
  const drive = google.drive({ version: 'v3', auth });

  try {
    const response = await drive.files.export({
      fileId,
      mimeType: 'text/plain'
    }, { responseType: 'text' });

    return response.data || '';
  } catch (err) {
    console.warn(`Google Docs export 실패 (${fileId}):`, err.message);
    return '';
  }
}

/**
 * Google Sheets를 텍스트로 export
 */
async function exportGoogleSheet(fileId, auth) {
  const drive = google.drive({ version: 'v3', auth });

  try {
    const response = await drive.files.export({
      fileId,
      mimeType: 'text/csv'
    }, { responseType: 'text' });

    return response.data || '';
  } catch (err) {
    console.warn(`Google Sheets export 실패 (${fileId}):`, err.message);
    return '';
  }
}

/**
 * Google Slides를 텍스트로 export
 */
async function exportGoogleSlides(fileId, auth) {
  const drive = google.drive({ version: 'v3', auth });

  try {
    const response = await drive.files.export({
      fileId,
      mimeType: 'text/plain'
    }, { responseType: 'text' });

    return response.data || '';
  } catch (err) {
    console.warn(`Google Slides export 실패 (${fileId}):`, err.message);
    return '';
  }
}

/**
 * Native 문서의 텍스트 추출
 */
export async function extractNativeDocumentText(file) {
  try {
    const auth = await getAuthClient();
    const { id, mimeType } = file;

    switch (mimeType) {
      case 'application/vnd.google-apps.document':
        return await exportGoogleDoc(id, auth);

      case 'application/vnd.google-apps.spreadsheet':
        return await exportGoogleSheet(id, auth);

      case 'application/vnd.google-apps.presentation':
        return await exportGoogleSlides(id, auth);

      default:
        return '';
    }
  } catch (err) {
    console.warn(`텍스트 추출 실패 (${file.name}):`, err.message);
    return '';
  }
}

/**
 * 파일 확장자 매핑
 */
export function getNativeExtension(mimeType) {
  switch (mimeType) {
    case 'application/vnd.google-apps.document':
      return '.gdoc';
    case 'application/vnd.google-apps.spreadsheet':
      return '.gsheet';
    case 'application/vnd.google-apps.presentation':
      return '.gslides';
    default:
      return '';
  }
}

/**
 * OAuth 인증 URL 생성 (초기 설정용)
 */
export function getAuthUrl() {
  try {
    if (!existsSync(CREDENTIALS_PATH)) {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const isPackaged = __dirname.includes('app.asar') || process.env.CS_ASK_PACKAGED === 'true';

      let errorMessage = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
      errorMessage += '❌ Google Drive 인증 파일이 없습니다\n';
      errorMessage += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
      errorMessage += '📋 필요한 파일명:\n';
      errorMessage += '  • credentials.json (권장)\n';
      errorMessage += '  • client_secret_*.json\n\n';
      errorMessage += '📂 파일을 넣어야 할 위치:\n';

      if (isPackaged) {
        const appPath = __dirname.split('app.asar')[0] || __dirname;
        errorMessage += `  1. ${join(appPath, 'config', 'credentials.json')}\n`;
      } else {
        errorMessage += `  1. ${join(__dirname, '../../config/credentials.json')}\n`;
      }

      const userConfigPath = join(homedir(), '.config', 'ogq-docs-ask', 'credentials.json');
      errorMessage += `  2. ${userConfigPath}\n\n`;
      errorMessage += '자세한 설정 방법은 위 메시지를 참고하세요.\n';
      errorMessage += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

      throw new Error(errorMessage);
    }

    const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8'));
    const { client_secret, client_id } = credentials.installed || credentials.web;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      'urn:ietf:wg:oauth:2.0:oob'  // Out-of-band: 브라우저에 코드 직접 표시
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.metadata.readonly'
      ]
    });

    return { authUrl, oauth2Client };
  } catch (err) {
    throw new Error(`Auth URL 생성 실패: ${err.message}`);
  }
}

/**
 * 인증 코드로 토큰 저장
 */
export async function saveTokenFromCode(code) {
  try {
    const { oauth2Client } = getAuthUrl();
    const { tokens } = await oauth2Client.getToken(code);

    // token 파일 저장
    const tokenDir = TOKEN_PATH.split('/').slice(0, -1).join('/');

    if (!existsSync(tokenDir)) {
      const { mkdirSync } = await import('fs');
      mkdirSync(tokenDir, { recursive: true });
    }

    writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf-8');

    // 저장 확인
    if (!existsSync(TOKEN_PATH)) {
      throw new Error('Token 파일 저장 실패');
    }

    return tokens;
  } catch (err) {
    console.error(`❌ [GoogleDrive] Token 저장 실패:`, err.message);
    throw new Error(`Token 저장 실패: ${err.message}`);
  }
}
