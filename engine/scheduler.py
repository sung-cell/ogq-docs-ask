"""
일정 엔진 코어

담당:
  - 리마인드 계산 (청구 3주 전 / 계약 종료 4개월 전 / 오늘)
  - 날짜 기준 정렬 (날짜 없는 항목은 하단)
"""
from __future__ import annotations

from datetime import date

import pandas as pd

from config import BILLING_REMIND_BEFORE, CONTRACT_END_REMIND_BEFORE

TODAY = date.today()


# ── 리마인드 계산 ──────────────────────────────────────────


def _remind_billing(row: pd.Series) -> str | None:
    """청구 3주 전 리마인드."""
    billing_date = row.get("청구일") or row.get("날짜")
    if pd.isna(billing_date):
        return None
    delta = (billing_date.date() - TODAY).days
    if 0 <= delta <= BILLING_REMIND_BEFORE.days:
        return f"청구 D-{delta}"
    return None


def _remind_contract_end(row: pd.Series) -> str | None:
    """계약 종료 4개월 전 리마인드."""
    end_date = row.get("계약종료일")
    if pd.isna(end_date):
        return None
    delta = (end_date.date() - TODAY).days
    if 0 <= delta <= CONTRACT_END_REMIND_BEFORE.days:
        return f"종료 D-{delta}"
    return None


def calculate_remind(row: pd.Series) -> str:
    """단일 행에 대한 리마인드 문자열 반환.

    우선순위: 오늘 → 청구 → 계약종료
    """
    parts: list[str] = []

    # 오늘 판정
    event_date = row.get("날짜")
    if pd.notna(event_date) and event_date.date() == TODAY:
        parts.append("오늘")

    event_type = str(row.get("구분", ""))

    if event_type == "청구":
        r = _remind_billing(row)
        if r:
            parts.append(r)
    elif event_type == "계약":
        r = _remind_contract_end(row)
        if r:
            parts.append(r)

    return ", ".join(parts) if parts else "-"


def apply_reminders(df: pd.DataFrame) -> pd.DataFrame:
    """DataFrame 전체에 리마인드 컬럼 추가."""
    df = df.copy()
    df["리마인드"] = df.apply(calculate_remind, axis=1)
    return df


# ── 정렬 ───────────────────────────────────────────────────


def sort_events(df: pd.DataFrame) -> pd.DataFrame:
    """날짜 오름차순 정렬. 날짜 없는 항목은 하단."""
    has_date = df["날짜"].notna()
    dated   = df[has_date].sort_values("날짜")
    undated = df[~has_date]
    return pd.concat([dated, undated], ignore_index=True)
