"""
contract-scheduler CLI

사용법:
  python main.py list      # 전체 일정표 출력
  python main.py remind    # 리마인드 항목만 출력
  python main.py query     # (TODO) 자연어 질문 → Claude API 연동
"""
from __future__ import annotations

import sys

from engine.formatter import render_table
from engine.loader import load_events
from engine.scheduler import apply_reminders, sort_events
from engine.validator import apply_certainty


def _prepare() -> "pd.DataFrame":
    import pandas as pd

    df = load_events()
    if df.empty:
        print("⚠️  데이터 없음: data/events_master.xlsx 를 확인하세요.")
        sys.exit(0)

    df = apply_certainty(df)
    df = apply_reminders(df)
    df = sort_events(df)
    return df


def cmd_list() -> None:
    """전체 일정표 출력."""
    df = _prepare()
    print(render_table(df))


def cmd_remind() -> None:
    """리마인드 활성 항목만 출력."""
    df = _prepare()
    active = df[df["리마인드"] != "-"]
    if active.empty:
        print("현재 리마인드 항목 없음.")
        return
    print(render_table(active))


def cmd_query() -> None:
    """자연어 질문 처리 (TODO: Claude API 연동)."""
    print("TODO: Claude API 연동 후 구현 예정")
    print("현재는 list / remind 명령만 사용 가능합니다.")


COMMANDS = {
    "list":   cmd_list,
    "remind": cmd_remind,
    "query":  cmd_query,
}


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    handler = COMMANDS.get(cmd)
    if handler is None:
        print(f"알 수 없는 명령: {cmd}")
        print(f"사용 가능: {', '.join(COMMANDS)}")
        sys.exit(1)
    handler()


if __name__ == "__main__":
    main()
