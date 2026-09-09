# Deploying Streakr's backend to AWS Lambda

Firebase Cloud Functions requires the paid Blaze plan, so Streakr's backend
logic runs on AWS Lambda instead. Firestore and Firebase Auth are unaffected —
those stay on Firebase's free Spark plan.

**This deployment is already live.** The commands below are the exact ones
used, kept here so the whole thing is reproducible from scratch (or in a
different AWS account).

## What's deployed

| Function | Trigger | Source |
|---|---|---|
| `streakr-poll-pending-calls` | EventBridge, `rate(1 minute)` | `src/handlers/pollPendingCalls.ts` |
| `streakr-sentiment` | Function URL (public GET) | `src/handlers/sentiment.ts` |
| `streakr-render-result-card` | Function URL (public GET) | `src/handlers/renderResultCard.ts` |
| `streakr-pre-lock-nudge` | Function URL (GET + shared secret) | `src/handlers/preLockNudge.ts` |
| `streakr-faucet` | Function URL (public POST) | `src/handlers/faucet.ts` |

Region: `us-east-1`. Runtime: `nodejs20.x`. Architecture: `x86_64`.

### Live Function URLs

```
sentiment          https://5iozyfdraiwmjp4zvcrx66rnay0bvxzn.lambda-url.us-east-1.on.aws/
render-result-card https://x2x3bzwhl6mvdhehpggly4xvtm0ipquu.lambda-url.us-east-1.on.aws/
pre-lock-nudge     https://5utbif3ygxyzkzxqr5oia5icnq0etbmd.lambda-url.us-east-1.on.aws/
```

The first two go in `app/.env` as `EXPO_PUBLIC_SENTIMENT_URL` and
`EXPO_PUBLIC_RESULT_CARD_URL`. The third goes in the n8n workflow's
`STREAKR_PRE_LOCK_NUDGE_URL`.

Note each Function URL is its own standalone endpoint — there's no shared
base URL with `/sentiment` style path suffixes the way Cloud Functions
groups multiple functions. That's why the app takes two separate env vars
rather than one base URL.

---

## Reproducing the deploy

### 0 · Prerequisites

```bash
aws configure          # or `aws sso login` — needs Lambda + IAM + EventBridge permissions
cd backend/lambda
npm install
npm run test           # 10 unit tests on the streak/XP/badge logic
npm run package        # bundles each handler + zips into deploy/*.zip
```

You also need a **Firebase service account key**, since `firebase-admin`
can't use ambient GCP credentials from outside GCP:

1. Firebase Console → ⚙️ **Project settings** → **Service accounts**
2. **Generate new private key** → downloads a JSON file
3. Save it as `backend/lambda/streakr-hackathon-firebase-adminsdk.json`
   (already gitignored — treat it like a password)

### 1 · IAM execution role

None of these functions touch other AWS services, so the basic execution
role (CloudWatch Logs only) is enough.

```bash
cat > /tmp/lambda-trust-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

aws iam create-role \
  --role-name streakr-lambda-exec \
  --assume-role-policy-document file:///tmp/lambda-trust-policy.json \
  --description "Execution role for Streakr Lambda functions (CloudWatch Logs only)"

aws iam attach-role-policy \
  --role-name streakr-lambda-exec \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

Wait ~10s after this for the role to propagate before creating functions,
otherwise Lambda rejects it with an `InvalidParameterValueException`.

### 2 · Create the four functions

```bash
ROLE_ARN="arn:aws:iam::<YOUR_ACCOUNT_ID>:role/streakr-lambda-exec"

# The poller does more work per run, so it gets a longer timeout + more memory.
aws lambda create-function \
  --function-name streakr-poll-pending-calls \
  --runtime nodejs20.x --role "$ROLE_ARN" --handler index.handler \
  --zip-file fileb://deploy/pollPendingCalls.zip \
  --timeout 120 --memory-size 256

aws lambda create-function \
  --function-name streakr-sentiment \
  --runtime nodejs20.x --role "$ROLE_ARN" --handler index.handler \
  --zip-file fileb://deploy/sentiment.zip \
  --timeout 30 --memory-size 128

aws lambda create-function \
  --function-name streakr-render-result-card \
  --runtime nodejs20.x --role "$ROLE_ARN" --handler index.handler \
  --zip-file fileb://deploy/renderResultCard.zip \
  --timeout 30 --memory-size 128

aws lambda create-function \
  --function-name streakr-pre-lock-nudge \
  --runtime nodejs20.x --role "$ROLE_ARN" --handler index.handler \
  --zip-file fileb://deploy/preLockNudge.zip \
  --timeout 30 --memory-size 128

