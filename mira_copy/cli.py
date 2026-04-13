"""CLI entry point for mira-copy."""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from .generate import generate, load_base_context

logger = logging.getLogger("mira-copy")

CONTENT_TYPES = ["ad-copy", "drip-email", "lead-magnet", "landing-page"]

DEFAULT_VARIANTS = {
    "ad-copy": ["google_search", "linkedin", "facebook", "reddit"],
    "drip-email": ["activation", "feature", "social-proof", "nudge", "conversion"],
    "lead-magnet": ["checklist", "guide", "template", "playbook"],
    "landing-page": ["hero", "features", "social-proof", "cta"],
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mira-copy",
        description="Generate marketing copy for FactoryLM via Claude API.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # Per-type commands
    for ct in CONTENT_TYPES:
        p = sub.add_parser(ct, help=f"Generate {ct} content")
        p.add_argument("--audience", "-a", required=True, help="Audience key from base-context.yaml")
        p.add_argument("--variant", "-v", help="Content variant (platform, email type, etc.)")
        p.add_argument("--all", action="store_true", help="Generate all variants for this type")
        p.add_argument("--dry-run", action="store_true", help="Show prompts without calling Claude")

    # Batch command
    batch = sub.add_parser("batch", help="Generate all content types for an audience")
    batch.add_argument("--audience", "-a", required=True, help="Audience key")
    batch.add_argument("--dry-run", action="store_true", help="Show prompts without calling Claude")

    # List command
    sub.add_parser("list", help="List available audiences and variants")

    return parser


async def run_generate(content_type: str, audience: str, variant: str, dry_run: bool) -> None:
    """Run a single generation and print result."""
    result = await generate(content_type, audience, variant, dry_run=dry_run)
    if result.usage:
        logger.info(
            "Tokens: input=%d output=%d",
            result.usage.get("input_tokens", 0),
            result.usage.get("output_tokens", 0),
        )
    print(f"\n{'='*60}")
    print(f"{content_type} / {audience} / {variant}")
    print(f"{'='*60}")
    print(result.rendered_md[:500] + ("..." if len(result.rendered_md) > 500 else ""))
    if result.rendered_html:
        print("\n[HTML output also written]")


async def run_batch(audience: str, dry_run: bool) -> None:
    """Generate all content types + variants for an audience."""
    for ct in CONTENT_TYPES:
        for variant in DEFAULT_VARIANTS[ct]:
            await run_generate(ct, audience, variant, dry_run)


def cmd_list() -> None:
    """Print available audiences and variants."""
    base = load_base_context()
    print("\nAudiences:")
    for key, aud in base.get("audiences", {}).items():
        print(f"  {key:25s} {aud.get('title', '')}")

    print("\nContent types & variants:")
    for ct, variants in DEFAULT_VARIANTS.items():
        print(f"  {ct:20s} {', '.join(variants)}")


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )

    parser = build_parser()
    args = parser.parse_args()

    if args.command == "list":
        cmd_list()
        return

    if args.command == "batch":
        asyncio.run(run_batch(args.audience, args.dry_run))
        return

    content_type = args.command

    if args.all:
        variants = DEFAULT_VARIANTS.get(content_type, [])
        if not variants:
            print(f"No default variants for {content_type}", file=sys.stderr)
            sys.exit(1)
        for v in variants:
            asyncio.run(run_generate(content_type, args.audience, v, args.dry_run))
    else:
        if not args.variant:
            print(
                f"Specify --variant or --all. Options: {', '.join(DEFAULT_VARIANTS.get(content_type, []))}",
                file=sys.stderr,
            )
            sys.exit(1)
        asyncio.run(run_generate(content_type, args.audience, args.variant, args.dry_run))
