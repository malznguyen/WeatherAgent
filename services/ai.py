"""OpenAI-powered weather assistant utilities."""
from __future__ import annotations

import json
import logging
import os
import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Optional

try:  # pragma: no cover - import safety for environments without OpenAI
    import openai  # type: ignore
except Exception as exc:  # pragma: no cover - gracefully handle missing dependency
    openai = None  # type: ignore
    OPENAI_VERSION = "not-installed"
    _SDK_IMPORT_ERROR: Optional[Exception] = exc
else:  # pragma: no cover - runtime only
    OPENAI_VERSION = getattr(openai, "__version__", "unknown")
    _SDK_IMPORT_ERROR = None

try:  # pragma: no cover - isolate optional dependency usage
    from openai import (
        APIConnectionError,
        APIError,
        APITimeoutError,
        OpenAI,
    )
except Exception as exc:  # pragma: no cover - gracefully handle missing dependency
    APIConnectionError = APIError = APITimeoutError = None  # type: ignore
    OpenAI = None  # type: ignore
    if _SDK_IMPORT_ERROR is None:
        _SDK_IMPORT_ERROR = exc

_LOGGER = logging.getLogger(__name__)

SUMMARY_MODEL = os.getenv("OPENAI_SUMMARY_MODEL", "gpt-4o-mini")
ALERTS_MODEL = os.getenv("OPENAI_ALERTS_MODEL", SUMMARY_MODEL)
CHAT_MODEL = os.getenv("OPENAI_CHAT_MODEL", SUMMARY_MODEL)

SYSTEM_SUMMARY = (
    "Bạn là chuyên gia khí tượng viết tiếng Việt. Sử dụng dữ liệu JSON để tóm tắt"
    " thời tiết hiện tại và 12 giờ tới trong 2-4 câu, nêu rõ mức độ tự tin (Thấp/Trung bình/Cao). "
    "Sau phần tóm tắt, đưa tối đa 4 gạch đầu dòng lời khuyên hành động rõ ràng, dùng đơn vị °C và m/s. "
    "Giữ giọng trung lập, không giật gân."
)

SYSTEM_ALERTS = (
    "Bạn là chuyên gia cảnh báo thời tiết. Phân tích dữ liệu JSON và trả về JSON với các trường:"
    " severity (none|low|moderate|high|extreme), headline (tiếng Việt, ≤80 ký tự),"
    " risks (danh sách đối tượng {type, level 1-5, why}) và advice (danh sách câu ngắn gọn)."
)

SYSTEM_QA = (
    "Bạn là trợ lý thời tiết tiếng Việt. Trả lời tối đa 6 câu dựa trên dữ liệu JSON đã cho,"
    " sử dụng đơn vị °C và m/s. Nếu thiếu dữ liệu phù hợp thì giải thích rõ thay vì suy đoán."
)


class AiDisabled(RuntimeError):
    """Raised when the AI functionality is disabled."""


class AiServiceError(RuntimeError):
    """Raised when a call to the AI service fails."""


class AiSdkIncompatible(AiServiceError):
    """Raised when the installed OpenAI SDK is incompatible."""


class AiTimeout(AiServiceError):
    """Raised when the OpenAI request times out."""


class AiParseError(AiServiceError):
    """Raised when OpenAI returns malformed JSON payloads."""


@dataclass
class _AiResult:
    trace_id: str
    model: str
    took_ms: int
    content: str


_CLIENT: Optional[OpenAI] = None
_CLIENT_KEY_FINGERPRINT: Optional[str] = None


def _mask(value: str) -> str:
    if not value:
        return "(not set)"
    trimmed = value.strip()
    if len(trimmed) <= 4:
        return "****"
    return f"****{trimmed[-4:]}"


def build_context_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    """Reduce the weather payload to the essentials for the AI prompts."""

    if not isinstance(data, dict):
        return {}

    location = data.get("location", {}) or {}
    current = data.get("current", {}) or {}
    hourly = (data.get("hourly") or [])[:12]
    daily = (data.get("daily") or [])[:7]
    fetched_at = data.get("fetched_at")

    return {
        "location": {
            "name": location.get("name"),
            "lat": location.get("lat"),
            "lon": location.get("lon"),
        },
        "current": current,
        "hourly": hourly,
        "daily": daily,
        "fetched_at": fetched_at,
    }


def _get_client() -> OpenAI:
    global _CLIENT, _CLIENT_KEY_FINGERPRINT

    if OpenAI is None:  # pragma: no cover - dependency missing in runtime
        if openai is None:
            raise AiDisabled("OpenAI SDK is not installed")
        raise AiSdkIncompatible("OpenAI SDK is incompatible with this application")

    if _CLIENT is not None:
        return _CLIENT

    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise AiDisabled("OpenAI API key is missing")

    _CLIENT = OpenAI(api_key=api_key)
    _CLIENT_KEY_FINGERPRINT = _mask(api_key)
    _LOGGER.info("OpenAI client initialized with key=%s", _CLIENT_KEY_FINGERPRINT)
    return _CLIENT