# Wait for all four to leave the "Creating" state.
for fn in streakr-poll-pending-calls streakr-sentiment \
          streakr-render-result-card streakr-pre-lock-nudge; do
  aws lambda wait function-active --function-name "$fn"
done
```

### 3 · Environment variables

The service account JSON has to go in as a single line. Generate the env
payload files with a script rather than shell-escaping a 2KB credential:

```bash
python3 <<'EOF'
import json
sa = json.dumps(json.load(open("streakr-hackathon-firebase-adminsdk.json")))
SECRET = "<generate one: openssl rand -hex 16>"

configs = {
    "poll":      {"NETWORK": "testnet", "FIREBASE_SERVICE_ACCOUNT_JSON": sa},
    "sentiment": {"NETWORK": "testnet", "FIREBASE_SERVICE_ACCOUNT_JSON": sa},
    "card":      {"NETWORK": "testnet", "FIREBASE_SERVICE_ACCOUNT_JSON": sa},
    "nudge":     {"NETWORK": "testnet", "FIREBASE_SERVICE_ACCOUNT_JSON": sa,
                  "N8N_SHARED_SECRET": SECRET},
}
for name, vars in configs.items():
    json.dump({"Variables": vars}, open(f"/tmp/env_{name}.json", "w"))
EOF

aws lambda update-function-configuration --function-name streakr-poll-pending-calls \
  --environment file:///tmp/env_poll.json
aws lambda wait function-updated --function-name streakr-poll-pending-calls

aws lambda update-function-configuration --function-name streakr-sentiment \
  --environment file:///tmp/env_sentiment.json
aws lambda wait function-updated --function-name streakr-sentiment

aws lambda update-function-configuration --function-name streakr-render-result-card \
  --environment file:///tmp/env_card.json
aws lambda wait function-updated --function-name streakr-render-result-card

aws lambda update-function-configuration --function-name streakr-pre-lock-nudge \
  --environment file:///tmp/env_nudge.json
aws lambda wait function-updated --function-name streakr-pre-lock-nudge
```

Two variables are deliberately **not** set in the live deployment:

| Variable | Function | Why omitted |
|---|---|---|
| `N8N_SETTLEMENT_WEBHOOK_URL` | poll-pending-calls | No n8n instance stood up yet. The handler logs a warning and continues — settlement still works, you just don't get a Telegram ping. |
| `LLM_API_KEY` | sentiment | Falls back to a template-generated sentence built from the same real momentum data. Set it to get LLM-phrased output. |

### 4 · EventBridge schedule (poller only)

This is what replaces Cloud Scheduler / Pub-Sub.

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

aws events put-rule \
  --name streakr-poll-every-minute \
  --schedule-expression "rate(1 minute)" \
  --state ENABLED \
  --description "Streakr: triggers streakr-poll-pending-calls every minute"

aws lambda add-permission \
  --function-name streakr-poll-pending-calls \
  --statement-id streakr-eventbridge-invoke \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn "arn:aws:events:us-east-1:${ACCOUNT_ID}:rule/streakr-poll-every-minute"

cat > /tmp/eventbridge-target.json <<EOF
[{ "Id": "streakr-poll-pending-calls-target",
   "Arn": "arn:aws:lambda:us-east-1:${ACCOUNT_ID}:function:streakr-poll-pending-calls" }]
EOF

aws events put-targets \
  --rule streakr-poll-every-minute \
  --targets file:///tmp/eventbridge-target.json
```

### 5 · Function URLs (the three HTTP functions)

```bash
for fn in streakr-sentiment streakr-render-result-card streakr-pre-lock-nudge; do
  aws lambda create-function-url-config \
    --function-name "$fn" \
    --auth-type NONE \
    --cors '{"AllowOrigins":["*"],"AllowMethods":["GET"]}'
done
```

> ### ⚠️ Public Function URLs need TWO permissions, not one
>
> This is the one real gotcha in this whole deploy. Setting `--auth-type NONE`
> is *not* sufficient on its own — the function's resource-based policy still
> has to grant public invoke. And **as of October 2025 AWS requires both
> `lambda:InvokeFunctionUrl` *and* `lambda:InvokeFunction`**, where it used to
> only need the first.
>
> Granting only `lambda:InvokeFunctionUrl` produces a `403 Forbidden` /
> `AccessDeniedException` that looks exactly like a propagation delay or a
> misconfigured auth type — the URL config reads back as perfectly correct,
> and a direct `aws lambda invoke` succeeds, which sends you looking in the
> wrong place. Encountered and diagnosed during this deploy.
>
> The console adds both statements for you automatically. Via CLI/CloudFormation
> you must add them yourself, as two separate calls:

