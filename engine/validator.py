"""
확실여부 검증기

규칙:
  - 구분별 필수 필드가 모두 채워진 경우 → "확실"
  - 하나라도 비어 있으면 → "불확실"
  - xlsx 에 이미 값이 있으면 수동 설정값을 우선 유지
"""
from __future__ import annotations

import pandas as pd

from config import REQUIRED_FIELDS_FOR_CERTAIN


def check_certainty(row: pd.Series) -> str:
    """단일 행의 확실여부 판정."""
    event_type = str(row.get("구분", ""))
    required = REQUIRED_FIELDS_FOR_CERTAIN.get(event_type, ["날짜"])

    for field in required:
        val = row.get(field)
        if pd.isna(val) or str(val).strip() in ("", "nan"):
            return "불확실"
    return "확실"


def apply_certainty(df: pd.DataFrame) -> pd.DataFrame:
    """DataFrame 전체에 확실여부 컬럼 적용.

    이미 값이 있는 셀은 덮어쓰지 않음 (수동 입력 존중).
    """
    df = df.copy()

    if "확실여부" not in df.columns:
        df["확실여부"] = pd.NA

    auto_fill_mask = df["확실여부"].isna() | (
        df["확실여부"].astype(str).str.strip().isin(["", "nan"])
    )
    df.loc[auto_fill_mask, "확실여부"] = df[auto_fill_mask].apply(
        check_certainty, axis=1
    )
    return df
