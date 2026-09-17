#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/lokalka"
BRANCH="main"
PM2_APP_NAME="lokalka-api"
PERSISTENT_DATA_DIR="/var/lib/lokalka-data"
PATCHNOTES_FILE="${PERSISTENT_DATA_DIR}/patchnotes.json"

echo "==> Deploying ${APP_DIR} from ${BRANCH}"

cd "${APP_DIR}"

echo "==> Preparing persistent patch notes storage"
mkdir -p "${PERSISTENT_DATA_DIR}"
if [[ ! -f "${PATCHNOTES_FILE}" && -f "${APP_DIR}/server/patchnotes.json" ]]; then
	cp "${APP_DIR}/server/patchnotes.json" "${PATCHNOTES_FILE}"
fi

echo "==> Fetching latest code"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
echo "==> Resetting local changes to match origin/${BRANCH}"
git reset --hard "origin/${BRANCH}"

echo "==> Installing dependencies"
npm ci
npm --prefix server ci
npm --prefix client ci

echo "==> Building client"
npm run build

echo "==> Restarting API"
export LOKALKA_PATCHNOTES_FILE="${PATCHNOTES_FILE}"
pm2 restart "${PM2_APP_NAME}" --update-env

echo "==> Saving PM2 process list"
pm2 save

echo "==> Deployment complete"
pm2 status "${PM2_APP_NAME}"
