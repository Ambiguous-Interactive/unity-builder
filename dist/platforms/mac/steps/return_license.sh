#!/usr/bin/env bash

# Run in ACTIVATE_LICENSE_PATH directory. Activation/account output stays in a
# private current-attempt runner-temp file and is never echoed to the job log.
echo "Changing to \"$ACTIVATE_LICENSE_PATH\" directory."
pushd "$ACTIVATE_LICENSE_PATH" >/dev/null

UNITY_EDITOR="${UNITY_BUILDER_UNITY_EDITOR_PATH:-/Applications/Unity/Hub/Editor/$UNITY_VERSION/Unity.app/Contents/MacOS/Unity}"
RETURN_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RETURN_LAUNCHER="${UNITY_BUILDER_RETURN_LAUNCHER_PATH:-${RETURN_SCRIPT_DIR}/launch_isolated.py}"
RETURN_LOG="${UNITY_BUILDER_RESOURCE_RETURN_LOG_PATH:-${TMPDIR:-/tmp}/unity-builder-return.log}"
RETURN_STATUS="${UNITY_BUILDER_RESOURCE_STATUS_PATH:-${TMPDIR:-/tmp}/unity-builder-return.status}"
RETURN_ISOLATION_READY="${RETURN_STATUS}.isolated"
RETURN_ISOLATION_ACK="${RETURN_STATUS}.isolated-ack"
RETURN_TIMEOUT_SECONDS="${UNITY_BUILDER_RETURN_TIMEOUT_SECONDS:-120}"
RETURN_KILL_GRACE_SECONDS="${UNITY_BUILDER_RETURN_KILL_GRACE_SECONDS:-10}"
PROOF_PATH="${UNITY_BUILDER_RESOURCE_PROOF_PATH:-}"
PROOF_NONCE="${UNITY_BUILDER_RESOURCE_PROOF_NONCE:-}"
return_pid=''
return_pgid=''
return_shell_pgid=''
# Bash 3.2 treats an empty-array expansion as unset under `set -u`. Keep one
# ignored sentinel so teardown helpers remain nounset-safe before descendants
# are discovered.
return_descendants=('')
return_status_write_failed=false
return_isolated=false

rm -f -- "$RETURN_LOG" "$RETURN_STATUS" "$RETURN_ISOLATION_READY" "$RETURN_ISOLATION_ACK"
if [[ -n "$PROOF_PATH" ]]; then
  rm -f -- "$PROOF_PATH"
fi

write_return_status() {
  printf '%s' "$1" >"$RETURN_STATUS"
}

read_process_group() {
  local pid="$1"
  ps -o pgid= -p "$pid" 2>/dev/null | tr -d '[:space:]'
}