```bash
for fn in streakr-sentiment streakr-render-result-card streakr-pre-lock-nudge; do
  # 1 of 2 — allow invoking via the URL
  aws lambda add-permission \
    --function-name "$fn" \
    --statement-id UrlPolicyInvokeURL \
    --action lambda:InvokeFunctionUrl \
    --principal "*" \
    --function-url-auth-type NONE

  # 2 of 2 — allow the underlying invoke, restricted to URL calls only
  aws lambda add-permission \
    --function-name "$fn" \
    --statement-id UrlPolicyInvokeFunction \
    --action lambda:InvokeFunction \
    --principal "*" \
    --invoked-via-function-url
done
```

The `--invoked-via-function-url` flag sets the `lambda:InvokedViaFunctionUrl`
condition, so this grant only applies to Function URL traffic — it does not
make the function publicly invokable through the regular Lambda API.

### 6 · Verify

```bash
# poller — expect {"checked":N,"settled":M}
aws lambda invoke --function-name streakr-poll-pending-calls \
  --payload '{}' /tmp/out.json && cat /tmp/out.json

# sentiment — expect a one-line momentum read
curl -sS "https://<sentiment-url>/?asset=BTC"

# pre-lock nudge — expect {"nudges":[...]}
curl -sS "https://<nudge-url>/?withinSeconds=120" \
  -H "x-streakr-secret: <N8N_SHARED_SECRET>"

# result card — 404 until a real call settles, then returns SVG
curl -sS "https://<card-url>/?cardId=<a real callId>" -o card.svg

# confirm the schedule is actually firing
START=$(python3 -c "import time; print(int((time.time()-300)*1000))")
aws logs filter-log-events \
  --log-group-name /aws/lambda/streakr-poll-pending-calls \
  --start-time "$START" --query "events[].message" --output text
```

Verified results from the live deployment:

```
sentiment  → {"asset":"BTC","text":"BTC has closed Up in 2 of the last 4 windows
              (-0.10% overall).","source":"template","label":"AI take, not advice"}
nudge      → {"nudges":[]}          (no rooms with an active market yet)
card       → {"error":"not found"}  (404 — correct, no settled calls yet)
poller     → {"checked":0,"settled":0}
```

## Updating a function

```bash
cd backend/lambda
npm run package
aws lambda update-function-code \
  --function-name streakr-sentiment \
  --zip-file fileb://deploy/sentiment.zip
aws lambda wait function-updated --function-name streakr-sentiment
```

Nothing else needs to change — env vars, URLs, and the schedule all persist
across code updates.

## Notes

**Why SVG instead of PNG for the Result Card.** The original Cloud Functions
version used `@napi-rs/canvas`. Canvas libraries ship prebuilt native
binaries keyed to a specific OS/CPU, which is a common source of
"works locally, crashes in Lambda" bugs — a package installed on a Mac
bundles the Mac binary, and Lambda runs Amazon Linux. SVG has zero native
dependencies, bundles as plain text, and still renders as a normal image
anywhere it's shared.

**Bundling.** `build.mjs` uses esbuild to inline every dependency into a
single flat `index.js` per handler, so each zip is one file with no
`node_modules` tree. Verified none of the bundled deps (`firebase-admin`,
`@somnia-chain/markets-sdk`, `viem`) pull in `.node` native binaries.

**Cost.** All four functions sit inside Lambda's always-free tier (1M
requests + 400K GB-seconds/month, permanently). The 1-minute schedule is
~43,200 invocations/month, nowhere near the limit.

---

## Deploying `streakr-faucet`

### Why it exists

The demo wallet's private key is generated **in the browser**. Nothing on the
client can fund it, so a brand-new key holds `0 STT` — and STT is the gas token,
which means that wallet cannot send *any* transaction. Critically, that includes
the collateral token's own public `faucet()`, because that is itself a
transaction. Only something that already holds gas can break the circle, so the
grant has to come from the server.

Measured with `chain-integration/scripts/check-demo-wallet-funding.ts`:

```
who                  STT (gas)     tUSDC
fresh demo wallet    0             0
project treasury     0.976         9590.6
```

Before this function existed, every visitor's first call failed regardless of
wallet path — an external wallet has no Shannon STT either, and there's no way
to faucet someone else's wallet on their behalf.