def _call_openai(*, model: str, system: str, user: str, response_format: Optional[Dict[str, Any]] = None) -> _AiResult:
    client = _get_client()
    trace_id = str(uuid.uuid4())
    started = time.perf_counter()
    last_error: Optional[Exception] = None

    payload: Dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.3,
    }
    if response_format:
        payload["response_format"] = response_format

    for attempt in range(2):
        try:
            response = client.responses.create(timeout=10, **payload)
            took_ms = int((time.perf_counter() - started) * 1000)
            model_used = getattr(response, "model", model)
            content = getattr(response, "output_text", "").strip()
            return _AiResult(trace_id=trace_id, model=model_used, took_ms=took_ms, content=content)
        except APITimeoutError as exc:  # pragma: no cover - network path
            last_error = exc
            _LOGGER.warning("OpenAI request timeout (attempt %s/%s)", attempt + 1, 2)
            if attempt == 1:
                raise AiTimeout("OpenAI request timed out") from exc
        except APIConnectionError as exc:  # pragma: no cover - network path
            last_error = exc
            _LOGGER.warning("OpenAI connection error (attempt %s/%s): %s", attempt + 1, 2, exc)
        except APIError as exc:  # pragma: no cover - network path
            status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
            if status and int(status) >= 500 and attempt == 0:
                last_error = exc
                _LOGGER.warning(
                    "OpenAI server error %s (attempt %s/%s)", status, attempt + 1, 2
                )
            else:
                raise AiServiceError(f"OpenAI API error: {exc}") from exc

        if attempt == 0:
            continue

        if last_error:
            raise AiServiceError(f"OpenAI request failed: {last_error}") from last_error

    raise AiServiceError("OpenAI request failed: unknown error")


def sdk_status() -> Dict[str, Any]:
    """Return diagnostic information about the OpenAI SDK import state."""

    return {
        "version": OPENAI_VERSION,
        "error": str(_SDK_IMPORT_ERROR) if _SDK_IMPORT_ERROR else None,
        "compatible": OpenAI is not None,
    }


def summarize(data: Dict[str, Any]) -> Dict[str, Any]:
    context = build_context_payload(data)
    user_prompt = (
        "Dưới đây là dữ liệu thời tiết dạng JSON. Hãy bám sát hướng dẫn hệ thống để"
        " tóm tắt, nêu mức độ tự tin và đưa ra mẹo phù hợp.\n"
        f"```json\n{json.dumps(context, ensure_ascii=False)}\n```"
    )
    result = _call_openai(model=SUMMARY_MODEL, system=SYSTEM_SUMMARY, user=user_prompt)
    return {
        "summary": result.content,
        "trace_id": result.trace_id,
        "model": result.model,
        "took_ms": result.took_ms,
    }


def alerts(data: Dict[str, Any]) -> Dict[str, Any]:
    context = build_context_payload(data)
    user_prompt = (
        "Trích xuất rủi ro thời tiết từ dữ liệu JSON sau và trả về JSON theo hướng dẫn hệ thống.\n"
        f"```json\n{json.dumps(context, ensure_ascii=False)}\n```"
    )
    result = _call_openai(
        model=ALERTS_MODEL,
        system=SYSTEM_ALERTS,
        user=user_prompt,
        response_format={"type": "json_object"},
    )

    try:
        parsed = json.loads(result.content)
    except json.JSONDecodeError as exc:
        raise AiParseError("OpenAI trả về nội dung không phải JSON hợp lệ") from exc

    if isinstance(parsed, dict) and isinstance(parsed.get("analysis"), dict):
        analysis = parsed["analysis"]
    elif isinstance(parsed, dict):
        analysis = parsed
    else:
        raise AiParseError("Phản hồi AI không đúng định dạng JSON mong đợi")

    _validate_alerts_payload(analysis)

    return {
        "analysis": analysis,
        "trace_id": result.trace_id,
        "model": result.model,
        "took_ms": result.took_ms,
    }


def chat(question: str, data: Dict[str, Any]) -> Dict[str, Any]:
    context = build_context_payload(data)
    user_prompt = (
        "Dữ liệu thời tiết JSON:\n"
        f"```json\n{json.dumps(context, ensure_ascii=False)}\n```\n"
        f"Câu hỏi: {question.strip()}"
    )
    result = _call_openai(model=CHAT_MODEL, system=SYSTEM_QA, user=user_prompt)
    return {
        "answer": result.content,
        "trace_id": result.trace_id,
        "model": result.model,
        "took_ms": result.took_ms,
    }


def _validate_alerts_payload(analysis: Dict[str, Any]) -> None:
    severity = analysis.get("severity")
    headline = analysis.get("headline")
    risks = analysis.get("risks", [])
    advice = analysis.get("advice", [])

    allowed_severities = {"none", "low", "moderate", "high", "extreme"}
    allowed_types = {"heat", "rain", "wind", "uv", "visibility", "storm"}

    if severity not in allowed_severities:
        raise AiServiceError("Giá trị 'severity' không hợp lệ")

    if not isinstance(headline, str) or len(headline) > 80:
        raise AiServiceError("'headline' phải là chuỗi tối đa 80 ký tự")

    if not isinstance(risks, list):
        raise AiServiceError("'risks' phải là danh sách")
    for entry in risks:
        if not isinstance(entry, dict):
            raise AiServiceError("Mỗi phần tử trong 'risks' phải là đối tượng")
        if entry.get("type") not in allowed_types:
            raise AiServiceError("Loại rủi ro không hợp lệ")
        level = entry.get("level")
        if not isinstance(level, int) or not (1 <= level <= 5):
            raise AiServiceError("Mức 'level' phải là số nguyên 1-5")
        if not entry.get("why"):
            raise AiServiceError("Mỗi rủi ro cần lý do 'why'")

    if not isinstance(advice, list):
        raise AiServiceError("'advice' phải là danh sách")
    for tip in advice:
        if not isinstance(tip, str) or not tip.strip():
            raise AiServiceError("Mỗi gợi ý trong 'advice' phải là chuỗi không rỗng")

