"""
contract-scheduler 전역 설정
"""
from datetime import timedelta
from pathlib import Path

# ── 리마인드 기준 ──────────────────────────────────────────
BILLING_REMIND_BEFORE      = timedelta(weeks=3)    # 청구 3주 전
CONTRACT_END_REMIND_BEFORE = timedelta(days=120)   # 계약 종료 4개월 전

# ── 데이터 경로 ────────────────────────────────────────────
BASE_DIR            = Path(__file__).parent
EVENTS_MASTER_PATH  = BASE_DIR / "data" / "events_master.xlsx"
CONTRACTS_INBOX_DIR = BASE_DIR / "data" / "contracts_inbox"

# ── 출력 컬럼 순서 ─────────────────────────────────────────
OUTPUT_COLUMNS = [
    "구분",
    "날짜",
    "거래처",
    "청구주기",
    "청구기준",
    "금액",
    "산정근거",
    "확실여부",
    "리마인드",
]

# ── 구분별 확실 판정에 필요한 필수 필드 ────────────────────
REQUIRED_FIELDS_FOR_CERTAIN = {
    "계약": ["거래처", "날짜", "계약종료일"],
    "청구": ["거래처", "날짜", "금액", "산정근거"],
    "업무": ["거래처", "날짜"],
}
