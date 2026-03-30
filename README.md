# contract-scheduler

계약·청구·업무일정 통합 관리 엔진

## 사용법

### 🖥️ Electron 데스크탑 앱 (추천)

#### 개발 모드 실행:

```bash
# 터미널에서 앱 실행
npm run app
```

#### macOS 앱 패키징 (터미널 없이 실행):

```bash
# .app 빌드 (개발용, 빠름)
npm run build:dir

# 또는 DMG/ZIP 생성 (배포용)
npm run build
```

**생성된 앱 경로:**
```
dist/mac-arm64/CS Ask.app
```

**실행 방법:**
1. Finder에서 `dist/mac-arm64` 폴더 열기
2. `CS Ask.app` 더블클릭
3. 또는 터미널에서: `open "dist/mac-arm64/CS Ask.app"`

**기능:**
- 질문 입력창에서 자연어로 질문
- Enter 또는 버튼 클릭으로 실행
- 같은 창에서 결과 즉시 확인
- 예시 질문 버튼으로 빠른 시작
- file:// 링크 클릭으로 문서 바로 열기
- macOS 네이티브 앱처럼 동작
- **NEW:** 인덱스 상태 자동 확인 (문서 수, 마지막 인덱싱 시간)
- **NEW:** 인덱스 없을 시 앱에서 직접 생성 가능 (인덱스 생성 버튼)
- **NEW:** 창 크기/위치 자동 저장 (앱 재시작 시 복원)
- **NEW:** 초기화 버튼으로 환영 화면 복원

**저장 경로:**
- **개발 모드** (`npm run app`): `프로젝트/data/` 폴더 사용
  - 캐시: `data/.cache_text/`
  - 인덱스: `data/.index/`
  - 로그: `data/logs/`
- **패키징된 앱**: macOS userData 디렉토리 사용
  - 경로: `~/Library/Application Support/CS Ask/`
  - 캐시: `~/Library/Application Support/CS Ask/.cache_text/`
  - 인덱스: `~/Library/Application Support/CS Ask/.index/`
  - 로그: `~/Library/Application Support/CS Ask/logs/`
  - 창 상태: `~/Library/Application Support/CS Ask/window-state.json`

**주의사항:**
- 패키징된 앱(.app)은 읽기 전용이므로 앱 내부에 파일을 쓸 수 없습니다
- 모든 캐시, 인덱스, 로그는 자동으로 적절한 writable 경로에 저장됩니다
- 개발 모드와 패키징 앱은 서로 다른 경로를 사용하므로 인덱스가 공유되지 않습니다

### 📟 CLI (커맨드라인)

```bash
# 전체 일정표
npm run list

# 리마인드 활성 항목만
npm run remind

# 자연어 검색
node index.js query "PG사 다음달 청구"
node index.js query "TEST 2026-03"
node index.js query "계약 이번달"

# 옵션 검색
npm run query -- --client ABC --type 청구
node index.js query --from 2026-01-01 --to 2026-06-30 --remind

# inbox 폴더 스캔 및 후보 추출
node index.js update

# 후보 목록 보기
node index.js candidates

# 후보 승인 (Events로 이동)
node index.js approve --row 1
node index.js approve --rows 2,3,5

# 문서 인덱스 생성 (최초 1회 권장)
node index.js reindex

# 문서 내용 검색
node index.js search "비즈챗"
node index.js search "단가"

# 문서 요약
node index.js summarize "KT 계약서"
node index.js summarize "비즈챗 견적서"
node index.js summarize-file "/path/to/document.pdf"

# 자연어 질문
node index.js ask "SKT 계약서 어디 있어?"
node index.js ask "KT 계약서 요약해줘"
node index.js ask "다음달 청구 일정 뭐야?"
node index.js ask "KT 계약 종료 언제야?"
node index.js ask "PG사 문서 찾아줘"
node index.js ask "이번달 일정 알려줘"
node index.js ask "이번달 청구 총액 얼마야?"
node index.js ask "다음달 청구 총액 얼마야?"
node index.js ask "올해 계약 금액 얼마야?"
node index.js ask "이번달 결제 예정 금액 얼마야?"

# 문서 내용 질문 (새로운 기능)
node index.js ask "비즈챗 단가 얼마야?"
node index.js ask "SKT 계약서에 운영비 관련 조항 있어?"
node index.js ask "채팅+ 계약서 종료일 언제야?"
node index.js ask "채팅+마켓 운영비용 견적서에서 SKT 관련 내용 뭐야?"
node index.js ask "KT 관련 문서에서 정산 내용 요약해줘"

# 계약 메타데이터 질문 (NEW!)
node index.js ask "SKT 계약 언제 끝나?"
node index.js ask "KT 계약 시작일이 언제야?"
node index.js ask "비즈챗 단가 얼마야?"
node index.js ask "채팅+ 수익배분 몇 %야?"
node index.js ask "OGQ 계약 금액 얼마야?"

# 자연어 질문 (HTML 출력)
node index.js ask-html "KT 계약 종료 언제야?"
node index.js ask-html "이번달 청구 총액 얼마야?" --output /tmp/result.html
node index.js ask-html "비즈챗 단가 얼마야?" --output /tmp/cs-ask-doc.html
```

