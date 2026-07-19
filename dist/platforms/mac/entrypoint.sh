#!/usr/bin/env bash

# Keep license return on this same runner for every normal shell exit, including
# activation/build failure and cancellation. The lock action's post step remains
# the fail-closed backstop for hard runner loss.
ACTIVATE_LICENSE_PATH=''
activation_attempted=false
cleanup_started=false

cleanup_license() {
  local original_exit_code=$?
  trap - EXIT INT TERM

  if [[ "$activation_attempted" == true && "$cleanup_started" == false ]]; then
    cleanup_started=true
    source "$ACTION_FOLDER/platforms/mac/steps/return_license.sh" || true
  fi
  if [[ -n "$ACTIVATE_LICENSE_PATH" ]]; then
    rm -rf -- "$ACTIVATE_LICENSE_PATH"
  fi

  exit "$original_exit_code"
}

trap cleanup_license EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$SKIP_ACTIVATION" != "true" ]; then
  UNITY_LICENSE_PATH="${UNITY_LICENSE_PATH:-/Library/Application Support/Unity}"

  if [ ! -d "$UNITY_LICENSE_PATH" ]; then
    echo "Creating Unity License Directory"
    sudo mkdir -p "$UNITY_LICENSE_PATH"
    sudo chmod -R 777 "$UNITY_LICENSE_PATH"
  fi;

  ACTIVATE_LICENSE_PATH="$ACTION_FOLDER/BlankProject"
  mkdir -p "$ACTIVATE_LICENSE_PATH"

  activation_attempted=true
  source "$ACTION_FOLDER/platforms/mac/steps/activate.sh"
else
  echo "Skipping activation"
fi

#
# Run Build
#

source "$ACTION_FOLDER/platforms/mac/steps/build.sh"

#
# Instructions for debugging
#

if [[ $BUILD_EXIT_CODE -gt 0 ]]; then
echo ""
echo "###########################"
echo "#         Failure         #"
echo "###########################"
echo ""
echo "Please note that the exit code is not very descriptive."
echo "Most likely it will not help you solve the issue."
echo ""
echo "To find the reason for failure: please search for errors in the log above and check for annotations in the summary view."
echo ""
fi;

#
# Exit with code from the build step.
#

exit "$BUILD_EXIT_CODE"
