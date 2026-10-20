"""Resilient HTTP client for transmitting sensor telemetry with anti-crash retry mechanisms."""

import logging
import time
from typing import Any, Union
import requests

from ..config import AppConfig, config as default_config
from ..models.telemetry import TelemetryPayload

logger = logging.getLogger(__name__)


class TelemetryClient:
    """Anti-crash HTTP client designed to reliably transmit telemetry payloads to the backend API."""

    def __init__(self, app_config: AppConfig | None = None):
        self.config = app_config or default_config
        self.target_url = self.config.backend_api_url
        self.timeout = self.config.request_timeout_seconds
        self.max_retries = max(1, self.config.max_retries)

        # Standard persistent session
        self.session = requests.Session()

    def send_reading(self, reading: TelemetryPayload) -> bool:
        """
        Send a single telemetry reading to the backend.

        Returns:
            True if transmission succeeded (2xx), False otherwise. Guaranteed not to raise unhandled exceptions.
        """
        payload = reading.to_backend_payload()
        return self._send_json(payload)

    def send_batch(self, readings: list[TelemetryPayload]) -> bool:
        """
        Send a batch of telemetry readings for all assets.

        Returns:
            True if transmission succeeded, False otherwise.
        """
        payload = [r.to_backend_payload() for r in readings]
        return self._send_json(payload)

    def _send_json(self, json_data: Union[dict[str, Any], list[dict[str, Any]]]) -> bool:
        """
        Execute POST request with robust try-except error handling and anti-crash protection.
        """
        for attempt in range(1, self.max_retries + 1):
            try:
                response = self.session.post(
                    self.target_url,
                    json=json_data,
                    timeout=self.timeout,
                    headers={"Content-Type": "application/json"},
                )

                if 200 <= response.status_code < 300:
                    logger.debug("Successfully posted telemetry to %s (status=%d)", self.target_url, response.status_code)
                    return True

                logger.warning(
                    "[Attempt %d/%d] Backend returned HTTP %d: %s",
                    attempt,
                    self.max_retries,
                    response.status_code,
                    response.text[:120] if response.text else "No content",
                )

            except requests.exceptions.ConnectionError:
                logger.warning(
                    "[Attempt %d/%d] Connection refused at %s (Backend server offline).",
                    attempt,
                    self.max_retries,
                    self.target_url,
                )
            except requests.exceptions.Timeout:
                logger.warning(
                    "[Attempt %d/%d] Request timed out (%s s) to %s.",
                    attempt,
                    self.max_retries,
                    self.timeout,
                    self.target_url,
                )
            except requests.exceptions.RequestException as err:
                logger.warning(
                    "[Attempt %d/%d] Network error: %s",
                    attempt,
                    self.max_retries,
                    err,
                )
            except Exception as unhandled_err:
                logger.error(
                    "Unexpected error during transmission: %s",
                    unhandled_err,
                )

            # Backoff delay before retry (fast backoff 0.15s, 0.3s...)
            if attempt < self.max_retries:
                backoff_wait = 0.15 * (2 ** (attempt - 1))
                time.sleep(backoff_wait)

        # Retries exhausted: return False gracefully without crashing caller
        return False

    def close(self) -> None:
        """Close the underlying requests session."""
        try:
            self.session.close()
        except Exception:
            pass
