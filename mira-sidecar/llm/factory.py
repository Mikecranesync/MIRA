"""Provider factory.

Creates concrete LLM and embedding provider instances from Settings.
Returns a tuple (llm_provider, embed_provider) because they can differ —
most notably when Anthropic is the LLM backend (which has no embedding API)
and Ollama handles embeddings.
"""

from __future__ import annotations

import logging

from .anthropic_provider import AnthropicProvider
from .base import EmbedProvider, LLMProvider
from .ollama_provider import OllamaProvider
from .openai_provider import OpenAIProvider

logger = logging.getLogger("mira-sidecar")


def create_providers(settings: object) -> tuple[LLMProvider, EmbedProvider]:
    """Instantiate and return (llm_provider, embed_provider) from settings.

    Rules:
    - anthropic LLM → embed always uses Ollama (Anthropic has no embed API)
    - openai LLM + openai embed → two OpenAI instances (different models)
    - ollama LLM → ollama embed by default unless overridden

    Logs a warning when required API keys are absent rather than raising,
    so the sidecar starts up even in misconfigured environments and the
    operator can see what is wrong via /status.
    """
    # Normalise attribute access — accepts Settings instance or any object
    # with the expected attributes.
    llm_provider_name: str = getattr(settings, "llm_provider", "openai").lower()
    embed_provider_name: str = getattr(settings, "embedding_provider", "ollama").lower()
    openai_api_key: str = getattr(settings, "openai_api_key", "")
    anthropic_api_key: str = getattr(settings, "anthropic_api_key", "")
    ollama_base_url: str = getattr(settings, "ollama_base_url", "http://localhost:11434")
    llm_model_openai: str = getattr(settings, "llm_model_openai", "gpt-4o-mini")
    llm_model_anthropic: str = getattr(settings, "llm_model_anthropic", "claude-sonnet-4-6")
    llm_model_ollama: str = getattr(settings, "llm_model_ollama", "llama3")
    openai_embed_model: str = getattr(settings, "openai_embed_model", "text-embedding-3-small")
    ollama_embed_model: str = getattr(settings, "ollama_embed_model", "nomic-embed-text")

    # ------------------------------------------------------------------
    # Build LLM provider
    # ------------------------------------------------------------------
    llm: LLMProvider
    if llm_provider_name == "anthropic":
        if not anthropic_api_key:
            logger.warning("llm_provider=anthropic but ANTHROPIC_API_KEY is empty")
        llm = AnthropicProvider(
            api_key=anthropic_api_key,
            model=llm_model_anthropic,
            ollama_base_url=ollama_base_url,
            ollama_embed_model=ollama_embed_model,
        )
    elif llm_provider_name == "ollama":
        llm = OllamaProvider(
            base_url=ollama_base_url,
            chat_model=llm_model_ollama,
            embed_model=ollama_embed_model,
        )
    else:
        # Default: openai
        if llm_provider_name != "openai":
            logger.warning(
                "Unknown llm_provider '%s', falling back to openai", llm_provider_name
            )
        if not openai_api_key:
            logger.warning("llm_provider=openai but OPENAI_API_KEY is empty")
        llm = OpenAIProvider(
            api_key=openai_api_key,
            chat_model=llm_model_openai,
            embed_model=openai_embed_model,
        )

    # ------------------------------------------------------------------
    # Build embedding provider
    # ------------------------------------------------------------------
    # When LLM is Anthropic, embedding MUST use Ollama regardless of the
    # embedding_provider setting (Anthropic has no embedding API).
    embed: EmbedProvider
    if llm_provider_name == "anthropic":
        logger.info(
            "Anthropic LLM selected — embedding provider forced to Ollama (%s)",
            ollama_base_url,
        )
        embed = OllamaProvider(
            base_url=ollama_base_url,
            chat_model=llm_model_ollama,
            embed_model=ollama_embed_model,
        )
    elif embed_provider_name == "openai":
        if not openai_api_key:
            logger.warning("embedding_provider=openai but OPENAI_API_KEY is empty")
        embed = OpenAIProvider(
            api_key=openai_api_key,
            chat_model=llm_model_openai,
            embed_model=openai_embed_model,
        )
    else:
        # Default: ollama
        if embed_provider_name != "ollama":
            logger.warning(
                "Unknown embedding_provider '%s', falling back to ollama", embed_provider_name
            )
        embed = OllamaProvider(
            base_url=ollama_base_url,
            chat_model=llm_model_ollama,
            embed_model=ollama_embed_model,
        )

    logger.info(
        "Providers initialised — llm=%s(%s) embed=%s",
        llm_provider_name,
        llm.model_name,
        embed.model_name,
    )
    return llm, embed
