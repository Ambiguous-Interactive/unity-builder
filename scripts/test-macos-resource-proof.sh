#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
return_script="${root}/dist/platforms/mac/steps/return_license.sh"
activation_script="${root}/dist/platforms/mac/steps/activate.sh"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/unity-builder-macos-proof.XXXXXX")"
trap 'rm -rf "${scratch}"' EXIT

fail() {
  printf 'macOS cleanup proof test failed: %s\n' "$*" >&2
  exit 1
}

make_editor() {
  local behavior="$1" editor
  editor="${scratch}/editor-${behavior}"
  cat >"${editor}" <<'EDITOR'
#!/usr/bin/env bash
set -euo pipefail
log=''
returning=false
while (($#)); do
  case "$1" in
    -logFile) log="$2"; shift 2 ;;
    -returnlicense) returning=true; shift ;;
    *) shift ;;
  esac
done
if [[ "${returning}" == false ]]; then
  case "${FAKE_BEHAVIOR}" in
    account-blocked) printf '%s\n' 'Licensing failed with error code 20111' >"${log}"; exit 1 ;;
    *) : >"${log}"; exit 0 ;;
  esac
fi
case "${FAKE_BEHAVIOR}" in
  success)
    printf '%s\n' \
      'Successfully returned the entitlement license' \
      '[Licensing::Client] Successfully returned ULF license with serial number: masked' >"${log}"
    ;;
  legacy-unavailable)
    printf '%s\n' \
      '[Licensing::Module] Successfully returned the entitlement license' \
      'Serial number unavailable for ULF return' >"${log}"
    ;;
  missing) printf '%s\n' 'Exiting batchmode successfully now!' >"${log}" ;;
  nonzero)
    printf '%s\n' \
      'Successfully returned the entitlement license' \
      '[Licensing::Client] Successfully returned ULF license with serial number: masked' >"${log}"
    exit 7
    ;;
  timeout|cancel|ignore-term|parent-exits-child-ignores|late-fork)
    : >"${log}"
    sleeper=''
    terminate_fake_editor() {
      if [[ -n "${sleeper}" ]]; then
        kill -TERM "${sleeper}" 2>/dev/null || true
        wait "${sleeper}" 2>/dev/null || true
      fi
      printf terminated >"${FAKE_TERMINATED_SENTINEL}"
      exit 143
    }
    if [[ "${FAKE_BEHAVIOR}" == ignore-term ]]; then
      trap '' TERM
    elif [[ "${FAKE_BEHAVIOR}" == parent-exits-child-ignores ]]; then
      trap 'printf terminated >"${FAKE_TERMINATED_SENTINEL}"; exit 143' TERM INT
    elif [[ "${FAKE_BEHAVIOR}" == late-fork ]]; then
      trap 'bash -c '\''trap "" TERM; while :; do sleep 1; done'\'' & printf "%s" "$!" >"${FAKE_DESCENDANT_PID_FILE}"; exit 143' TERM INT
    else
      trap terminate_fake_editor TERM INT
    fi
    if [[ "${FAKE_BEHAVIOR}" == parent-exits-child-ignores ]]; then
      bash -c 'trap "" TERM; while :; do sleep 1; done' &
      printf '%s' "$!" >"${FAKE_DESCENDANT_PID_FILE}"
    else
      sleep 30 &
    fi
    sleeper=$!
    wait "${sleeper}"
    ;;
esac
EDITOR
  chmod +x "${editor}"
  printf '%s' "${editor}"
}

