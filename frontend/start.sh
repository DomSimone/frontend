#!/bin/sh

# Start the Python Flask server in the background
echo "Starting Python LangExtract service..."
python workflows/langextract_service.py &

# Start the Node.js server in the foreground
echo "Starting Node.js backend..."
node workflows/main.js
