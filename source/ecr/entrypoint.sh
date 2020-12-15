#!/bin/bash

# start gunicorn in backend
nohup gunicorn -w 10 \
    -k gevent \
    --timeout 120 \
    -b  127.0.0.1:8009 \
    --limit-request-line 0 \
    --limit-request-field_size 0 \
    "superset.app:create_app()" 2>&1 &

# restart nginx and close backend running
nginx -g "daemon off;"