run_return_case() {
  local behavior="$1" expected_proof="$2" expected_status="$3"
  local selected_launcher="${4:-}" fake_behavior="${5:-${behavior}}"
  local case_dir="${scratch}/${behavior}" editor output proof status
  mkdir -p "${case_dir}/project"
  editor="$(make_editor "${fake_behavior}")"
  output="${case_dir}/console.log"
  proof="${case_dir}/proof"
  status="${case_dir}/status"
  (
    export ACTIVATE_LICENSE_PATH="${case_dir}/project"
    export UNITY_SERIAL='synthetic-serial'
    export UNITY_EMAIL='synthetic@example.invalid'
    export UNITY_PASSWORD='synthetic-password'
    export UNITY_LICENSING_SERVER=''
    export UNITY_BUILDER_UNITY_EDITOR_PATH="${editor}"
    export UNITY_BUILDER_RESOURCE_PROOF_NONCE='current-nonce'
    export UNITY_BUILDER_RESOURCE_PROOF_PATH="${proof}"
    export UNITY_BUILDER_RESOURCE_RETURN_LOG_PATH="${case_dir}/return.log"
    export UNITY_BUILDER_RESOURCE_STATUS_PATH="${status}"
    export UNITY_BUILDER_RETURN_TIMEOUT_SECONDS=1
    export UNITY_BUILDER_RETURN_KILL_GRACE_SECONDS=1
    export FAKE_BEHAVIOR="${fake_behavior}"
    export FAKE_TERMINATED_SENTINEL="${case_dir}/terminated"
    export FAKE_DESCENDANT_PID_FILE="${case_dir}/descendant-pid"
    export FAKE_UNISOLATED_LAUNCHER_PID_FILE="${case_dir}/launcher-pid"
    export FAKE_UNISOLATED_TERM_SENTINEL="${case_dir}/launcher-term"
    if [[ -n "${selected_launcher}" ]]; then
      export UNITY_BUILDER_RETURN_LAUNCHER_PATH="${selected_launcher}"
    else
      unset UNITY_BUILDER_RETURN_LAUNCHER_PATH || true
    fi
    source "${return_script}"
  ) >"${output}" 2>&1 || true

  if [[ "${expected_proof}" == true ]]; then
    if [[ ! -e "${proof}" || "$(cat "${proof}")" != 'resource-safe=current-nonce' ]]; then
      sed 's/synthetic-password/[masked]/g; s/synthetic-serial/[masked]/g' "${output}" >&2
      fail "${behavior} did not write exact current-attempt proof"
    fi
  else
    [[ ! -e "${proof}" ]] || fail "${behavior} unexpectedly wrote cleanup proof"
  fi
  [[ -e "${status}" ]] || fail "${behavior} did not persist a return status"
  [[ "$(cat "${status}")" == "${expected_status}" ]] ||
    fail "${behavior} status was not ${expected_status}"
  ! grep -Eq '20111|synthetic-serial|synthetic-password' "${output}" ||
    fail "${behavior} leaked private activation/account material to stdout"
}

run_return_case success true completed:0
run_return_case legacy-unavailable true completed:0
run_return_case missing false completed:0
run_return_case nonzero false completed:7
run_return_case timeout false timeout
run_return_case ignore-term false timeout
run_return_case parent-exits-child-ignores false timeout

orphan_pid="$(cat "${scratch}/parent-exits-child-ignores/descendant-pid")"
if kill -0 "${orphan_pid}" 2>/dev/null; then
  kill -KILL "${orphan_pid}" 2>/dev/null || true
  fail 'return timeout left a TERM-ignoring descendant running after its parent exited'
fi

run_return_case late-fork false timeout
late_fork_pid="$(cat "${scratch}/late-fork/descendant-pid")"
if kill -0 "${late_fork_pid}" 2>/dev/null; then
  kill -KILL "${late_fork_pid}" 2>/dev/null || true
  fail 'return timeout left a descendant that was forked during TERM handling running'
fi

shared_group_launcher="${scratch}/launch-shared.py"
cat >"${shared_group_launcher}" <<'PYTHON'
#!/usr/bin/env python3
import os
import signal
import sys
import time

ready_path = sys.argv[1]
acknowledge_path = sys.argv[2]
pid_path = os.environ["FAKE_UNISOLATED_LAUNCHER_PID_FILE"]
term_path = os.environ["FAKE_UNISOLATED_TERM_SENTINEL"]
with open(pid_path, "x", encoding="ascii") as pid_file:
    pid_file.write(str(os.getpid()))

def on_term(_signal, _frame):
    with open(term_path, "x", encoding="ascii") as term_file:
        term_file.write("term")

signal.signal(signal.SIGTERM, on_term)
with open(ready_path, "x", encoding="ascii") as ready_file:
    ready_file.write(f"{os.getpid()}:{os.getpgrp()}")
deadline = time.monotonic() + 5
while not os.path.exists(acknowledge_path):
    if time.monotonic() >= deadline:
        raise SystemExit(70)
    time.sleep(0.01)
os.execv(sys.argv[3], sys.argv[3:])
PYTHON
run_return_case shared-timeout false isolation-failed "${shared_group_launcher}" timeout
run_return_case shared-late-fork false isolation-failed "${shared_group_launcher}" late-fork
for shared_case in shared-timeout shared-late-fork; do
  shared_launcher_pid="$(cat "${scratch}/${shared_case}/launcher-pid")"
  if kill -0 "${shared_launcher_pid}" 2>/dev/null; then
    kill -KILL "${shared_launcher_pid}" 2>/dev/null || true
    fail "${shared_case} left its unisolated launcher running"
  fi
  [[ ! -e "${scratch}/${shared_case}/launcher-term" ]] ||
    fail "${shared_case} used TERM before process-group isolation"
  [[ ! -e "${scratch}/${shared_case}/descendant-pid" ]] ||
    fail "${shared_case} executed Unity before process-group isolation was accepted"
