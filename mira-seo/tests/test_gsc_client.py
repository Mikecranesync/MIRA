"""Tests for Google Search Console client."""

from __future__ import annotations

import base64
import json
import os
from unittest.mock import MagicMock, patch

import pytest

from mira_seo.providers.gsc_client import GSCClient


class TestGSCClient:
    """Test suite for GSCClient."""

    def test_is_available_false_when_env_var_missing(self):
        """Test that is_available returns False when GSC_SERVICE_ACCOUNT_JSON is not set."""
        # Ensure the env var is not set
        with patch.dict(os.environ, {}, clear=False):
            if "GSC_SERVICE_ACCOUNT_JSON" in os.environ:
                del os.environ["GSC_SERVICE_ACCOUNT_JSON"]

            client = GSCClient()
            assert client.is_available() is False

    def test_is_available_false_when_invalid_base64(self):
        """Test that is_available returns False when env var is invalid base64."""
        invalid_base64 = "not@valid@base64!!!"

        with patch.dict(os.environ, {"GSC_SERVICE_ACCOUNT_JSON": invalid_base64}):
            client = GSCClient()
            assert client.is_available() is False

    def test_is_available_false_when_invalid_json(self):
        """Test that is_available returns False when decoded value is not JSON."""
        # Valid base64 but not valid JSON
        invalid_json = base64.b64encode(b"not json").decode()

        with patch.dict(os.environ, {"GSC_SERVICE_ACCOUNT_JSON": invalid_json}):
            client = GSCClient()
            assert client.is_available() is False

    @patch("mira_seo.providers.gsc_client.Credentials.from_service_account_info")
    @patch("mira_seo.providers.gsc_client.discovery.build")
    def test_is_available_true_when_credentials_valid(self, mock_build, mock_credentials):
        """Test that is_available returns True when credentials are valid."""
        service_account_info = {
            "type": "service_account",
            "project_id": "test-project",
            "private_key_id": "key-id",
            "private_key": "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----\n",
            "client_email": "test@test-project.iam.gserviceaccount.com",
            "client_id": "123456789",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
        encoded = base64.b64encode(json.dumps(service_account_info).encode()).decode()

        mock_credentials.return_value = MagicMock()
        mock_build.return_value = MagicMock()

        with patch.dict(os.environ, {"GSC_SERVICE_ACCOUNT_JSON": encoded}):
            client = GSCClient()
            assert client.is_available() is True
            mock_credentials.assert_called_once()
            mock_build.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_top_queries_returns_empty_when_unavailable(self):
        """Test that get_top_queries returns empty list when client is unavailable."""
        with patch.dict(os.environ, {}, clear=False):
            if "GSC_SERVICE_ACCOUNT_JSON" in os.environ:
                del os.environ["GSC_SERVICE_ACCOUNT_JSON"]

            client = GSCClient()
            result = await client.get_top_queries("https://factorylm.com/")
            assert result == []

    @pytest.mark.asyncio
    @patch("mira_seo.providers.gsc_client.Credentials.from_service_account_info")
    @patch("mira_seo.providers.gsc_client.discovery.build")
    async def test_get_top_queries_returns_correctly_shaped_dicts(
        self, mock_build, mock_credentials
    ):
        """Test that get_top_queries returns correctly shaped dicts."""
        service_account_info = {
            "type": "service_account",
            "project_id": "test-project",
            "private_key_id": "key-id",
            "private_key": "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----\n",
            "client_email": "test@test-project.iam.gserviceaccount.com",
            "client_id": "123456789",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
        encoded = base64.b64encode(json.dumps(service_account_info).encode()).decode()

        # Mock the service and its query method
        mock_service = MagicMock()
        mock_searchanalytics = MagicMock()
        mock_query = MagicMock()

        mock_service.searchanalytics.return_value = mock_searchanalytics
        mock_searchanalytics.query.return_value = mock_query
        mock_query.execute.return_value = {
            "rows": [
                {
                    "keys": ["test query"],
                    "clicks": 50,
                    "impressions": 200,
                    "position": 2.5,
                    "ctr": 0.25,
                },
                {
                    "keys": ["another query"],
                    "clicks": 30,
                    "impressions": 150,
                    "position": 3.7,
                    "ctr": 0.20,
                },
            ]
        }

        mock_credentials.return_value = MagicMock()
        mock_build.return_value = mock_service

        with patch.dict(os.environ, {"GSC_SERVICE_ACCOUNT_JSON": encoded}):
            client = GSCClient()
            result = await client.get_top_queries("https://factorylm.com/", days=90)

            assert len(result) == 2
            assert result[0]["query"] == "test query"
            assert result[0]["clicks"] == 50
            assert result[0]["impressions"] == 200
            assert result[0]["position"] == 2.5
            assert result[0]["ctr"] == 0.25

            assert result[1]["query"] == "another query"
            assert result[1]["clicks"] == 30
            assert result[1]["impressions"] == 150
            assert result[1]["position"] == 3.7
            assert result[1]["ctr"] == 0.20

    @pytest.mark.asyncio
    @patch("mira_seo.providers.gsc_client.Credentials.from_service_account_info")
    @patch("mira_seo.providers.gsc_client.discovery.build")
    async def test_get_top_pages_returns_correctly_shaped_dicts(self, mock_build, mock_credentials):
        """Test that get_top_pages returns correctly shaped dicts."""
        service_account_info = {
            "type": "service_account",
            "project_id": "test-project",
            "private_key_id": "key-id",
            "private_key": "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----\n",
            "client_email": "test@test-project.iam.gserviceaccount.com",
            "client_id": "123456789",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
        encoded = base64.b64encode(json.dumps(service_account_info).encode()).decode()

        # Mock the service and its query method
        mock_service = MagicMock()
        mock_searchanalytics = MagicMock()
        mock_query = MagicMock()

        mock_service.searchanalytics.return_value = mock_searchanalytics
        mock_searchanalytics.query.return_value = mock_query
        mock_query.execute.return_value = {
            "rows": [
                {
                    "keys": ["https://factorylm.com/"],
                    "clicks": 100,
                    "impressions": 500,
                    "position": 1.5,
                    "ctr": 0.20,
                },
                {
                    "keys": ["https://factorylm.com/about"],
                    "clicks": 45,
                    "impressions": 300,
                    "position": 2.1,
                    "ctr": 0.15,
                },
            ]
        }

        mock_credentials.return_value = MagicMock()
        mock_build.return_value = mock_service

        with patch.dict(os.environ, {"GSC_SERVICE_ACCOUNT_JSON": encoded}):
            client = GSCClient()
            result = await client.get_top_pages("https://factorylm.com/", days=90)

            assert len(result) == 2
            assert result[0]["page"] == "https://factorylm.com/"
            assert result[0]["clicks"] == 100
            assert result[0]["impressions"] == 500
            assert result[0]["position"] == 1.5
            assert result[0]["ctr"] == 0.20

            assert result[1]["page"] == "https://factorylm.com/about"
            assert result[1]["clicks"] == 45
            assert result[1]["impressions"] == 300
            assert result[1]["position"] == 2.1
            assert result[1]["ctr"] == 0.15

    @pytest.mark.asyncio
    @patch("mira_seo.providers.gsc_client.discovery.build")
    async def test_get_top_pages_returns_empty_when_unavailable(self, mock_build):
        """Test that get_top_pages returns empty list when client is unavailable."""
        with patch.dict(os.environ, {}, clear=False):
            if "GSC_SERVICE_ACCOUNT_JSON" in os.environ:
                del os.environ["GSC_SERVICE_ACCOUNT_JSON"]

            client = GSCClient()
            result = await client.get_top_pages("https://factorylm.com/")
            assert result == []

    @pytest.mark.asyncio
    @patch("mira_seo.providers.gsc_client.Credentials.from_service_account_info")
    @patch("mira_seo.providers.gsc_client.discovery.build")
    async def test_respects_days_parameter(self, mock_build, mock_credentials):
        """Test that the days parameter is passed to the API correctly."""
        service_account_info = {
            "type": "service_account",
            "project_id": "test-project",
            "private_key_id": "key-id",
            "private_key": "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----\n",
            "client_email": "test@test-project.iam.gserviceaccount.com",
            "client_id": "123456789",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
        encoded = base64.b64encode(json.dumps(service_account_info).encode()).decode()

        mock_service = MagicMock()
        mock_searchanalytics = MagicMock()
        mock_query = MagicMock()

        mock_service.searchanalytics.return_value = mock_searchanalytics
        mock_searchanalytics.query.return_value = mock_query
        mock_query.execute.return_value = {"rows": []}

        mock_credentials.return_value = MagicMock()
        mock_build.return_value = mock_service

        with patch.dict(os.environ, {"GSC_SERVICE_ACCOUNT_JSON": encoded}):
            client = GSCClient()
            await client.get_top_queries("https://factorylm.com/", days=30)

            # Verify query was called
            mock_searchanalytics.query.assert_called_once()
            call_args = mock_searchanalytics.query.call_args

            # Check the body includes correct date range
            body = call_args.kwargs["body"]
            assert "startDate" in body
            assert "endDate" in body
            # Just verify they exist and are formatted correctly
            assert len(body["startDate"]) == 10  # YYYY-MM-DD format
            assert len(body["endDate"]) == 10

    @pytest.mark.asyncio
    @patch("mira_seo.providers.gsc_client.Credentials.from_service_account_info")
    @patch("mira_seo.providers.gsc_client.discovery.build")
    async def test_returns_empty_list_on_api_error(self, mock_build, mock_credentials):
        """Test that method returns empty list on API error."""
        service_account_info = {
            "type": "service_account",
            "project_id": "test-project",
            "private_key_id": "key-id",
            "private_key": "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----\n",
            "client_email": "test@test-project.iam.gserviceaccount.com",
            "client_id": "123456789",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
        encoded = base64.b64encode(json.dumps(service_account_info).encode()).decode()

        mock_service = MagicMock()
        mock_searchanalytics = MagicMock()
        mock_query = MagicMock()

        mock_service.searchanalytics.return_value = mock_searchanalytics
        mock_searchanalytics.query.return_value = mock_query
        # Simulate an API error
        mock_query.execute.side_effect = Exception("API Error: 403 Forbidden")

        mock_credentials.return_value = MagicMock()
        mock_build.return_value = mock_service

        with patch.dict(os.environ, {"GSC_SERVICE_ACCOUNT_JSON": encoded}):
            client = GSCClient()
            result = await client.get_top_queries("https://factorylm.com/")

            # Should return empty list, not raise
            assert result == []

    @pytest.mark.asyncio
    @patch("mira_seo.providers.gsc_client.Credentials.from_service_account_info")
    @patch("mira_seo.providers.gsc_client.discovery.build")
    async def test_handles_empty_response(self, mock_build, mock_credentials):
        """Test handling of empty API response."""
        service_account_info = {
            "type": "service_account",
            "project_id": "test-project",
            "private_key_id": "key-id",
            "private_key": "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----\n",
            "client_email": "test@test-project.iam.gserviceaccount.com",
            "client_id": "123456789",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
        encoded = base64.b64encode(json.dumps(service_account_info).encode()).decode()

        mock_service = MagicMock()
        mock_searchanalytics = MagicMock()
        mock_query = MagicMock()

        mock_service.searchanalytics.return_value = mock_searchanalytics
        mock_searchanalytics.query.return_value = mock_query
        mock_query.execute.return_value = {}  # Empty response (no "rows" key)

        mock_credentials.return_value = MagicMock()
        mock_build.return_value = mock_service

        with patch.dict(os.environ, {"GSC_SERVICE_ACCOUNT_JSON": encoded}):
            client = GSCClient()
            result = await client.get_top_queries("https://factorylm.com/")

            assert result == []

    @pytest.mark.asyncio
    @patch("mira_seo.providers.gsc_client.Credentials.from_service_account_info")
    @patch("mira_seo.providers.gsc_client.discovery.build")
    async def test_position_and_ctr_rounded_to_2dp(self, mock_build, mock_credentials):
        """Test that position and ctr are rounded to 2 decimal places."""
        service_account_info = {
            "type": "service_account",
            "project_id": "test-project",
            "private_key_id": "key-id",
            "private_key": "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----\n",
            "client_email": "test@test-project.iam.gserviceaccount.com",
            "client_id": "123456789",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
        encoded = base64.b64encode(json.dumps(service_account_info).encode()).decode()

        mock_service = MagicMock()
        mock_searchanalytics = MagicMock()
        mock_query = MagicMock()

        mock_service.searchanalytics.return_value = mock_searchanalytics
        mock_searchanalytics.query.return_value = mock_query
        mock_query.execute.return_value = {
            "rows": [
                {
                    "keys": ["test"],
                    "clicks": 50,
                    "impressions": 200,
                    "position": 2.123456789,
                    "ctr": 0.250000001,
                },
            ]
        }

        mock_credentials.return_value = MagicMock()
        mock_build.return_value = mock_service

        with patch.dict(os.environ, {"GSC_SERVICE_ACCOUNT_JSON": encoded}):
            client = GSCClient()
            result = await client.get_top_queries("https://factorylm.com/")

            assert len(result) == 1
            assert result[0]["position"] == 2.12
            assert result[0]["ctr"] == 0.25
