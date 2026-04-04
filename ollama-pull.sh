#!/bin/sh
while true; do
  timeout 10s ollama pull gemma4:latest
done