### reindex 기능 (새로운 기능)

`node index.js reindex` 명령은 전체 문서를 인덱싱하여 검색 성능을 대폭 향상시킵니다:

**기능:**
- `data/contracts_inbox/`와 `data/contracts_raw/` 폴더의 모든 문서 스캔
- 파일명, 경로, 태그 (회사명, 서비스명, 문서유형) 추출
- 텍스트 미리보기 (최대 500자) 저장
- **계약 메타데이터 자동 추출 (NEW!)**
  - 회사명, 서비스명, 문서유형, 서명상태
  - 계약 시작일/종료일
  - 계약 금액, 단가, 수익배분, 정산기준
  - 각 필드별 신뢰도 및 근거 텍스트
- `data/.index/documents.json`에 인덱스 저장
- `data/.index/contracts-meta.json`에 계약 메타데이터 저장
- 증분 업데이트 지원 (수정 시간 기반)

**사용 시점:**
- 최초 설치 후 1회 실행 권장
- 새 문서 추가 시 재실행
- 인덱스가 있으면 `search`와 `ask` 명령이 훨씬 빠름

**예시:**
```bash
node index.js reindex
# 출력: 📚 문서 인덱싱 시작...
#       총 473개 파일 발견
#       ✅ 인덱스 저장 완료: data/.index/documents.json
```

### watch-index: 자동 인덱싱 (새로운 기능)

`node index.js watch-index` 명령은 파일 시스템을 감시하여 자동으로 인덱스를 갱신합니다:

**기능:**
- `data/contracts_inbox/`와 `data/contracts_raw/` 폴더 감시
- 파일 추가/수정/삭제 자동 감지
- 변경된 파일만 증분 인덱싱
- 디바운스 처리 (1.5초) - 중복 인덱싱 방지
- 임시 파일 자동 제외 (~$, .tmp, .DS_Store 등)

**사용 시점:**
- 문서를 자주 추가/수정하는 경우
- 수동 `reindex` 실행이 번거로운 경우
- Electron 앱과 함께 백그라운드 실행

**권장 사용 흐름:**
```bash
# 터미널 1: 자동 인덱싱 실행 (백그라운드)
npm run watch-index
# 또는
node index.js watch-index

# 터미널 2: Electron 앱 실행
npm run app

# 이제 문서를 추가하면 자동으로 인덱스가 갱신되어
# 앱에서 즉시 검색 가능
```

