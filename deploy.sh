#!/bin/bash
# Builds the web app and deploys to electrifygame.com, including invalidating the files on cloudfront (CDN)
# Requires the aws cli for s3 deploys (make sure to set your bucket region!)
# Requires that you run `aws configure set preview.cloudfront true` to enable cloudfront invalidation

# -u matters as much as -e here: every destination below is a variable now, and an
# unset one would otherwise expand to empty and upload the build somewhere nobody chose.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Optional per-machine overrides. Sourcing a file executes it, so only ever read the one
# next to this script -- never a path taken from an argument or the environment.
env_file="$script_dir/.env"
if [ -f "$env_file" ]; then
  set -a
  # shellcheck disable=SC1090,SC1091
  . "$env_file"
  set +a
fi

# Defaults live here rather than only in .env. These are public infrastructure names that
# are already in git, and a file whose absence silently retargets a production deploy is a
# worse failure than one that refuses to run. See .env.example.
: "${AWS_REGION:=us-east-2}"
: "${BETA_BUCKET:=beta.electrifygame.com}"
: "${PROD_BUCKET:=electrifygame.com}"
: "${PROD_DISTRIBUTION_ID:=E38D57AILAHD00}"

TARGETS="beta prod local-beta local-prod ci-prod"
target="${1:-}"

# Exact alternatives, not a regex match against the list: `[[ $TARGETS =~ $target ]]`
# treated the argument as a pattern, so `./deploy.sh d` counted as valid and
# `./deploy.sh .` matched everything.
isValidTarget() {
  case "$1" in
    beta | prod | local-beta | local-prod | ci-prod) return 0 ;;
    *) return 1 ;;
  esac
}

getTarget() {
  if isValidTarget "$target"; then
    return
  fi
  if [ -n "$target" ]; then
    echo "Unknown target: $target" >&2
  fi
  echo "Where would you like to deploy?"
  select t in $TARGETS; do
    target="${t:-}"
    break
  done
  if ! isValidTarget "$target"; then
    echo "No target selected; nothing deployed." >&2
    exit 1
  fi
}

# Fail closed on missing configuration, naming everything that is missing at once rather
# than one thing per run. Names only, never values: CI logs on a public repository are
# public, which is also why this script never turns on `set -x`.
requireVars() {
  local missing=""
  local name
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      missing="$missing $name"
    fi
  done
  if [ -n "$missing" ]; then
    echo "Missing required environment:$missing" >&2
    echo "Refusing to deploy $target. See .env.example." >&2
    exit 1
  fi
}

deploy() {
  echo "Deploying to $target"
  case "$target" in
    local-beta) betabuild ;;
    local-prod) prodbuild ;;
    beta) beta ;;
    ci-prod)
      # Non-interactive prod deploy, used by the GitHub Action on pushes to master.
      prod
      ;;
    prod)
      local reply=""
      read -r -p "Did you test on beta? (y/N) " -n 1 reply || true
      echo
      if [[ ! $reply =~ ^[Yy]$ ]]; then
        echo "Prod build cancelled until tested on beta."
        return
      fi
      reply=""
      read -r -p "Are you on the master branch? (y/N) " -n 1 reply || true
      echo
      if [[ ! $reply =~ ^[Yy]$ ]]; then
        echo "Prod build cancelled until on master branch."
        return
      fi
      prod
      ;;
  esac
}

# Git LFS pointer files build without error but publish 130-byte stubs in place
# of every image and audio file, so check before anything reaches the bucket.
assertNoLfsPointers() {
  if grep -rql "https://git-lfs.github.com/spec/v1" build; then
    echo "Build contains Git LFS pointers instead of real assets; aborting." >&2
    echo "Run 'git lfs pull' and rebuild." >&2
    exit 1
  fi
}

# The same idea applied to credentials: the bundle is about to become world-readable
# behind a cache header measured in months, so check it before the upload rather than
# after. This is what catches the mistake .env.example warns about -- a secret given a
# REACT_APP_ prefix, which create-react-app compiles straight into the JavaScript.
assertNoSecretsInBuild() {
  local name value
  for name in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN FIREBASE_SERVICE_ACCOUNT GITHUB_TOKEN; do
    value="${!name:-}"
    # Short values would match by coincidence; real credentials are long.
    if [ "${#value}" -ge 12 ] && grep -rqF -e "$value" build; then
      echo "Build contains the value of $name; aborting before upload." >&2
      exit 1
    fi
  done
  if grep -rqE '(AKIA|ASIA)[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----' build; then
    echo "Build contains something shaped like an AWS key id or a private key; aborting." >&2
    exit 1
  fi
}

assertPublishable() {
  assertNoLfsPointers
  assertNoSecretsInBuild
}

prebuild() {
  # clear out old build files to prevent conflicts
  rm -rf build
}

betabuild() {
  prebuild
  export NODE_ENV='development'
  npm run build
}

beta() {
  # Every uploaded target needs the key: without it the bundle ships the
  # CONTACT-ADMIN-TO-GET-KEY placeholder from src/Globals.tsx and the deployed site's
  # sign-in and leaderboard are broken for everyone who visits.
  requireVars REACT_APP_FIREBASE_API_KEY
  betabuild
  assertPublishable
  aws s3 cp build "s3://$BETA_BUCKET" --recursive --region "$AWS_REGION"
}

prodbuild() {
  prebuild
  export NODE_ENV='production'
  npm run build
}

prod() {
  requireVars REACT_APP_FIREBASE_API_KEY
  prodbuild
  assertPublishable
  # Deploy web app to prod with 1 day cache for most files, 6 month cache for art assets
  export AWS_DEFAULT_REGION="$AWS_REGION"
  aws s3 cp build "s3://$PROD_BUCKET" --recursive --exclude '*.mp3' --exclude '*.jpg' --exclude '*.png' --cache-control max-age=86400 --cache-control public
  aws s3 cp build "s3://$PROD_BUCKET" --recursive --exclude '*' --include '*.mp3' --include '*.jpg' --include '*.png' --cache-control max-age=15552000 --cache-control public

  # Upload package.json for API's version check
  aws s3 cp package.json "s3://$PROD_BUCKET/package.json"

  # Invalidate files on cloudfront
  aws cloudfront create-invalidation --distribution-id "$PROD_DISTRIBUTION_ID" --paths /\*
}

getTarget
deploy
