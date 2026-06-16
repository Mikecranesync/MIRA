# Resend Domain Verification — factorylm.com

Required for morning pass-down email reports to deliver. Takes ~5 minutes.

## Steps

### 1. Log in to Resend
Go to [resend.com/domains](https://resend.com/domains) and sign in.

### 2. Add domain
Click **Add Domain** → enter `factorylm.com` → click **Add**.

### 3. Copy DNS records
Resend will show 3 DNS records to add:

| Type | Name | Value |
|------|------|-------|
| TXT | `resend._domainkey` | `p=...` (DKIM public key) |
| TXT | `@` or `factorylm.com` | `v=spf1 include:amazonses.com ~all` |
| MX | `bounce` | `feedback-smtp.us-east-1.amazonses.com` |

> Exact values differ per account — copy them directly from the Resend dashboard, don't use the examples above.

### 4. Add records at your registrar
Log in to your DNS provider (Namecheap, Cloudflare, GoDaddy, etc.) and add each record.

- **Cloudflare**: DNS → Add record → paste values, set proxy OFF (grey cloud)
- **Namecheap**: Domain List → Manage → Advanced DNS → Add New Record

### 5. Verify
Back in Resend dashboard, click **Verify** next to the domain. Propagation is usually <5 minutes on Cloudflare, up to 30 minutes on others.

## Test command (run after verification)

```bash
doppler run -p factorylm -c prd -- python3 - <<'EOF'
import asyncio, os
import httpx

async def test():
    key = os.getenv("RESEND_API_KEY", "")
    if not key:
        print("RESEND_API_KEY not set in Doppler")
        return
    async with httpx.AsyncClient() as client:
        r = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "from": "mira@factorylm.com",
                "to": ["harperhousebuyers@gmail.com"],
                "subject": "MIRA Resend test",
                "html": "<p>Domain verified. Morning reports will deliver.</p>",
            },
        )
        print(r.status_code, r.text)

asyncio.run(test())
EOF
```

## Doppler secret
`RESEND_API_KEY` must be set in Doppler `factorylm/prd`. Get the key from [resend.com/api-keys](https://resend.com/api-keys).

`MORNING_REPORT_EMAIL` defaults to `harperhousebuyers@gmail.com` — override in Doppler if needed.
