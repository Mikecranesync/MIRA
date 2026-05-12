from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class FeedItem(BaseModel):
    title: str
    url: str
    summary: str = ""
    source: str  # e.g. "plantengineering.com"
    published_at: datetime | None = None
    category: Literal["industrial", "ai_news"] = "industrial"


class ContentBrief(BaseModel):
    stories: list[FeedItem]  # top 3 selected stories
    keyword: str  # primary SEO keyword e.g. "VFD fault codes 2026"
    angle: Literal["problem-aware", "product-aware"]
    post_type: str  # e.g. "pain_story", "how_to", "case_study"


class BlogSection(BaseModel):
    type: Literal["paragraph", "heading", "list", "callout", "quote", "image", "svg"]
    text: str | None = None
    items: list[str] | None = None
    ordered: bool | None = None
    variant: Literal["tip", "warning", "info"] | None = None
    attribution: str | None = None
    url: str | None = None  # image: photo URL
    alt: str | None = None  # image + svg
    caption: str | None = None  # image
    svg_content: str | None = None  # svg: pre-validated SVG markup


class BlogPost(BaseModel):
    slug: str
    title: str
    description: str
    date: str  # YYYY-MM-DD
    author: str = "FactoryLM Engineering"
    category: str = "Guides"
    readingTime: str = "5 min read"
    heroEmoji: str = "F"
    sections: list[BlogSection]
    relatedPosts: list[str] = Field(default_factory=list)
    relatedFaultCodes: list[str] = Field(default_factory=list)


class LinkedInPost(BaseModel):
    text: str
    hashtags: list[str] = Field(default_factory=list)
    char_count: int = 0

    def model_post_init(self, __context: object) -> None:
        if not self.char_count:
            self.char_count = len(self.text)


class MediumExcerpt(BaseModel):
    title: str
    content: str  # 300-400 words
    canonical_url: str  # https://factorylm.com/blog/{slug}
    tags: list[str] = Field(default_factory=list)


class Infographic(BaseModel):
    svg_content: str
    alt: str


class MetricsSnapshot(BaseModel):
    gsc_top_query: str = ""
    gsc_clicks_7d: int = 0
    gsc_impressions_7d: int = 0
    gsc_top_position: float = 0.0
    domain_authority: float = 0.0
    fetched_at: datetime | None = None


class DraftPayload(BaseModel):
    blog_post: BlogPost
    linkedin_post: LinkedInPost
    medium_excerpt: MediumExcerpt
    infographic: Infographic
    feed_sources: list[FeedItem]
    brief: ContentBrief
    metrics_snapshot: MetricsSnapshot = Field(default_factory=MetricsSnapshot)