done
run_return_case missing-launcher false isolation-failed "${scratch}/missing-launcher.py" timeout

handshake_cancel_dir="${scratch}/handshake-cancel"
mkdir -p "${handshake_cancel_dir}/project"
handshake_cancel_editor="$(make_editor cancel)"
handshake_cancel_launcher="${handshake_cancel_dir}/launch-delayed.py"
cat >"${handshake_cancel_launcher}" <<'PYTHON'
#!/usr/bin/env python3
import os
import signal
import time

pid_path = os.environ["FAKE_UNISOLATED_LAUNCHER_PID_FILE"]
term_path = os.environ["FAKE_UNISOLATED_TERM_SENTINEL"]
with open(pid_path, "x", encoding="ascii") as pid_file:
    pid_file.write(str(os.getpid()))

def on_term(_signal, _frame):
    with open(term_path, "x", encoding="ascii") as term_file:
        term_file.write("term")

signal.signal(signal.SIGTERM, on_term)
time.sleep(20)
PYTHON
(
  export ACTIVATE_LICENSE_PATH="${handshake_cancel_dir}/project"
  export UNITY_SERIAL='synthetic-serial'
  export UNITY_EMAIL='synthetic@example.invalid'
  export UNITY_PASSWORD='synthetic-password'
  export UNITY_LICENSING_SERVER=''
  export UNITY_BUILDER_UNITY_EDITOR_PATH="${handshake_cancel_editor}"
  export UNITY_BUILDER_RESOURCE_PROOF_NONCE='current-nonce'
  export UNITY_BUILDER_RESOURCE_PROOF_PATH="${handshake_cancel_dir}/proof"
  export UNITY_BUILDER_RESOURCE_RETURN_LOG_PATH="${handshake_cancel_dir}/return.log"
  export UNITY_BUILDER_RESOURCE_STATUS_PATH="${handshake_cancel_dir}/status"
  export UNITY_BUILDER_RETURN_TIMEOUT_SECONDS=20
  export UNITY_BUILDER_RETURN_KILL_GRACE_SECONDS=1
  export UNITY_BUILDER_RETURN_LAUNCHER_PATH="${handshake_cancel_launcher}"
  export FAKE_UNISOLATED_LAUNCHER_PID_FILE="${handshake_cancel_dir}/launcher-pid"
  export FAKE_UNISOLATED_TERM_SENTINEL="${handshake_cancel_dir}/launcher-term"
  source "${return_script}"
) >"${handshake_cancel_dir}/console.log" 2>&1 &
handshake_cancel_pid=$!
for _ in {1..50}; do
  [[ -e "${handshake_cancel_dir}/launcher-pid" ]] && break
  sleep 0.1
done
[[ -e "${handshake_cancel_dir}/launcher-pid" ]] || fail 'handshake cancellation launcher did not start'
handshake_launcher_pid="$(cat "${handshake_cancel_dir}/launcher-pid")"
kill -TERM "${handshake_cancel_pid}"
wait "${handshake_cancel_pid}" || true
[[ "$(cat "${handshake_cancel_dir}/status")" == terminated ]] ||
  fail 'handshake cancellation was not classified terminated'
if kill -0 "${handshake_launcher_pid}" 2>/dev/null; then
  kill -KILL "${handshake_launcher_pid}" 2>/dev/null || true
  fail 'handshake cancellation left the unisolated launcher running'
fi
[[ ! -e "${handshake_cancel_dir}/launcher-term" ]] ||
  fail 'handshake cancellation sent TERM before isolation was established'

