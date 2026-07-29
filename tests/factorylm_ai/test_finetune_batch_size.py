"""batch_size passthrough on the canonical fine-tune request.

Added 2026-07-27: Together's server-side default batch size resolved to zero for
Qwen/Qwen3.5-9B ("HTTP 400: batch size is zero"), so the request schema must be
able to carry an explicit batch_size. Omitting it must stay byte-identical to
the pre-change canonical request (hash stability for existing authorizations).
"""

from factorylm_ai.finetune import canonical_finetune_request


def _base_kwargs() -> dict:
    return dict(
        training_file_id="file-abc",
        model="Qwen/Qwen3.5-9B",
        suffix="technician-v0",
        n_epochs=3,
        seed=42,
        train_on_inputs=False,
        packing=False,
        learning_rate=2e-5,
        lora_r=16,
        lora_alpha=32,
        lora_dropout=0.05,
    )


def test_batch_size_absent_keeps_payload_and_hash_shape() -> None:
    req = canonical_finetune_request(**_base_kwargs())
    assert "batch_size" not in req.create_payload()
    assert req.request["batch_size"] is None


def test_batch_size_integer_flows_to_payload_and_hash() -> None:
    plain = canonical_finetune_request(**_base_kwargs())
    sized = canonical_finetune_request(**_base_kwargs(), batch_size=8)
    assert sized.create_payload()["batch_size"] == 8
    assert sized.request_hash != plain.request_hash


def test_batch_size_max_string_supported() -> None:
    req = canonical_finetune_request(**_base_kwargs(), batch_size="max")
    assert req.create_payload()["batch_size"] == "max"
