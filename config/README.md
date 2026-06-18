# Google Drive Credentials 설정

## 필수 작업

이 앱에서 Google Drive 연결 기능을 사용하려면, `credentials.json` 파일이 이 디렉토리에 있어야 합니다.

### 1. Google Cloud Console에서 credentials.json 다운로드

1. [Google Cloud Console](https://console.cloud.google.com/) 방문
2. 프로젝트 생성 또는 선택
3. "API 및 서비스" → "사용자 인증 정보" 메뉴로 이동
4. "+ 사용자 인증 정보 만들기" → "OAuth 클라이언트 ID" 선택
5. 애플리케이션 유형: "데스크톱 앱" 선택
6. 생성 후 JSON 다운로드

### 2. credentials.json 파일 배치

다운로드한 JSON 파일을 이 디렉토리(`config/`)에 `credentials.json` 이름으로 저장하세요.

```
config/
  ├── credentials.json          ← 여기에 배치
  ├── credentials.json.example  (예시 파일)
  ├── drive.config.json
  ├── ocr.config.json
  └── README.md (이 파일)
```

### 3. 앱 빌드

```bash
npm run build
```

빌드 시 `credentials.json`이 자동으로 앱에 포함됩니다.

### 주의사항

- **credentials.json은 민감한 정보**이므로 Git에 커밋하지 마세요!
- `.gitignore`에 `config/credentials.json`이 추가되어 있는지 확인하세요.
- 배포 시 각 환경에 맞는 credentials.json을 사용하세요.

---

## 회의 기록 스프레드시트 설정

회의 기록 기능을 사용하려면 Google 스프레드시트 설정이 필요합니다.

### 1. Google Sheets API 활성화

1. [Google Cloud Console](https://console.cloud.google.com/) 방문
2. 위에서 생성한 프로젝트 선택
3. "API 및 서비스" → "라이브러리" 메뉴로 이동
4. "Google Sheets API" 검색 후 "사용 설정" 클릭
5. "Google Drive API"도 동일하게 활성화

### 2. 스프레드시트 생성 및 시트 구성

1. [Google Sheets](https://sheets.google.com)에서 새 스프레드시트 생성
2. 2개의 시트 생성:
   - **업무진행** 시트: 회의일시 | 프로젝트명 | 담당자 | 진행사항 | 예정사항 | 전사링크
   - **회의록** 시트: 회의일시 | 핵심논의 | 결정사항 | 해야할일 | 전사링크
3. 스프레드시트 URL에서 ID 복사
   - URL 형식: `https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit`
   - `[SPREADSHEET_ID]` 부분을 복사

### 3. 스프레드시트 설정 파일 생성

`~/.config/ogq-docs-ask/spreadsheet-config.json` 파일 생성:

```json
{
  "spreadsheetId": "복사한_스프레드시트_ID",
  "workProgressSheetName": "업무진행",
  "meetingMinutesSheetName": "회의록"
}
```

예시 파일: `config/spreadsheet-config.json.example` 참고

### 4. ~/meeting_logs 폴더 생성

회의 전사 파일을 저장할 폴더를 생성하세요:

```bash
mkdir -p ~/meeting_logs
```

회의 전사 파일을 이 폴더에 저장하면 앱에서 불러올 수 있습니다.
