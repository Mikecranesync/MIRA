---
title: Intent Guard False Positives
type: gotcha
updated: 2026-04-08
tags: [guardrails, inference, bots]
---

# Intent Guard False Positives

## The Problem

`classify_intent()` in `mira-bots/shared/guardrails.py` catches real maintenance questions as greetings or off-topic. This means legitimate user queries get canned responses instead of real inference.

## Impact

Reddit benchmark: 15/16 questions hit intent guard canned responses, not real inference.

## Workaround

Test with realistic maintenance phrasing, not short generic questions. The classifier is more likely to pass longer, domain-specific queries.

## Root Cause

The intent classifier is too aggressive with short or ambiguous inputs. Needs tuning of the classification thresholds or examples.

## Status

Known issue. Not yet fixed — flagged for bot quality tuning sprint.