### Guards

It spends real (testnet) treasury funds, so:

- **one grant per address, ever** — recorded in `faucetGrants/{address}`
- **rolling 24h cap** across all addresses (`FAUCET_DAILY_CAP`, default 60)
- **refuses on mainnet**
- **refuses when the treasury is nearly empty**, rather than half-funding an
  address and leaving a confusing broken state
- the grant record is written **before** any transfer, so a racing duplicate
  request loses on the create and cannot double-spend

`faucetGrants` is closed to clients in `firestore.rules`: a client that could
create a record could lock its own address out of funding, and one that could
delete could re-request indefinitely and drain the treasury.

### Deploy

```bash
cd backend/lambda
npm run package

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

aws lambda create-function \
  --function-name streakr-faucet \
  --runtime nodejs20.x \
  --role "arn:aws:iam::${ACCOUNT_ID}:role/streakr-lambda-exec" \
  --handler index.handler \
  --zip-file fileb://deploy/faucet.zip \
  --timeout 120 --memory-size 256

aws lambda wait function-active --function-name streakr-faucet
```

### Environment

`FAUCET_PRIVATE_KEY` is the treasury key that holds the STT and tUSDC. Treat it
as a secret — for anything beyond a testnet demo it belongs in Secrets Manager
rather than a plain Lambda env var.

```bash
python3 <<'EOF'
import json
sa = json.dumps(json.load(open("streakr-hackathon-firebase-adminsdk.json")))
json.dump({"Variables": {
    "NETWORK": "testnet",
    "FIREBASE_SERVICE_ACCOUNT_JSON": sa,
    "FAUCET_PRIVATE_KEY": "0x<treasury key — same one in chain-integration/.env>",
    "FAUCET_STT": "0.02",     # ~4 calls' worth of gas per user
    "FAUCET_USDC": "150",     # covers the $5–$50 stake buttons
    "FAUCET_DAILY_CAP": "60",
}}, open("/tmp/env_faucet.json", "w"))
EOF

aws lambda update-function-configuration --function-name streakr-faucet \
  --environment file:///tmp/env_faucet.json
aws lambda wait function-updated --function-name streakr-faucet
```

### Function URL

Same two-permission gotcha as the other public functions (see the warning
above — `lambda:InvokeFunctionUrl` alone yields a 403 that looks like a
propagation delay):

```bash
aws lambda create-function-url-config \
  --function-name streakr-faucet \
  --auth-type NONE \
  --cors '{"AllowOrigins":["*"],"AllowMethods":["POST"],"AllowHeaders":["content-type"]}'

aws lambda add-permission --function-name streakr-faucet \
  --statement-id UrlPolicyInvokeURL \
  --action lambda:InvokeFunctionUrl --principal "*" --function-url-auth-type NONE

aws lambda add-permission --function-name streakr-faucet \
  --statement-id UrlPolicyInvokeFunction \
  --action lambda:InvokeFunction --principal "*" --invoked-via-function-url
```

Put the resulting URL in `app/.env` as `EXPO_PUBLIC_FAUCET_URL`, then rebuild
the web app — `npm run build:web` asserts the value is actually inlined, since
Metro caches env inlining and a plain `expo export` would ship the old bundle.

### Verify

```bash
# A fresh address should get funded once...
ADDR=0x$(openssl rand -hex 20)
curl -sS -X POST "https://<faucet-url>/" \
  -H 'content-type: application/json' -d "{\"address\":\"$ADDR\"}"
# -> {"funded":true,"stt":"0.02","usdc":"150.0","sttHash":"0x…","usdcHash":"0x…"}

# ...and be refused the second time.
curl -sS -X POST "https://<faucet-url>/" \
  -H 'content-type: application/json' -d "{\"address\":\"$ADDR\"}"
# -> {"alreadyFunded":true,"message":"This address has already been funded."}

# Bad input is rejected without spending anything.
curl -sS -X POST "https://<faucet-url>/" \
  -H 'content-type: application/json' -d '{"address":"nope"}'
# -> {"error":"provide a valid EVM address as {\"address\":\"0x…\"}"}
```

### Topping the treasury back up

```bash
cd chain-integration
npx tsx scripts/fund-collateral.ts        # mints 10,000 tUSDC to the treasury
# Gas has no self-serve faucet — use the Shannon faucet for STT.
```

At the defaults above, `0.976 STT` funds roughly 48 wallets and `9590 tUSDC`
roughly 63, so gas is the binding constraint. Watch it before a demo.
