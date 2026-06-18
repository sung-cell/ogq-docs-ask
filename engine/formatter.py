"""
Markdown 표 포매터

규칙:
  - GitHub-flavored Markdown 표 출력
  - 오늘 날짜 행 전체 굵게 (**bold**)
  - 빈 셀은 "-" 로 표시
  - 금액은 천 단위 쉼표 포맷
"""
from __future__ import annotations

from datetime import date

import pandas as pd

from config import OUTPUT_COLUMNS

TODAY = date.today()


def _fmt_date(val) -> str:
    if pd.isna(val):
        return "-"
    d = val.date() if hasattr(val, "date") else val
    s = d.strftime("%Y-%m-%d")
    return f"**{s}**" if d == TODAY else s


def _fmt_amount(val) -> str:
    if pd.isna(val):
        return "-"
    try:
        return f"{int(val):,}"
    except (ValueError, TypeError):
        return str(val)


def _fmt_cell(val) -> str:
    if pd.isna(val) or str(val).strip() in ("", "nan"):
        return "-"
    return str(val).strip()


def render_table(df: pd.DataFrame) -> str:
    """DataFrame → Markdown 표 문자열."""
    # 누락 컬럼 채우기
    for col in OUTPUT_COLUMNS:
        if col not in df.columns:
            df[col] = pd.NA

    header    = " | ".join(OUTPUT_COLUMNS)
    separator = " | ".join(["---"] * len(OUTPUT_COLUMNS))
    lines = [f"| {header} |", f"| {separator} |"]

    for _, row in df.iterrows():
        # 오늘 행 판정
        date_val = row.get("날짜")
        is_today = (
            pd.notna(date_val)
            and hasattr(date_val, "date")
            and date_val.date() == TODAY
        )

        cells: list[str] = []
        for col in OUTPUT_COLUMNS:
            val = row.get(col)
            if col == "날짜":
                cell = _fmt_date(val)
            elif col == "금액":
                cell = _fmt_amount(val)
            else:
                cell = _fmt_cell(val)

            cells.append(f"**{cell}**" if (is_today and col != "날짜") else cell)

        lines.append("| " + " | ".join(cells) + " |")

    return "\n".join(lines)
