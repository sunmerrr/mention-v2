#!/bin/sh
set -e
# 컨테이너 최초 기동 시 env 를 읽어 index.html 의 placeholder 를 JSON 으로 치환한다.
# 그래서 같은 web 이미지가 qa/production 어디서든 돈다. → frontend/build-and-runtime.md
HTML=/usr/share/nginx/html/index.html
CONFIG="{\"API_URL\":\"${API_URL}\",\"SOCKET_URL\":\"${SOCKET_URL}\"}"
sed -i "s|__APP_RUNTIME_CONFIG__|${CONFIG}|" "$HTML"