**출력 예시:**
```bash
$ npm run watch-index
🔍 파일 감시 시작...

[watch] 감시 경로: data/contracts_raw
[watch] 감시 경로: data/contracts_inbox

💡 파일 추가/수정/삭제 시 자동으로 인덱스가 갱신됩니다.
   종료하려면 Ctrl+C를 누르세요.

[watch] 추가 감지: KT_신규계약서.pdf
[watch] ✓ 인덱스 갱신 완료: KT_신규계약서.pdf (총 474개)

[watch] 수정 감지: SKT_협약서_수정본.docx
[watch] ✓ 인덱스 갱신 완료: SKT_협약서_수정본.docx (총 474개)

[watch] 삭제 감지: old_document.xlsx
[watch] ✓ 인덱스에서 제거: old_document.xlsx (총 473개)
```

**주의사항:**
- 심볼릭 링크된 폴더도 정상 감시됨
- 첫 실행 시 기존 파일은 감지하지 않음 (초기 인덱스는 `reindex` 사용)
- Ctrl+C로 안전하게 종료

### summarize 기능 (새로운 기능)

`node index.js summarize "<키워드>"` 명령은 문서를 자동으로 요약합니다:

**기능:**
- 키워드로 문서 검색 후 가장 관련성 높은 문서 요약
- 3줄 요약 생성
- 주요 정보 추출:
  - 회사명: KT, SKT, LG, 네이버, OGQ 등
  - 서비스: 채팅+, 마켓, 비즈챗 등
  - 금액: 원화, 억원, 만원 등
  - 날짜: 계약기간, 종료일 등
  - 수수료: % 요율
- 불확실한 정보는 "확실하지 않음" 표시

**예시:**
```bash
node index.js summarize "KT 계약서"
# 출력:
# 📄 문서 요약
# 파일명: KT_OGQ_메시지앱_협약서.docx
# 문서유형: 협약서
#
# 요약:
#   1. 메시지앱 디지털 콘텐츠 서비스 협약서
#   2. ...
#   3. ...
#
# 추출 정보:
#   - 회사명: KT, OGQ
#   - 서비스: 채팅+, 메시지앱
#   - 금액: 226,100,000원
#   - 날짜: 2025년 1월 31일
#   - 수수료: 20%
```

**summarize-file 기능:**
```bash
node index.js summarize-file "/path/to/document.pdf"
```
특정 파일 경로를 지정하여 직접 요약할 수 있습니다.

### ask 기능

`node index.js ask "<질문>"` 명령은 자연어 질문을 이해하여 적절한 기능을 자동으로 실행합니다:

**질문 유형:**
1. **금액 분석형** (키워드: 이번달/다음달/올해 + 금액/총액/합계/결제)
   - 청구 또는 계약 금액 합산
   - 청구: invoice_date/due_date 기준 필터링
   - 계약: start_date 기준 필터링
   - 예: "이번달 청구 총액 얼마야?" → 이번달 청구 금액 합계

2. **문서 요약형** (키워드: 요약해줘, 요약, 정리, 간추려) ⭐ 새로운 기능
   - 문서를 자동으로 요약
   - 회사명, 서비스, 금액, 날짜, 수수료 등 주요 정보 추출
   - 예: "KT 계약서 요약해줘" → KT 계약서 검색 후 요약
   - 예: "비즈챗 견적서 정리해줘" → 비즈챗 견적서 검색 후 요약

3. **문서 내용 질문형** (키워드: 내용, 뭐야, 무슨, 조항, 단가, 정산, 운영비)
   - 문서를 열지 않고 내용 질문
   - 관련 문서를 찾아 텍스트에서 답변 근거 제시
   - 인덱스 기반 빠른 검색 지원 ⭐
   - 예: "비즈챗 단가 얼마야?" → 비즈챗 관련 문서에서 단가 정보 검색
   - 예: "SKT 계약서에 운영비 관련 조항 있어?" → SKT 계약서에서 운영비 관련 내용 추출

4. **문서 찾기형** (키워드: 어디, 찾아)
   - 질문에서 핵심 키워드를 추출하여 문서 검색 수행
   - 인덱스 기반 빠른 검색 지원 ⭐
   - 예: "SKT 계약서 어디 있어?" → SKT 관련 문서 검색

5. **일정 조회형** (키워드: 청구, 이번달, 다음달, 일정)
   - 자연어 쿼리로 일정 검색
   - 예: "다음달 청구 일정 뭐야?" → 다음달 청구 항목 표시

