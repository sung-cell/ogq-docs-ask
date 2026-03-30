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

const CREDENTIALS_PATH = expandPath(driveConfig.api.credentialsPath);
const TOKEN_PATH = expandPath(driveConfig.api.tokenPath);

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
      throw new Error(`credentials 파일이 없습니다: ${CREDENTIALS_PATH}\n\nGoogle Cloud Console에서 OAuth 2.0 클라이언트 ID를 생성하고 다운로드한 JSON 파일을 이 경로에 저장하세요.`);
    }

    const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8'));
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    // token 파일 확인
    if (!existsSync(TOKEN_PATH)) {
      throw new Error(`token 파일이 없습니다: ${TOKEN_PATH}\n\n초기 인증이 필요합니다. 'node index.js auth-google' 명령을 실행하세요.`);
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
      throw new Error(`credentials 파일이 없습니다: ${CREDENTIALS_PATH}`);
    }

    const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8'));
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
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
    console.log(`✅ Token 저장 완료: ${TOKEN_PATH}`);

    return tokens;
  } catch (err) {
    throw new Error(`Token 저장 실패: ${err.message}`);
  }
}