cancel_dir="${scratch}/cancel"
mkdir -p "${cancel_dir}/project"
cancel_editor="$(make_editor cancel)"
(
  export ACTIVATE_LICENSE_PATH="${cancel_dir}/project"
  export UNITY_SERIAL='synthetic-serial'
  export UNITY_EMAIL='synthetic@example.invalid'
  export UNITY_PASSWORD='synthetic-password'
  export UNITY_LICENSING_SERVER=''
  export UNITY_BUILDER_UNITY_EDITOR_PATH="${cancel_editor}"
  export UNITY_BUILDER_RESOURCE_PROOF_NONCE='current-nonce'
  export UNITY_BUILDER_RESOURCE_PROOF_PATH="${cancel_dir}/proof"
  export UNITY_BUILDER_RESOURCE_RETURN_LOG_PATH="${cancel_dir}/return.log"
  export UNITY_BUILDER_RESOURCE_STATUS_PATH="${cancel_dir}/status"
  export UNITY_BUILDER_RETURN_TIMEOUT_SECONDS=20
  export UNITY_BUILDER_RETURN_KILL_GRACE_SECONDS=1
  export FAKE_BEHAVIOR=cancel
  export FAKE_TERMINATED_SENTINEL="${cancel_dir}/terminated"
  source "${return_script}"
) >"${cancel_dir}/console.log" 2>&1 &
cancel_pid=$!
for _ in {1..50}; do
  [[ -e "${cancel_dir}/return.log" ]] && break
  sleep 0.1
done
kill -TERM "${cancel_pid}"
wait "${cancel_pid}" || true
[[ ! -e "${cancel_dir}/proof" ]] || fail 'cancel unexpectedly wrote cleanup proof'
[[ "$(cat "${cancel_dir}/status")" == terminated ]] || fail 'cancel was not classified terminated'
[[ -e "${cancel_dir}/terminated" ]] || fail 'cancel left the child return process running'

activation_dir="${scratch}/account-blocked"
mkdir -p "${activation_dir}/project"
activation_editor="$(make_editor account-blocked)"
(
  export ACTIVATE_LICENSE_PATH="${activation_dir}/project"
  export UNITY_VERSION='2022.3.62f3'
  export UNITY_SERIAL='synthetic-serial'
  export UNITY_EMAIL='synthetic@example.invalid'
  export UNITY_PASSWORD='synthetic-password'
  export UNITY_BUILDER_UNITY_EDITOR_PATH="${activation_editor}"
  export UNITY_BUILDER_RESOURCE_ACTIVATION_LOG_PATH="${activation_dir}/activation.log"
  export FAKE_BEHAVIOR=account-blocked
  source "${activation_script}"
) >"${activation_dir}/console.log" 2>&1 && fail '20111 activation unexpectedly succeeded'
grep -Eq '(^|[^0-9])20111([^0-9]|$)' "${activation_dir}/activation.log" ||
  fail '20111 activation evidence was not retained privately'
! grep -q 20111 "${activation_dir}/console.log" || fail '20111 evidence leaked to stdout'

entrypoint_case() {
  local behavior="$1" expected_exit="$2"
  local case_dir action_dir status=0
  case_dir="${scratch}/entrypoint-${behavior}"
  action_dir="${case_dir}/action"
  mkdir -p "${action_dir}/platforms/mac/steps" "${action_dir}/BlankProject" "${case_dir}/license"
  cp "${root}/dist/platforms/mac/entrypoint.sh" "${action_dir}/platforms/mac/entrypoint.sh"
  cat >"${action_dir}/platforms/mac/steps/activate.sh" <<'ACTIVATE'
if [[ "${ENTRYPOINT_BEHAVIOR}" == activation-failure ]]; then
  exit 17
fi
ACTIVATE
  cat >"${action_dir}/platforms/mac/steps/build.sh" <<'BUILD'
case "${ENTRYPOINT_BEHAVIOR}" in
  build-failure) BUILD_EXIT_CODE=9 ;;
  *) BUILD_EXIT_CODE=0 ;;
esac
BUILD
  cat >"${action_dir}/platforms/mac/steps/return_license.sh" <<'RETURN'
printf 'returned' >"${ENTRYPOINT_RETURN_SENTINEL}"
RETURN

    ACTION_FOLDER="${action_dir}" \
    SKIP_ACTIVATION=false \
    UNITY_LICENSE_PATH="${case_dir}/license" \
    ENTRYPOINT_BEHAVIOR="${behavior}" \
    ENTRYPOINT_RETURN_SENTINEL="${case_dir}/returned" \
    bash "${action_dir}/platforms/mac/entrypoint.sh" >"${case_dir}/console.log" 2>&1 &
  local entrypoint_pid=$!
  wait "${entrypoint_pid}" || status=$?

  [[ "${status}" == "${expected_exit}" ]] ||
    fail "${behavior} entrypoint exit was ${status}, expected ${expected_exit}"
  [[ -e "${case_dir}/returned" ]] || fail "${behavior} skipped same-runner license return"
}

entrypoint_case activation-failure 17
entrypoint_case build-failure 9

printf '%s\n' 'macOS resource cleanup proof fixtures passed.'
