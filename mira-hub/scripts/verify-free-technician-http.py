"""Actual synthetic email-token and revocation proof; isolated loopback MIRA only."""
import argparse
import http.cookiejar
import json
import os
import subprocess
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener
from uuid import uuid4

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', required=True)
parser.add_argument('--output', type=Path)
args = parser.parse_args()
target = urlsplit(args.base)
database = os.environ.get('TEST_DATABASE_URL', '')
db = urlsplit(database)
admin_database = os.environ.get('TEST_DATABASE_ADMIN_URL', '')
admin_db = urlsplit(admin_database)
if target.scheme != 'http' or target.hostname != '127.0.0.1' or db.hostname != '127.0.0.1' or not db.path.startswith('/factorylm_free_signup_test') or admin_db.hostname != '127.0.0.1' or admin_db.path != db.path or os.environ.get('MIRA_TEST_DB_CONFIRM') != 'DISPOSABLE':
    raise SystemExit('Refusing account tests outside the named disposable loopback rehearsal')
base = args.base.rstrip('/')
def browser():
    return build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
def sql(statement):
    return subprocess.check_output(['/opt/homebrew/opt/postgresql@16/bin/psql', admin_database, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', statement], text=True, stderr=subprocess.PIPE).strip().splitlines()[0]
def request(client, path, payload=None, form=False):
    headers, data = {}, None
    if payload is not None:
        headers['Content-Type'] = 'application/x-www-form-urlencoded' if form else 'application/json'
        data = urlencode(payload).encode() if form else json.dumps(payload).encode()
    try:
        with client.open(Request(base + path, data=data, headers=headers), timeout=30) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)
def signin(client, provider, values):
    _, csrf = request(client, '/api/auth/csrf/')
    return request(client, '/api/auth/callback/' + provider + '/', dict(values, csrfToken=csrf['csrfToken'], callbackUrl=base + '/feed/', json='true'), form=True)
def token_for(address, onboarding=False):
    token = str(uuid4())
    context = json.dumps({'intent':'technician','agreementVersion':policy['agreementVersion']}) if onboarding else None
    metadata = "'" + context + "'::jsonb" if context else 'NULL'
    sql("INSERT INTO hub_magic_tokens (token,email,expires_at,purpose,onboarding) VALUES ('" + token + "','" + address + "',NOW()+INTERVAL '15 minutes','" + ('onboarding' if onboarding else 'login') + "'," + metadata + ") RETURNING token")
    return token

client = browser()
_, policy = request(client, '/api/public/signup-policy/')
assert {key:policy.get(key) for key in ['version','kind','requiresApproval','trialDays']} == {'version':1,'kind':'free_technician','requiresApproval':False,'trialDays':None}
address = 'synthetic-free-' + str(uuid4()) + '@example.test'
blocked, _ = request(client, '/api/auth/register/', {'email':address,'password':str(uuid4())})
assert blocked == 403
assert sql("SELECT count(*) FROM hub_users WHERE email='" + address + "'") == '0'
unknown_login, _ = request(client, '/api/auth/magic-link/', {'email':address})
assert unknown_login == 409
_, bypass = signin(browser(), 'magic-token', {'token':token_for(address)})
assert 'error=' in bypass.get('url','')
assert sql("SELECT count(*) FROM hub_users WHERE email='" + address + "'") == '0'
token = token_for(address, onboarding=True)
_, login = signin(client, 'magic-token', {'token':token,'agreementVersion':policy['agreementVersion']})
assert 'error=' not in login.get('url','')
_, session = request(client, '/api/auth/session/')
user = session.get('user',{})
assert user.get('status') == 'approved' and user.get('trialExpiresAt') is None and user.get('role') == 'owner'
assert sql("SELECT tenant_id FROM hub_users WHERE email='" + address + "'") == user['tenantId']
_, replay = signin(browser(), 'magic-token', {'token':token,'agreementVersion':policy['agreementVersion']})
assert 'error=' in replay.get('url','')
seat_status, _ = request(client, '/api/team/', {'email':'synthetic-crew-' + str(uuid4()) + '@example.test','role':'technician'})
assert seat_status == 403

# A legacy unproven password fixture predates rollout. Claiming its email must
# remove that password and deny an already-issued real cookie without a logout.
legacy_email = 'synthetic-claim-' + str(uuid4()) + '@example.test'
legacy_password, tenant_id = str(uuid4()), str(uuid4())
sql('CREATE EXTENSION IF NOT EXISTS pgcrypto; SELECT 1')
sql("INSERT INTO hub_tenants (id,name) VALUES ('" + tenant_id + "','Synthetic identity claim') RETURNING id")
sql("INSERT INTO tenants (id,name,contact_email) VALUES ('" + tenant_id + "','Synthetic identity claim','" + legacy_email + "') RETURNING id")
sql("INSERT INTO hub_users (email,tenant_id,password_hash,status,trial_expires_at) VALUES ('" + legacy_email + "','" + tenant_id + "',crypt('" + legacy_password + "',gen_salt('bf')),'trial',NOW()+INTERVAL '30 days') RETURNING id")
stale = browser()
_, before = signin(stale,'credentials',{'email':legacy_email,'password':legacy_password})
assert 'error=' not in before.get('url','')
owner = browser()
_, claim = signin(owner,'magic-token',{'token':token_for(legacy_email)})
assert 'error=' not in claim.get('url','')
old_cookie_status, _ = request(stale, '/api/team/')
assert old_cookie_status == 401
_, old_password = signin(browser(),'credentials',{'email':legacy_email,'password':legacy_password})
assert 'error=' in old_password.get('url','')
owner_status, _ = request(owner, '/api/team/')
assert owner_status == 200

report = {'scope':'Actual local NextAuth email-token sessions and protected HTTP APIs; synthetic disposable fixtures only', 'policy':policy, 'unverified_password_registration':blocked, 'unknown_login_request':unknown_login, 'ordinary_token_onboarding_bypass':'rejected', 'canonical_agreement_bound_onboarding':'passed', 'verified_email_signin':'passed', 'account_status':user['status'], 'trial_expiry':None, 'tenant_role':user['role'], 'matching_user_and_workspace':True, 'token_replay':'rejected', 'free_team_invite':seat_status, 'old_password_after_verified_claim':'rejected', 'old_cookie_after_verified_claim':old_cookie_status, 'verified_owner_access':owner_status, 'email_delivery':'not tested; local tokens seeded internally', 'public_account_created':False, 'email_sent':False, 'payment_or_plant_action':False}
if args.output:
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
