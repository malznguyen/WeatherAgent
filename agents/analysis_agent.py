"""Analysis agent leveraging OpenAI's GPT models to interpret weather data."""
from __future__ import annotations

import json
from typing import Any, Dict

from openai import OpenAI


class AnalysisAgent:
    """Agent responsible for generating insights from raw weather data."""

    def __init__(self, openai_api_key: str) -> None:
        """Create a new analysis agent with the supplied OpenAI API key."""
        self._client = OpenAI(api_key=openai_api_key)

    def generate_insights(self, raw_weather_data: Any) -> Dict[str, str]:
        """Generate insights from raw meteorological data using an OpenAI model.

        Parameters
        ----------
        raw_weather_data:
            Any meteorological payload (dict, string, etc.) describing the
            current weather conditions.

        Returns
        -------
        Dict[str, str]
            A dictionary containing the summary, alert, and AI advice.
        """
        prompt = (
            "Bạn là một chuyên gia khí tượng hỗ trợ phân tích dữ liệu.\n"
            "Hãy đọc dữ liệu khí tượng thô sau đây và trả lời theo định dạng JSON.\n"
            "Dữ liệu:\n"
            f"{raw_weather_data}\n\n"
            "Yêu cầu:\n"
            "1. Tóm tắt ngắn gọn các điều kiện thời tiết chính (summary).\n"
            "2. Đưa ra cảnh báo (alert) dựa trên dữ liệu. Ví dụ: nếu nhiệt độ ≤ 15°C thì cảnh báo 'Rét Đậm'.\n"
            "3. Tạo một đoạn khuyến nghị thân thiện (advice) liên quan đến đời sống (nông nghiệp, giao thông, ...).\n"
            "4. Phản hồi phải là JSON hợp lệ với các khóa: summary, alert, advice.\n"
        )

        response = self._client.responses.create(
            model="gpt-4o-mini",
            input=prompt,
            temperature=0.7,
        )

        message = response.output_text

        try:
            insights = json.loads(message)
        except json.JSONDecodeError as error:
            raise ValueError("Không thể phân tích phản hồi từ mô hình GPT") from error

        expected_keys = {"summary", "alert", "advice"}
        if not expected_keys.issubset(insights):
            missing = ", ".join(sorted(expected_keys - insights.keys()))
            raise ValueError(f"Thiếu khóa trong phản hồi GPT: {missing}")

        return {key: str(insights[key]) for key in expected_keys}
