# CodeSurf Host And Daemon Architecture

## Core model

- `Workspace`: top-level canvas tab and layout container
- `Project`: mounted folder or repo inside a workspace
- `Thread`: chat/session attached to a project
- `Host`: where a thread executes

## Host types

- `runtime`
  - Electron main process executes the task in-process
  - fallback path when no daemon is available
- `local-daemon`
  - detached daemon on the same machine executes the task
  - preferred local execution path
- `remote-daemon`
  - registered remote daemon executes the task off-machine
  - cloud/offload path

## Routing policy

Execution routing is stored in `settings.execution`:

- `auto`
  - prefer `local-daemon`
  - fall back to `runtime`
- `prefer-local-daemon`
  - same behavior as `auto`, but semantically explicit
- `runtime-only`
  - never leave Electron
- `daemon-only`
  - require daemon execution, falling back only if no viable daemon exists
- `specific-host`
  - pin new work to one registered host

## Persistence

Host registry is stored separately from workspaces and settings:

- `~/.codesurf/hosts/hosts.json`
- `~/.codesurf/settings.json`
- `~/.codesurf/projects/projects.json`
- `~/.codesurf/workspaces/workspaces.json`

This separation keeps infrastructure state independent from UI state.

## Built-in hosts

The daemon always materializes two built-ins:

- `local-runtime`
- `local-daemon`

Remote daemons are user-managed entries layered on top.

## Current implementation status

Implemented now:

- shared types for execution hosts and routing preference
- daemon-backed host registry
- IPC bridge for list/upsert/delete/resolve
- settings UI for execution preference and remote host registration
- router contract for choosing the effective host

Not implemented yet:

- daemon-owned chat/job execution
- reconnectable append-only job timelines
- remote repo provisioning
- remote streaming transport

## Next phase

The next phase is moving chat execution from `src/main/ipc/chat.ts` into daemon-owned jobs:

1. create `jobs/<job-id>.json`
2. append timeline events in `timelines/<job-id>.jsonl`
3. subscribe renderer to job streams
4. keep Electron as a client/controller only
5. allow local daemon and remote daemon jobs to continue after Electron exits