6. **종료/만료형** (키워드: 끝나, 종료, 만료, 끝, 기한)
   - 계약 종료 일정 필터링
   - 예: "KT 계약 종료 언제야?" → KT 계약 종료일 표시

### ask-html 기능

`node index.js ask-html "<질문>"` 명령은 ask 기능과 동일하지만 결과를 예쁜 HTML 파일로 출력합니다:

**특징:**
- Markdown 표가 아닌 실제 HTML table로 렌더링
- 문서 경로를 클릭 가능한 file:// 링크로 제공
- 금액은 천 단위 콤마 자동 포맷
- 반응형 디자인으로 브라우저에서 보기 편함
- 파일 열기/폴더 열기 링크 제공

**사용법:**
```bash
# 기본 사용 (자동 파일명: /tmp/cs-ask-YYYY-MM-DD.html)
node index.js ask-html "KT 계약 종료 언제야?"

# 출력 경로 지정
node index.js ask-html "이번달 청구 총액 얼마야?" --output /tmp/result.html
```

**출력 내용:**
- 질문 유형 표시 (문서 찾기/일정 조회/종료 확인/금액 분석)
- 요약 카드 (건수, 합계 금액 등)
- 상세 결과 테이블
- 문서 검색 시 파일 링크 및 스니펫

### 자연어 검색 지원 표현

- **거래처**: 텍스트에 포함된 거래처명 (예: "PG사", "TEST")
- **날짜**:
  - `이번달` / `다음달`
  - `YYYY-MM` (예: `2026-03`)
  - `YYYY-MM-DD~YYYY-MM-DD` (예: `2026-03-01~2026-03-31`)
- **구분**: `계약`, `청구`, `업무`

### update 기능

`node index.js update` 명령은 다음 작업을 수행합니다:

1. `data/contracts_inbox/` 폴더의 엑셀 파일 스캔
2. 각 파일에서 일정 후보 추출
3. `events_master.xlsx`의 `InboxCandidates` 시트에 추가
4. 중복 체크 (거래처 + 기간 + 제목)
5. 처리 결과 요약 출력

**사용 시나리오:**
- 외부에서 받은 계약서/청구 엑셀을 inbox 폴더에 넣고 `update` 실행
- InboxCandidates 시트에서 검토 후 `approve`로 Events 시트로 이동

### candidates/approve 기능

**후보 목록 보기:**
```bash
node index.js candidates
```

**후보 승인:**
```bash
# 1번 후보 승인
node index.js approve --row 1

# 여러 개 승인
node index.js approve --rows 2,3,5
```

**승인 동작:**
1. 지정된 번호의 후보를 InboxCandidates에서 읽기
2. Events 시트에 중복 확인 (거래처+기간+제목)
3. 중복 없으면 Events에 추가
4. InboxCandidates에서 해당 행 삭제
5. 결과 요약 출력 (approved/failed)

### search 기능

`node index.js search "<키워드>"` 명령은 계약 문서 내용을 검색합니다:

1. **인덱스 우선 검색** ⭐ (reindex 실행 시)
   - `data/.index/documents.json`에서 후보 50개 추출
   - 전체 문서 스캔 대신 관련 문서만 상세 분석
   - 검색 속도 대폭 향상
2. `data/contracts_inbox/` 및 `data/contracts_raw/` 폴더의 문서 스캔
3. PDF, DOCX, PPTX, XLSX, CSV 파일 내용 검색
4. 키워드 매칭 파일 상위 20개 출력 (파일당 최대 3개 스니펫)
5. 텍스트 추출 결과 캐시 (`data/.cache_text/`)로 재검색 시 고속화
6. 스캔본 PDF는 `[NO_TEXT]` 표시

**사용 팁:**
- 최초 사용 시 `node index.js reindex` 실행 권장
- 인덱스가 있으면 "📚 인덱스 사용 (총 XXX개 문서 인덱싱됨)" 메시지 표시
- 인덱스가 없으면 전체 스캔 수행 (느릴 수 있음)

