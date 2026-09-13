#!/usr/bin/env bash
set -eu

: "${CI_PROJECT_DIR:?Set CI_PROJECT_DIR to the target Git repository path}"
git config --global --add safe.directory "$CI_PROJECT_DIR"
CI_BUILDS_DIR="${CI_BUILDS_DIR:-/builds}"
CI_PIPELINE_SOURCE="merge_request_event"
CI_JOB_ID="local-test"
CI_JOB_IMAGE="ghcr.io/fakrulauzaie/api-intel@sha256:bb9a0a56abb61f2da8f14780e7640b1f819e4c7d59648bc5d83df87c7ade6b8b"

CI_COMMIT_SHA=$(git -C "$CI_PROJECT_DIR" rev-parse HEAD)
CI_MERGE_REQUEST_DIFF_BASE_SHA=$(git -C "$CI_PROJECT_DIR" rev-parse HEAD~1)

echo "Simulating GitLab CI evaluation:"
echo "  Candidate: $CI_COMMIT_SHA"
echo "  Baseline:  $CI_MERGE_REQUEST_DIFF_BASE_SHA"

API_INTEL_WORKSPACE="$CI_BUILDS_DIR/.api-intel-$CI_JOB_ID"
rm -rf "$API_INTEL_WORKSPACE"
mkdir -p "$API_INTEL_WORKSPACE"

git -C "$CI_PROJECT_DIR" cat-file -e "$CI_MERGE_REQUEST_DIFF_BASE_SHA^{commit}"
git -C "$CI_PROJECT_DIR" cat-file -e "$CI_COMMIT_SHA^{commit}"

git -C "$CI_PROJECT_DIR" worktree prune || true

git -C "$CI_PROJECT_DIR" worktree add --detach "$API_INTEL_WORKSPACE/baseline" "$CI_MERGE_REQUEST_DIFF_BASE_SHA"
git -C "$CI_PROJECT_DIR" worktree add --detach "$API_INTEL_WORKSPACE/candidate" "$CI_COMMIT_SHA"

export INPUT_WORKSPACE="$API_INTEL_WORKSPACE"
export INPUT_PROJECT_DIRECTORY="$CI_PROJECT_DIR"
export INPUT_PUBLICATION_DIRECTORY=".api-intel-gitlab"
export INPUT_BASELINE_DIRECTORY="baseline"
export INPUT_BASELINE_REVISION="$CI_MERGE_REQUEST_DIFF_BASE_SHA"
export INPUT_CANDIDATE_DIRECTORY="candidate"
export INPUT_CANDIDATE_REVISION="$CI_COMMIT_SHA"
export INPUT_CONFIGURATION="baseline/api-intel.config.json"
export INPUT_OUTPUT_DIRECTORY="results"
export INPUT_BASELINE_PACKAGE_MANAGER="pnpm"
export INPUT_BASELINE_PACKAGE_MANAGER_VERSION="11.19.0"
export INPUT_BASELINE_LOCKFILE="pnpm-lock.yaml"
export INPUT_CANDIDATE_PACKAGE_MANAGER="pnpm"
export INPUT_CANDIDATE_PACKAGE_MANAGER_VERSION="11.19.0"
export INPUT_CANDIDATE_LOCKFILE="pnpm-lock.yaml"
export INPUT_MAX_FINDINGS="500"
export CI_PIPELINE_SOURCE
export CI_JOB_IMAGE
export CI_PROJECT_DIR

echo "Executing /opt/api-intel/gitlab-dist/index.js..."
node /opt/api-intel/gitlab-dist/index.js

git -C "$CI_PROJECT_DIR" worktree remove --force "$API_INTEL_WORKSPACE/baseline" || true
git -C "$CI_PROJECT_DIR" worktree remove --force "$API_INTEL_WORKSPACE/candidate" || true
rm -rf "$API_INTEL_WORKSPACE"
