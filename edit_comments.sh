#!/bin/bash
# Edit round-1 triage comments with corrected analysis

cd /Users/bravonode/Mira || exit

# Comment ID mapping
declare -A comments=(
  [4819]="6481589033"
  [4818]="6481589740"
  [4814]="6481590443"
  [4811]="6481591176"
  [4810]="6481591917"
  [4807]="6481592484"
  [4806]="6481593129"
  [4805]="6481593740"
  [4815]="6481594445"
  [4282]="6481595092"
  [4281]="6481595978"
  [4279]="6481596687"
  [4277]="6481597456"
  [4276]="6481598250"
  [4272]="6481598884"
  [4259]="6481599658"
  [4817]="6481599963"
  [4813]="6481600282"
  [4283]="6481600622"
  [4278]="6481600991"
  [4260]="6481601355"
  [4267]="6481601677"
  [4280]="6481601981"
  [4275]="6481602333"
  [4266]="6481602636"
  [4269]="6481602957"
)

# MERGE comments
for pr in 4814 4813 4811 4810 4259; do
  comment_id="${comments[$pr]}"
  case $pr in
    4814) body="merge – sqlalchemy 2.0→2.1 minor bump, all checks pass. CI: pass=43 fail=0 pending=2";;
    4813) body="merge – fastapi 0.136→0.162 minor bump (0.x), all checks pass. CI: pass=43 fail=0 pending=2";;
    4811) body="merge – starlette 1.3.1→1.10.0 minor bump, all checks pass. CI: pass=43 fail=0 pending=2";;
    4810) body="merge – sqlalchemy 2.0→2.1 minor bump, all checks pass. CI: pass=43 fail=0 pending=2";;
    4259) body="merge – uvicorn 0.48→0.54 minor bump (0.x), all checks pass. CI: pass=43 fail=0 pending=2";;
  esac

  echo "Patching PR #$pr comment $comment_id with: $body"
  gh api -X PATCH repos/Mikecranesync/mira/issues/comments/$comment_id -f body="$body" > /dev/null 2>&1 &
done

wait
echo "MERGE comments patched"

# DEFER (failures) comments
for pr in 4819 4818 4817 4812 4806 4282 4281 4279 4277; do
  comment_id="${comments[$pr]}"
  case $pr in
    4819) body="defer – major actions/download-artifact 4.3→8.0 GitHub action upgrade. CI: pass=42 fail=1 pending=2 (1 failure)";;
    4818) body="defer – major actions/setup-node 4→7 GitHub action upgrade. CI: pass=47 fail=3 pending=2 (3 failures)";;
    4817) body="defer – major anthropic 0.116→2.2 upgrade (fail=2). Covered by issue #4904. CI: pass=42 fail=2 pending=2";;
    4812) body="defer – sqlalchemy 2.0→2.1 minor bump, but has 2 CI failures. CI: pass=42 fail=2 pending=2";;
    4806) body="defer – major android-actions/setup-android 3.2→4.0 GitHub action. CI: pass=42 fail=1 pending=2 (1 failure)";;
    4282) body="defer – @neondatabase/serverless 1.1→1.2 minor bump, but has 3 CI failures. CI: pass=40 fail=3 pending=2";;
    4281) body="defer – hono 4.12→4.13 minor bump, but has 3 CI failures. CI: pass=40 fail=3 pending=2";;
    4279) body="defer – jose 6.2.3→6.2.12 patch bump, but has 3 CI failures. CI: pass=40 fail=3 pending=2";;
    4277) body="defer – @types/bun 1.3→1.4 minor bump, but has 3 CI failures. CI: pass=40 fail=3 pending=2";;
  esac

  echo "Patching PR #$pr comment $comment_id"
  gh api -X PATCH repos/Mikecranesync/mira/issues/comments/$comment_id -f body="$body" > /dev/null 2>&1 &
done

wait
echo "DEFER (failures) comments patched"

# DEFER (major version) comments
for pr in 4815 4807 4805 4276 4280 4275 4272; do
  comment_id="${comments[$pr]}"
  case $pr in
    4815) body="defer – major openai 1.66→3.37 upgrade (requires API audit). CI: pass=43 fail=0 pending=2. Create risk issue #4900.";;
    4807) body="defer – major langfuse 2.50→5.0 upgrade (requires API audit). CI: pass=44 fail=0 pending=2. Create risk issue #4901.";;
    4805) body="defer – major fastmcp 3.3→4.1 upgrade (requires API audit). CI: pass=43 fail=0 pending=2. Create risk issue #4902.";;
    4276) body="defer – major stripe 22.2→23.0 upgrade + 3 CI failures. CI: pass=40 fail=3 pending=2. Create risk issue #4903.";;
    4280) body="defer – major anthropic 0.116→1.11 upgrade (requires API audit). CI: pass=44 fail=0 pending=2. Covered by #4904.";;
    4275) body="defer – major openai 1.66→3.23 upgrade (requires API audit). CI: pass=44 fail=0 pending=2. Share risk with #4815.";;
    4272) body="defer – major uvicorn 0.48→0.54 (0.x semantics, requires audit). CI: pass=43 fail=0 pending=2. Create risk issue #4907.";;
  esac

  echo "Patching PR #$pr comment $comment_id"
  gh api -X PATCH repos/Mikecranesync/mira/issues/comments/$comment_id -f body="$body" > /dev/null 2>&1 &
done

wait
echo "DEFER (major) comments patched"

# CLOSE (duplicate) comments
for pr in 4260 4267 4269 4278 4283 4266; do
  comment_id="${comments[$pr]}"
  case $pr in
    4260) body="close – duplicate of #4814 (same sqlalchemy bump in mira-core/mira-ingest)";;
    4267) body="close – duplicate of #4810 (same sqlalchemy bump in mira-crawler)";;
    4269) body="close – duplicate of #4811 (same starlette bump in mira-mcp)";;
    4278) body="close – duplicate of #4812 (same sqlalchemy bump in mira-bots/telegram)";;
    4283) body="close – duplicate of #4807 (same langfuse bump in mira-bots/telegram)";;
    4266) body="close – duplicate of #4805 (same fastmcp bump in mira-mcp)";;
  esac

  echo "Patching PR #$pr comment $comment_id"
  gh api -X PATCH repos/Mikecranesync/mira/issues/comments/$comment_id -f body="$body" > /dev/null 2>&1 &
done

wait
echo "CLOSE comments patched"

echo "All 26 comment edits complete"
