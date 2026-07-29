# PrintSense Production Activation — Together/MiniMax

**Status:** activation implementation  
**ADR:** ADR-0031 PR 8  
**Release:** v3.212.0

## Production profile

The production Telegram and Slack PrintSense paths are enforced through
`docker-compose.printsense-production.yml`, applied after `docker-compose.saas.yml`:

```text
PRINT_VISION_PROVIDER=together
PRINT_VISION_MODEL=MiniMaxAI/MiniMax-M3
TOGETHERAI_VISION_MODEL=MiniMaxAI/MiniMax-M3
PRINT_PROVIDER_POLICY=strict
PRINT_ENFORCE_APPROVED_MODELS=1
FACTORYLM_NETWORK_MODE=enabled
INFERENCE_BACKEND=cloud
OCR_REQUIRE_TESSERACT=1
OCR_EXPECT_TESSERACT=1
```

The overlay deliberately uses activation-specific optional rollback variables:

```text
PRINTSENSE_PROD_PROVIDER
PRINTSENSE_PROD_MODEL
PRINTSENSE_PROD_POLICY
```

Legacy `PRINT_VISION_*` values in Doppler cannot silently override the production
activation profile. Secrets remain runtime-only in Doppler.

## Deployment

`.github/workflows/printsense-production-activation.yml` runs:

1. on the activation merge,
2. after every successful `Deploy to VPS` run, and
3. by manual dispatch.

The post-deploy enforcement is temporary but intentional: the base SaaS compose
still contains legacy OpenAI defaults. Until that deeper cleanup lands, a normal
full deploy would otherwise recreate the bots with the old provider profile.

The workflow shares the `deploy-vps` concurrency group, verifies the source PR's
Staging Gate, rebuilds only Telegram and Slack, applies the production overlay,
and then proves:

- both containers are healthy,
- Together is configured,
- the exact model is `MiniMaxAI/MiniMax-M3`,
- provider policy is strict,
- approved-model enforcement is enabled,
- Tesseract is required and available,
- the Together key is present without printing it,
- both containers pass the PrintSense readiness command, and
- a live known-token vision canary reads `MIRA CANARY 7` from inside the production Telegram container.

## Rollback

Rollback does not remove the registry, OCR enforcement, provenance, or typed
failure behavior. Set an approved pair in Doppler `factorylm/prd`, then re-run
`PrintSense Production Activation`:

```text
PRINTSENSE_PROD_PROVIDER=openai
PRINTSENSE_PROD_MODEL=gpt-5.5
```

or, only when configured and funded:

```text
PRINTSENSE_PROD_PROVIDER=anthropic
PRINTSENSE_PROD_MODEL=claude-opus-4-8
```

The approved-provider policy remains fail-closed.

## Follow-up cleanup

After production is confirmed stable:

1. move the Together/MiniMax defaults into the canonical base production compose,
2. remove the legacy provider/model duplication from the bot router,
3. make the scheduled canary and typed interpreter resolve the same model source,
4. expose PrintSense-specific degraded status without taking down general MIRA chat, and
5. retire this temporary post-deploy enforcement workflow once the base deployment path is canonical.
