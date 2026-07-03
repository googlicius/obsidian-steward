#!/bin/sh
while true; do
  timeout 10s ollama pull llama3.2:3b
done
