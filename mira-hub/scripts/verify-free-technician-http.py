"""Synthetic signup/sign-in proof against an isolated loopback MIRA instance only."""
import argparse
import http.cookiejar
import json
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener
from uuid import uuid4

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', required=True)
parser.add_argument('--output', type=Path)
args = parser.parse_args()
target = urlsplit(args.base)
if target.scheme != 'http' or target.hostname != '127.0.0.1':
    raise SystemExit('Refusing account creation outside the isolated loopback rehearsal')
base = args.base.rstrip('/')
opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(path, payload=None, form=False):
    headers = {}
    data = None
    if payload is not None:
        headers['Content-Type'] = 'application/x-www-form-urlencoded' if form else 'application/json'
        data = urlencode(payload).encode() if form else json.dumps(payload).encode()
    with opener.open(Request(base + path, data=data, headers=headers), timeout=25) as response:
        return response.status, json.load(response)


_, policy = request('/api/public/signup-policy/')
assert policy == {'version': 1, 'kind': 'free_technician', 'requiresApproval': False, 'trialDays': None}, policy
address = f'synthetic-free-{uuid4()}@example.test'
password = str(uuid4())
registered, account = request('/api/auth/register/', {'email': address, 'password': password, 'name': 'Synthetic free-access verification'})
assert registered == 201
_, csrf = request('/api/auth/csrf/')
_, signin = request('/api/auth/callback/credentials/', {
    'email': address, 'password': password, 'csrfToken': csrf['csrfToken'],
    'callbackUrl': base + '/feed/', 'json': 'true',
}, form=True)
assert 'error=' not in signin.get('url', ''), 'Credential sign-in failed'
_, session = request('/api/auth/session/')
user = session.get('user', {})
assert user.get('id') == account['userId'] and user.get('tenantId') == account['tenantId']
assert user.get('status') == 'approved' and user.get('trialExpiresAt') is None
assert user.get('role') == 'owner' and user.get('status') != 'admin'
report = {
    'scope': 'Local synthetic registration and real NextAuth cookie session; not a live customer acceptance run',
    'policy': policy, 'registration_status': registered, 'password_signin': 'passed',
    'account_status': user['status'], 'trial_expiry': user.get('trialExpiresAt'),
    'tenant_role': user['role'], 'matching_user_and_workspace': True,
    'public_account_created': False, 'email_sent': False, 'payment_or_plant_action': False,
}
if args.output:
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
