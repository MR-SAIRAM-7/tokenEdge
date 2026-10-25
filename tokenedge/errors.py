"""Library-level exceptions. The API maps each one to an HTTP status and error code."""

from __future__ import annotations

from typing import Any


class TokenEdgeError(Exception):
    code = "TOKENEDGE_ERROR"
    status = 400

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class DataUnavailableError(TokenEdgeError):
    code = "DATA_UNAVAILABLE"
    status = 404


class InsufficientDataError(TokenEdgeError):
    code = "INSUFFICIENT_DATA"
    status = 422


class ModelNotFoundError(TokenEdgeError):
    code = "MODEL_NOT_FOUND"
    status = 404


class InSampleWindowError(TokenEdgeError):
    code = "IN_SAMPLE_WINDOW"
    status = 409


class ConfigError(TokenEdgeError):
    code = "VALIDATION_ERROR"
    status = 422