if [[ ! "$RETURN_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  RETURN_TIMEOUT_SECONDS=120
fi
if [[ ! "$RETURN_KILL_GRACE_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  RETURN_KILL_GRACE_SECONDS=10
fi

snapshot_return_descendants() {
  local parent="$1" child
  while IFS= read -r child; do
    [[ -n "$child" ]] || continue
    if [[ " ${return_descendants[*]} " == *" ${child} "* ]]; then
      continue
    fi
    return_descendants+=("$child")
    snapshot_return_descendants "$child"
  done < <(pgrep -P "$parent" 2>/dev/null || true)
}

return_process_alive() {
  local pid="$1" state
  kill -0 "$pid" 2>/dev/null || return 1
  state="$(ps -o stat= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
  [[ -n "$state" && "$state" != Z* ]]
}

return_tree_alive() {
  local pid
  if [[ -n "$return_pgid" ]] && kill -0 -- "-$return_pgid" 2>/dev/null; then
    return 0
  fi
  if [[ -n "$return_pid" ]] && return_process_alive "$return_pid"; then
    return 0
  fi
  for pid in "${return_descendants[@]}"; do
    [[ -n "$pid" ]] || continue
    if return_process_alive "$pid"; then
      return 0
    fi
  done
  return 1
}

signal_return_tree() {
  local signal="$1" pid
  if [[ -n "$return_pgid" ]]; then
    kill -"$signal" -- "-$return_pgid" 2>/dev/null || true
    return
  fi
  for pid in "${return_descendants[@]}"; do
    [[ -n "$pid" ]] || continue
    kill -"$signal" "$pid" 2>/dev/null || true
  done
  [[ -z "$return_pid" ]] || kill -"$signal" "$return_pid" 2>/dev/null || true
}

stop_return_bounded() {
  local deadline
  [[ -n "$return_pid" ]] || return 0
  if [[ -z "$return_pgid" ]]; then
    return_descendants=('')
    snapshot_return_descendants "$return_pid"
  fi
  signal_return_tree TERM
  deadline=$((SECONDS + RETURN_KILL_GRACE_SECONDS))
  while return_tree_alive && ((SECONDS < deadline)); do
    if [[ -z "$return_pgid" && -n "$return_pid" ]] && return_process_alive "$return_pid"; then
      snapshot_return_descendants "$return_pid"
    fi
    sleep 0.1
  done
  if return_tree_alive; then
    if [[ -z "$return_pgid" && -n "$return_pid" ]] && return_process_alive "$return_pid"; then
      snapshot_return_descendants "$return_pid"
    fi
    signal_return_tree KILL
  fi
  deadline=$((SECONDS + 2))
  while return_tree_alive && ((SECONDS < deadline)); do
    sleep 0.1
  done
  if ! return_tree_alive; then
    wait "$return_pid" 2>/dev/null || true
  fi
}

kill_unisolated_return_bounded() {
  local deadline
  [[ -n "$return_pid" ]] || return 0
  return_descendants=('')
  snapshot_return_descendants "$return_pid"
  # Without a dedicated process group, TERM could let the editor fork a new
  # descendant and exit before that child can be discovered. KILL the known
  # tree directly so no TERM handler can create an escaping process.
  signal_return_tree KILL
  deadline=$((SECONDS + 2))
  while return_tree_alive && ((SECONDS < deadline)); do
    sleep 0.1
  done
  if ! return_tree_alive; then
    wait "$return_pid" 2>/dev/null || true
  fi
}

terminate_return() {
  trap '' INT TERM
  if ! write_return_status terminated; then
    echo '::error::Unable to persist terminated Unity return status.'
  fi
  if [[ "$return_isolated" == true ]]; then
    stop_return_bounded
  else
    kill_unisolated_return_bounded
  fi
  return_pid=''
  exit 143
}

trap terminate_return INT TERM

if [[ -n "${UNITY_LICENSING_SERVER:-}" ]]; then
  #
  # Return any floating license used.
  #
  echo "Returning floating license: \"$FLOATING_LICENSE\""
  /Applications/Unity/Hub/Editor/$UNITY_VERSION/Unity.app/Contents/Frameworks/UnityLicensingClient.app/Contents/MacOS/Unity.Licensing.Client \
    --return-floating "$FLOATING_LICENSE"
elif [[ -n "${UNITY_SERIAL:-}" ]]; then
  #
  # SERIAL LICENSE MODE
  #
  # This will return the license that is currently in use.
  #
  # Python's setsid() supplies a dedicated process group on macOS, where Bash
  # 3.2 monitor mode is not reliable in non-interactive shells. The launcher
  # writes a private readiness record only after isolation succeeds.
  python3 "$RETURN_LAUNCHER" "$RETURN_ISOLATION_READY" "$RETURN_ISOLATION_ACK" "$UNITY_EDITOR" \
    -logFile "$RETURN_LOG" \
    -batchmode \
    -nographics \
    -quit \
    -username "$UNITY_EMAIL" \
    -password "$UNITY_PASSWORD" \
    -returnlicense \
    -projectPath "$ACTIVATE_LICENSE_PATH" \
    >/dev/null 2>&1 &
  return_pid=$!
  isolation_deadline=$((SECONDS + 2))
  while [[ ! -e "$RETURN_ISOLATION_READY" ]] && kill -0 "$return_pid" 2>/dev/null && ((SECONDS < isolation_deadline)); do
    sleep 0.05
  done
  isolation_record="$(cat "$RETURN_ISOLATION_READY" 2>/dev/null || true)"
  isolated_pid="${isolation_record%%:*}"
  isolated_pgid="${isolation_record#*:}"
  observed_pgid="$(read_process_group "$return_pid" || true)"
  return_shell_pid="$(sh -c 'printf %s "$PPID"')"
  return_shell_pgid="$(read_process_group "$return_shell_pid" || true)"
  if [[ "$isolated_pid" == "$return_pid" && "$isolated_pgid" == "$return_pid" && "$observed_pgid" == "$return_pid" && "$isolated_pgid" != "$return_shell_pgid" ]]; then
    return_pgid="$isolated_pgid"
    return_isolated=true
    : >"$RETURN_ISOLATION_ACK"
  fi

  if [[ -z "$return_pgid" ]]; then
    if ! write_return_status isolation-failed; then
      return_status_write_failed=true
    fi
    kill_unisolated_return_bounded
    return_pid=''
    echo '::warning::Unity license return lacked a dedicated process group; cleanup is unconfirmed.'
  fi

  deadline=$((SECONDS + RETURN_TIMEOUT_SECONDS))
  while [[ -n "$return_pid" ]] && kill -0 "$return_pid" 2>/dev/null; do
    if ((SECONDS >= deadline)); then
      # Persist the fail-closed result before sending TERM/KILL. Even a shell or
      # runner interruption during bounded teardown must not look like a clean
      # or missing-status completion.
      if ! write_return_status timeout; then
        return_status_write_failed=true
      fi
      stop_return_bounded
      return_pid=''
      return_pgid=''
      return_isolated=false
      echo "::warning::Unity license return exceeded ${RETURN_TIMEOUT_SECONDS} seconds; cleanup is unconfirmed."
      break
    fi
    sleep 1
  done

  if [[ -n "$return_pid" ]]; then
    return_exit_code=0
    wait "$return_pid" || return_exit_code=$?
    return_pid=''
    return_pgid=''
    return_isolated=false
    write_return_status "completed:${return_exit_code}"

    entitlement_returned=false
    ulf_returned=false
    if grep -Fqx 'Successfully returned the entitlement license' "$RETURN_LOG" 2>/dev/null ||
      grep -Fqx '[Licensing::Module] Successfully returned the entitlement license' "$RETURN_LOG" 2>/dev/null; then
      entitlement_returned=true
    fi
    if grep -Fqx 'Serial number unavailable for ULF return' "$RETURN_LOG" 2>/dev/null ||
      grep -Eq '^\[Licensing::Client\] Successfully returned ULF license with serial number[[:space:]]*:[[:space:]]*[^[:space:]]+$' "$RETURN_LOG" 2>/dev/null; then
      ulf_returned=true
    fi

    if [[ "$return_exit_code" == 0 && "$entitlement_returned" == true && "$ulf_returned" == true ]]; then
      if [[ -n "$PROOF_PATH" && -n "$PROOF_NONCE" ]]; then
        printf 'resource-safe=%s' "$PROOF_NONCE" >"$PROOF_PATH"
      fi
      echo 'Unity license return produced exact private cleanup evidence.'
    else
      echo '::warning::Unity license return lacked exact positive cleanup evidence.'
    fi
  fi
fi

# Return to previous working directory
trap - INT TERM
rm -f -- "$RETURN_ISOLATION_READY" "$RETURN_ISOLATION_ACK"
popd >/dev/null
if [[ "$return_status_write_failed" == true ]]; then
  echo '::error::Unable to persist the Unity return status after bounded teardown.'
  return 1 2>/dev/null || exit 1
fi
