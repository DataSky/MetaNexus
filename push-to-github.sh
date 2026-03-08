#!/bin/bash
# 一键推送到 GitHub
# 运行前先创建仓库：gh repo create MetaNexus --public --description "The Search Engine for the Agent Economy"
# 或者在 GitHub 网页上创建

REPO_URL="git@github.com:DataSky/MetaNexus.git"
git remote add origin "$REPO_URL" 2>/dev/null || git remote set-url origin "$REPO_URL"
git branch -M main
git push -u origin main
echo "✅ Pushed to $REPO_URL"
