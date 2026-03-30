"""
데이터 로딩 레이어

원천:
  1. data/events_master.xlsx   → 마스터 일정 DataFrame
  2. data/contracts_inbox/     → 계약서 파일 목록 (향후 파서 연결용)
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from config import CONTRACTS_INBOX_DIR, EVENTS_MASTER_PATH


def load_events() -> pd.DataFrame:
    """events_master.xlsx 를 읽어 DataFrame 으로 반환.

    - 날짜 컬럼은 datetime 으로 정규화
    - 파일 없으면 빈 DataFrame 반환 (에러 없음)
    """
    path = Path(EVENTS_MASTER_PATH)
    if not path.exists():
        return pd.DataFrame()

    df = pd.read_excel(path, dtype=str)

    # 날짜 컬럼 datetime 변환
    for col in ("날짜", "계약종료일", "청구일"):
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce")

    # 금액 컬럼 숫자 변환 (쉼표 제거 후)
    if "금액" in df.columns:
        df["금액"] = (
            df["금액"]
            .str.replace(",", "", regex=False)
            .pipe(pd.to_numeric, errors="coerce")
        )

    return df


def load_contract_files() -> list[dict]:
    """contracts_inbox/ 파일 목록 반환.

    각 항목: {"filename": str, "path": Path, "content": str | None}
    향후 PDF/DOCX 파서를 content 필드에 연결.
    """
    inbox = Path(CONTRACTS_INBOX_DIR)
    if not inbox.exists():
        return []

    results = []
    for f in sorted(inbox.iterdir()):
        if f.is_file():
            results.append(
                {
                    "filename": f.name,
                    "path": f,
                    "content": None,  # TODO: parse PDF/DOCX
                }
            )
    return results
