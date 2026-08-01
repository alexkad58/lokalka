#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/lokalka"
BRANCH="main"
PM2_APP_NAME="lokalka-api"

echo "==> Deploying ${APP_DIR} from ${BRANCH}"

cd "${APP_DIR}"

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
pm2 restart "${PM2_APP_NAME}" --update-env

echo "==> Saving PM2 process list"
pm2 save

echo "==> Deployment complete"
pm2 status "${PM2_APP_NAME}"
