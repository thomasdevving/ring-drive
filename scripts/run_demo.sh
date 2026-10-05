#!/bin/sh
set -eu
task_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
task_device=${1:-booted}
if [ -d "$task_root/Build/RingDrive.app" ]; then
  xcrun simctl install "$task_device" "$task_root/Build/RingDrive.app"
  xcrun simctl launch "$task_device" dev.ringdrive.demo --demo-urgent
else
  echo "Open RingDrive.xcodeproj in Xcode and run RingDrive on an iPhone simulator."
  exit 1
fi