### OCR (광학 문자 인식) 지원

스캔본 PDF에서 텍스트를 추출하는 OCR 기능을 지원합니다:

**동작 방식:**
1. **텍스트 PDF**: pdf-parse로 텍스트 추출 (기본 방식)
2. **스캔본 PDF**: 텍스트가 50자 미만일 경우 OCR 시도
3. **OCR 실패 시**: 인덱싱은 계속 진행, 검색 결과에 `[스캔본 PDF] OCR 필요` 표시

**설정 파일:** `config/ocr.config.json`
```json
{
  "enabled": false,
  "languages": ["kor", "eng"],
  "maxPages": 3,
  "minTextLength": 50,
  "note": "OCR은 현재 비활성화되어 있습니다."
}
```

**현재 상태:**
- OCR 프레임워크는 구현되어 있으나 기본적으로 비활성화 상태
- `enabled: true`로 변경하면 OCR 기능 활성화 (pdfjs-dist 및 tesseract.js 설정 필요)
- 비활성화 상태에서도 모든 기능은 정상 동작

**OCR 상태 표시:**
- 검색/질문 결과에 OCR 사용 여부 표시
- HTML 출력 시 "✅ OCR 적용" 또는 "❌ OCR 실패" 배지 표시
- 스캔본 PDF는 `[스캔본 PDF] 텍스트 추출 불가 - OCR 필요` 경고 표시

**제한사항:**
- OCR 정확도는 원본 이미지 품질에 따라 달라집니다
- 처리 속도가 텍스트 PDF보다 느립니다 (기본 설정: 최대 3페이지만 처리)
- 한국어 + 영어 혼용 문서에서 최적의 결과를 얻습니다

## 데이터 입력 규칙 (events_master.xlsx)

### 필수 컬럼

| 컬럼명 | 설명 | 형식 | 비고 |
|--------|------|------|------|
| `type` | 구분 | 계약 \| 청구 \| 업무 | **필수** |
| `title` | 제목 | 문자열 | |
| `client` | 거래처 | 문자열 | **필수** |
| `start_date` | 시작일/대표날짜 | YYYY-MM-DD | **필수** |
| `end_date` | 종료일 | YYYY-MM-DD | 계약 타입 시 필수 |
| `billing_cycle` | 청구주기 | 월/분기/년 등 | |
| `invoice_date` | 청구일 | YYYY-MM-DD | |
| `due_date` | 납부기한 | YYYY-MM-DD | |
| `amount` | 금액 | 숫자 | 청구 타입 시 필수 |
| `currency` | 통화 | KRW/USD 등 | |
| `fee_rate` | 수수료율 | 0.035 (3.5%) | 소수점 표기 |
| `notes` | 산정근거/비고 | 문자열 | 청구 타입 시 필수 |
| `certain` | 확실여부 | TRUE/FALSE | 미기재 시 자동 판정 |
| `source` | 데이터 출처 | 문자열 | |

### 타입별 필수 필드

- **계약**: `client`, `start_date`, `end_date`
- **청구**: `client`, `start_date`, `amount`, `notes`
- **업무**: `client`, `start_date`

### 입력 형식 예시

```
type: 청구
start_date: 2026-03-01
amount: 1000000 (쉼표 없이)
fee_rate: 0.035 (3.5% → 0.035)
certain: TRUE
```

### 리마인드 기준

- **오늘 이벤트**: 날짜가 오늘인 경우
- **청구 리마인드**: 청구일 D-21 이내 (3주 전)
- **계약 종료 리마인드**: 종료일 D-120 이내 (4개월 전)

## 구조

```
data/
  events_master.xlsx        # 일정 마스터 데이터
  contracts_inbox/          # 계약서 파일 (향후)

src/
  parser/                   # 데이터 파싱
  scheduler/                # 일정 엔진 핵심
  query/                    # 검색/필터링
  formatter/                # 출력 포매팅
  config.js                 # 전역 설정
```
