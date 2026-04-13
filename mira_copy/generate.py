"""Core generator — loads prompts, calls Claude, renders output."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from . import client

logger = logging.getLogger("mira-copy")

PROMPTS_DIR = Path(__file__).parent / "prompts"
TEMPLATES_DIR = Path(__file__).parent / "templates"
OUTPUTS_DIR = Path(__file__).parent / "outputs"


@dataclass
class GeneratedContent:
    content_type: str
    audience: str
    variant: str
    raw_json: dict = field(default_factory=dict)
    rendered_md: str = ""
    rendered_html: str = ""
    usage: dict = field(default_factory=dict)


def load_base_context() -> dict:
    """Load product knowledge from base-context.yaml."""
    path = PROMPTS_DIR / "base-context.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


def load_prompt(content_type: str) -> dict:
    """Load the per-type prompt YAML (system prompt + user template + output schema)."""
    path = PROMPTS_DIR / f"{content_type}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"No prompt file: {path}")
    with open(path) as f:
        return yaml.safe_load(f)


def build_system_prompt(base: dict, prompt_config: dict) -> str:
    """Combine base context with per-type system prompt."""
    product = base["product"]
    tone = base["tone"]
    constraints = base["constraints"]

    context_block = (
        f"Product: {product['name']} — {product['tagline']}\n"
        f"URL: {product['url']}\n"
        f"Pricing: {'. '.join(f'{k}: {v}' for k, v in product['pricing'].items())}.\n"
        f"\nValue propositions:\n"
        + "\n".join(f"- {v}" for v in product["value_props"])
        + "\n\nLive features:\n"
        + "\n".join(f"- {f}" for f in product["features_live"])
        + "\n\nNOT built yet (never claim these):\n"
        + "\n".join(f"- {f}" for f in product["features_not_built"])
        + f"\n\nTone: {tone['voice']}\n"
        f"Style: {tone['style']}\n"
        f"Proof style: {tone['proof']}\n"
        f"Words to avoid: {', '.join(tone['avoid'])}\n"
        f"\nConstraints:\n"
        + "\n".join(f"- {c}" for c in constraints)
    )

    type_system = prompt_config.get("system_prompt", "")
    return f"{context_block}\n\n---\n\n{type_system}"


def build_user_prompt(
    prompt_config: dict, base: dict, audience: str, variant: str
) -> str:
    """Substitute audience/variant into the user prompt template."""
    audiences = base.get("audiences", {})
    aud = audiences.get(audience, {})

    template = prompt_config.get("user_prompt", "")
    return (
        template
        .replace("{{audience_key}}", audience)
        .replace("{{audience_title}}", aud.get("title", audience))
        .replace("{{audience_pain}}", aud.get("pain", ""))
        .replace("{{audience_trigger}}", aud.get("trigger", ""))
        .replace("{{audience_equipment}}", aud.get("equipment", ""))
        .replace("{{variant}}", variant)
    )


def render_to_markdown(content_type: str, data: dict) -> str:
    """Render structured JSON output to readable markdown."""
    lines = [f"# {content_type.replace('-', ' ').title()}\n"]

    if content_type == "ad-copy":
        for i, ad in enumerate(data.get("ads", [data]), 1):
            lines.append(f"## Ad {i}\n")
            lines.append(f"**Headline:** {ad.get('headline', '')}")
            lines.append(f"**Description:** {ad.get('description', '')}")
            lines.append(f"**CTA:** {ad.get('cta', '')}")
            if ad.get("display_url"):
                lines.append(f"**Display URL:** {ad.get('display_url', '')}")
            if ad.get("char_counts"):
                lines.append(f"**Char counts:** {ad['char_counts']}")
            lines.append("")

    elif content_type == "drip-email":
        lines.append(f"**Subject:** {data.get('subject', '')}")
        lines.append(f"**Preview:** {data.get('preview_text', '')}")
        lines.append(f"**CTA:** {data.get('cta_text', '')}")
        lines.append("\n---\n")
        lines.append(data.get("body_html", data.get("body", "")))

    elif content_type == "lead-magnet":
        lines.append(f"**Title:** {data.get('title', '')}")
        lines.append(f"**Subtitle:** {data.get('subtitle', '')}\n")
        for section in data.get("sections", []):
            lines.append(f"## {section.get('heading', '')}\n")
            lines.append(section.get("body", ""))
            for item in section.get("checklist_items", []):
                lines.append(f"- [ ] {item}")
            lines.append("")

    elif content_type == "landing-page":
        lines.append(f"**Section:** {data.get('section', '')}")
        lines.append(f"**Headline:** {data.get('headline', '')}")
        lines.append(f"**Subhead:** {data.get('subhead', '')}\n")
        lines.append(data.get("body", ""))
        if data.get("cta_text"):
            lines.append(f"\n**CTA:** {data['cta_text']}")
        if data.get("chips"):
            lines.append(f"**Chips:** {', '.join(data['chips'])}")

    else:
        lines.append(yaml.dump(data, default_flow_style=False))

    return "\n".join(lines)


def render_email_html(data: dict) -> str:
    """Render drip-email JSON into the email HTML template."""
    template_path = TEMPLATES_DIR / "email.html"
    if not template_path.exists():
        return ""
    html = template_path.read_text()
    replacements = {
        "{{SUBJECT}}": data.get("subject", ""),
        "{{PREVIEW_TEXT}}": data.get("preview_text", ""),
        "{{HEADLINE}}": data.get("headline", ""),
        "{{BODY_HTML}}": data.get("body_html", data.get("body", "")),
        "{{CTA_TEXT}}": data.get("cta_text", "Open FactoryLM"),
        "{{CTA_URL}}": data.get("cta_url", "{{CMMS_URL}}"),
    }
    for key, val in replacements.items():
        html = html.replace(key, val)
    return html


def render_lead_magnet_html(data: dict) -> str:
    """Render lead-magnet JSON into the lead-magnet HTML template."""
    template_path = TEMPLATES_DIR / "lead-magnet.html"
    if not template_path.exists():
        return ""
    html = template_path.read_text()

    sections_html = ""
    for section in data.get("sections", []):
        sections_html += f'<h2 style="color:#e4e0d8;font-size:20px;margin:32px 0 12px 0;">{section.get("heading", "")}</h2>\n'
        sections_html += f'<p style="color:#b0aca2;font-size:15px;line-height:1.6;">{section.get("body", "")}</p>\n'
        for item in section.get("checklist_items", []):
            sections_html += f'<p style="color:#e4e0d8;font-size:14px;padding:4px 0;">&#9744; {item}</p>\n'

    html = html.replace("{{TITLE}}", data.get("title", ""))
    html = html.replace("{{SUBTITLE}}", data.get("subtitle", ""))
    html = html.replace("{{SECTIONS}}", sections_html)
    return html


def write_output(
    content_type: str, audience: str, variant: str, md: str, html: str = ""
) -> Path:
    """Write generated content to outputs/."""
    out_dir = OUTPUTS_DIR / content_type / audience
    out_dir.mkdir(parents=True, exist_ok=True)

    md_path = out_dir / f"{variant}.md"
    md_path.write_text(md, encoding="utf-8")
    logger.info("Wrote %s", md_path)

    if html:
        html_path = out_dir / f"{variant}.html"
        html_path.write_text(html, encoding="utf-8")
        logger.info("Wrote %s", html_path)

    return md_path


async def generate(
    content_type: str,
    audience: str,
    variant: str,
    *,
    dry_run: bool = False,
) -> GeneratedContent:
    """Generate marketing content via Claude.

    Steps:
    1. Load base-context.yaml + prompts/{content_type}.yaml
    2. Build system prompt (product context + type-specific instructions)
    3. Build user prompt (audience + variant substitution)
    4. POST to Claude API (unless dry_run)
    5. Parse JSON response
    6. Render to markdown + HTML (if applicable)
    7. Write to outputs/
    """
    base = load_base_context()
    prompt_config = load_prompt(content_type)

    system_prompt = build_system_prompt(base, prompt_config)
    user_prompt = build_user_prompt(prompt_config, base, audience, variant)

    result = GeneratedContent(
        content_type=content_type, audience=audience, variant=variant
    )

    if dry_run:
        logger.info("[DRY RUN] System prompt: %d chars", len(system_prompt))
        logger.info("[DRY RUN] User prompt: %d chars", len(user_prompt))
        logger.info("[DRY RUN] Would call Claude API — skipping")
        result.rendered_md = f"# DRY RUN\n\n## System Prompt\n\n{system_prompt}\n\n## User Prompt\n\n{user_prompt}"
        write_output(content_type, audience, variant, result.rendered_md)
        return result

    raw_text, usage = await client.complete(system_prompt, user_prompt)
    result.usage = usage

    try:
        data = client.extract_json(raw_text)
    except Exception:
        logger.warning("Could not parse JSON — saving raw text")
        data = {"raw": raw_text}

    result.raw_json = data
    result.rendered_md = render_to_markdown(content_type, data)

    if content_type == "drip-email":
        result.rendered_html = render_email_html(data)
    elif content_type == "lead-magnet":
        result.rendered_html = render_lead_magnet_html(data)

    write_output(content_type, audience, variant, result.rendered_md, result.rendered_html)
    return result
