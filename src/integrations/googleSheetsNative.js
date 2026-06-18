/**
 * Google Sheets API를 통한 스프레드시트 연동
 */

import { google } from 'googleapis';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// credentials 및 token 경로
const CREDENTIALS_PATH = join(homedir(), '.config', 'ogq-docs-ask', 'credentials.json');
const TOKEN_PATH = join(homedir(), '.config', 'ogq-docs-ask', 'token.json');
const SPREADSHEET_CONFIG_PATH = join(homedir(), '.config', 'ogq-docs-ask', 'spreadsheet-config.json');

// OAuth 클라이언트
let authClient = null;

/**
 * OAuth 클라이언트 초기화
 */
async function getAuthClient() {
  if (authClient) return authClient;

  try {
    if (!existsSync(CREDENTIALS_PATH)) {
      throw new Error(`credentials 파일이 없습니다: ${CREDENTIALS_PATH}`);
    }

    if (!existsSync(TOKEN_PATH)) {
      throw new Error(`token 파일이 없습니다: ${TOKEN_PATH}`);
    }

    const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8'));
    const { client_secret, client_id } = credentials.installed || credentials.web;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      'urn:ietf:wg:oauth:2.0:oob'
    );

    const token = JSON.parse(readFileSync(TOKEN_PATH, 'utf-8'));
    oauth2Client.setCredentials(token);

    authClient = oauth2Client;
    return authClient;
  } catch (err) {
    console.error('[GoogleSheets] 인증 실패:', err.message);
    throw err;
  }
}

/**
 * 스프레드시트 설정 로드
 */
function loadSpreadsheetConfig() {
  try {
    if (existsSync(SPREADSHEET_CONFIG_PATH)) {
      return JSON.parse(readFileSync(SPREADSHEET_CONFIG_PATH, 'utf-8'));
    }
  } catch (err) {
    console.warn('[GoogleSheets] 설정 파일 로드 실패:', err.message);
  }

  // 기본 설정 반환 (사용자가 직접 설정해야 함)
  return {
    spreadsheetId: '',
    workProgressSheetName: '업무진행',
    meetingMinutesSheetName: '회의록'
  };
}

/**
 * 스프레드시트 설정 저장
 */
function saveSpreadsheetConfig(config) {
  try {
    writeFileSync(SPREADSHEET_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[GoogleSheets] 설정 저장 실패:', err.message);
    return false;
  }
}

/**
 * 구글 드라이브에 파일 업로드
 */
export async function uploadFileToDrive(filePath, fileName) {
  try {
    const auth = await getAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    const fileMetadata = {
      name: fileName
    };

    const media = {
      mimeType: 'text/plain',
      body: readFileSync(filePath, 'utf-8')
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink'
    });

    const fileId = response.data.id;
    const webViewLink = response.data.webViewLink;

    // 공유 설정 (링크를 아는 사람 모두 조회 가능)
    await drive.permissions.create({
      fileId: fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });

    console.log(`[GoogleSheets] 파일 업로드 완료: ${webViewLink}`);

    return {
      success: true,
      fileId,
      webViewLink
    };
  } catch (err) {
    console.error('[GoogleSheets] 파일 업로드 실패:', err.message);
    throw new Error(`파일 업로드 실패: ${err.message}`);
  }
}

/**
 * 스프레드시트에 행 추가 (업무진행)
 */
export async function appendWorkProgress(data) {
  try {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const config = loadSpreadsheetConfig();

    if (!config.spreadsheetId) {
      throw new Error('스프레드시트 ID가 설정되지 않았습니다. spreadsheet-config.json 파일을 확인하세요.');
    }

    const values = [
      [
        data.dateTime,
        data.projectName,
        data.assignee,
        data.progress,
        data.planned,
        data.transcriptLink
      ]
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: config.spreadsheetId,
      range: `${config.workProgressSheetName}!A:F`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values
      }
    });

    console.log('[GoogleSheets] 업무진행 데이터 추가 완료');

    return { success: true };
  } catch (err) {
    console.error('[GoogleSheets] 업무진행 데이터 추가 실패:', err.message);
    throw new Error(`스프레드시트 기록 실패: ${err.message}`);
  }
}

/**
 * 스프레드시트에 행 추가 (회의록)
 */
export async function appendMeetingMinutes(data) {
  try {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const config = loadSpreadsheetConfig();

    if (!config.spreadsheetId) {
      throw new Error('스프레드시트 ID가 설정되지 않았습니다. spreadsheet-config.json 파일을 확인하세요.');
    }

    const values = [
      [
        data.dateTime,
        data.keyDiscussion,
        data.decisions,
        data.todos,
        data.transcriptLink
      ]
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: config.spreadsheetId,
      range: `${config.meetingMinutesSheetName}!A:E`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values
      }
    });

    console.log('[GoogleSheets] 회의록 데이터 추가 완료');

    return { success: true };
  } catch (err) {
    console.error('[GoogleSheets] 회의록 데이터 추가 실패:', err.message);
    throw new Error(`스프레드시트 기록 실패: ${err.message}`);
  }
}

/**
 * 스프레드시트 URL 가져오기
 */
export function getSpreadsheetUrl(sheetType) {
  try {
    const config = loadSpreadsheetConfig();

    if (!config.spreadsheetId) {
      return null;
    }

    const baseUrl = `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}`;

    if (sheetType === 'workProgress') {
      // 시트 이름으로 이동 (gid는 시트 ID를 알아야 하므로 생략)
      return `${baseUrl}/edit#gid=0`;
    } else if (sheetType === 'meetingMinutes') {
      return `${baseUrl}/edit#gid=1`;
    } else {
      return baseUrl;
    }
  } catch (err) {
    console.error('[GoogleSheets] URL 가져오기 실패:', err.message);
    return null;
  }
}
