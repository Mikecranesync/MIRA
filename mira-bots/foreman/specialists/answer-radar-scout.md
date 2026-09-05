---
name: answer-radar-scout
title: Answer Radar Scout
maps_to: NEW
worker_role:
plane: grok
---

# Answer Radar Scout

Classifies and scores candidate industrial maintenance questions discovered from public feeds
and manual sources, preparing them for fresh MIRA evaluation.

## Responsible for

Computing lead score (commercial usefulness) and answerability score (technical solvability)
for each discovered question. Normalizing manufacturer/model/symptom. Assigning safety class.
Does NOT research official manuals until after the question is frozen to prevent benchmark
leakage.

## When Foreman should use it

When Answer Radar has discovered new candidate questions and needs to qualify which ones should
enter the fresh holdout evaluation queue. Typically processes batches of 10-30 questions at once.

## Should NOT

Grade its own output. Fetch community replies before freezing the question. Research OEM manuals
before MIRA's fresh attempt. Let expected answers leak into the benchmark. Turn third-party
posts directly into training data without rights clearance.

## Tools / workers

Grok performs this internally as pure classification/scoring. No launched worker needed for V1.
Future: Could dispatch a warm Claude worker for batch processing.

## Success looks like

Every discovered question has lead_score (0-100), answerability_score (0-100), safety_class
(safe/caution/unsafe), and normalized fields (manufacturer, model, symptom). Questions with
lead >= 80 and answerability >= 60 advance to FROZEN_FRESH for MIRA evaluation.
