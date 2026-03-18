# Test Assets

This directory contains synthetic industrial nameplate images for the MIRA Telegram vision test harness.

## Images

All images are generated programmatically using Pillow. No real equipment photos are included.

| File | Description | Adversarial |
|------|-------------|-------------|
| `ab_micro820_tag.jpg` | Allen-Bradley Micro820 PLC nameplate | No |
| `gs10_vfd_tag.jpg` | AutomationDirect GS10 VFD nameplate | No |
| `generic_cabinet_tag.jpg` | Panel ID MCC-003 electrical cabinet tag | No |
| `bad_glare_tag.jpg` | Micro820 tag with glare overlay on catalog number | Yes |
| `cropped_tight_tag.jpg` | GS10 tag cropped to top third | Yes |

## Regenerating

Run from `mira-bots/telegram_test_runner/`:

```bash
python _generate_fixtures.py
```

Requires: `pip install Pillow`
