# Arduino CLI Wrapper (VS Code Extension)

VS Code extension to run Arduino CLI from the command palette, status bar, and an Explorer view. It streams colored logs to a pseudo terminal, supports sketch.yaml profiles, and updates IntelliSense includePath during builds.

[日本語READMEはこちら](README.ja.md)

## Features

- Show Version: runs `arduino-cli version`
- List Connected Boards: shows connected boards
- List All Boards (listall): lists all boards; accepts an optional filter passed to `arduino-cli board listall <filter>`
- Compile Sketch: pick a sketch to compile (uses profile or FQBN)
- Clean Compile: compiles with `--clean`; resets includePath first, then adds only paths discovered during the build
- Build Check: compiles every profile from each sketch.yaml with `--warnings=all` and aggregates warnings/errors
- Version Check: scans each sketch.yaml profile to compare platform/library versions with the published indexes and offers inline updates
- Status Controls: change compile warning level and verbose output straight from the status bar (e.g. `all+V`)
- Upload Sketch: builds then uploads with selected port and profile/FQBN; closes and reopens monitor if needed
- Monitor Serial: open a serial monitor (select port and baudrate)
- Open Helper: open a sketch.yaml helper webview to inspect/apply profiles/libraries
- Board Details: when using profiles, passes the profile's FQBN with `-b`
- Run Command: run arbitrary Arduino CLI arguments
- Configure IntelliSense: compute include paths and write `.vscode/c_cpp_properties.json` without building
- Include Order Lint: highlight when filesystem headers are included after M5GFX headers in `.ino` files
- Upload Data (ESP32): build LittleFS/SPIFFS image from `data/` and flash via esptool
- New Sketch: create a new Arduino sketch folder


All command logs are unified in a dedicated pseudo terminal with ANSI colors.

## Explorer View

- Adds an "Arduino CLI" view under Explorer.
- Lists detected sketch folders; shows profiles from `sketch.yaml` when available.
- Per project/profile actions: Compile, Upload, Upload Data, Monitor, Open Helper, Open Examples.
- Global actions at the top: Version, List Boards, List All Boards, Open Helper, Refresh View, New Sketch, Run Command.
- Sketch items display workspace-relative paths, and nodes are expanded by default.

## Status Bar

- `$(tools) Compile`: compiles the `.ino` in the current workspace folder
- `$(cloud-upload) Upload`: uploads the `.ino` in the current workspace folder
- `$(pulse) Monitor`: opens the serial monitor
- `$(circuit-board) <FQBN/Profile>`:
  - If `sketch.yaml` exists, shows the default or first profile and lets you switch via "Arduino CLI: Set Profile".
  - Otherwise shows FQBN and lets you change via "Arduino CLI: Set FQBN".
- `$(plug) <Port>`: shows current serial port (click to change)
- `$(watch) <Baud>`: shows current baudrate (click to change)
- `$(megaphone) <Warnings>`: shows compile warnings/verbose badge (click to pick combinations)

Status bar items are hidden when the workspace has no `.ino` files. FQBN/Port/Baud are stored per workspace and persist across restarts.

## Quick Start

1) Install Arduino CLI
- Put it in `PATH` or set a full path in the setting `arduino-cli-wrapper.path`.
- Confirm with "Arduino CLI: Show Version" (a guide appears if not configured).
  - Windows: installer https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Windows_64bit.msi or `winget install ArduinoSA.CLI`
  - Linux / macOS: follow https://arduino.github.io/arduino-cli/latest/installation/

2) Open a sketch folder
- When a folder contains `.ino`, the status bar shows Compile/Upload/Monitor plus FQBN/Port/Baud/Warn.

3) Build / Upload / Monitor
- Build: run "Arduino CLI: Compile Sketch" or click Build.
- Upload: run "Arduino CLI: Upload Sketch" or click Upload. Select the serial port first; the extension passes `-p` explicitly even when using profiles.
- Monitor: run "Arduino CLI: Monitor Serial" or click Monitor. Baudrate defaults to 115200 and can be changed from the status bar.

Tips:
- If multiple `.ino` files exist, a picker appears to choose one. If an `.ino` editor is active, it is preferred.
- If the FQBN cannot be inferred, you can enter one manually.

## Upload Data (ESP32)

- Requires a `data/` folder under your sketch directory and an ESP32 filesystem include in the sketch (`#include <LittleFS.h>` or `#include <SPIFFS.h>`).
- Builds an image via `mklittlefs` or `mkspiffs` and flashes it with `esptool` to the SPIFFS partition.
- Reads tool paths and upload speed from `arduino-cli compile --show-properties` and parses `partitions.csv` in the build output to find offset/size.
- Closes an open serial monitor before flashing and reopens it after.

## sketch.yaml and Profiles

- When `sketch.yaml` exists, compile/upload use profiles; otherwise FQBN is used.
 - To bootstrap a `sketch.yaml`, use the Helper view to generate a template for your board and libraries, then copy it into a new `sketch.yaml` in your sketch folder.
- The status bar FQBN indicator switches to a profile name if profiles exist. Use "Arduino CLI: Set Profile" to change it.
- "Open Helper" shows a helper UI to inspect/apply FQBN, libraries, and platform info for a selected profile.

## IntelliSense

- During builds, the extension parses compiler lines (`-I`, `-isystem`, `-iprefix`) and updates `.vscode/c_cpp_properties.json` (configuration `Arduino`). While the build runs, it only appends newly discovered paths to minimize churn; when the build finishes, it prunes unused and non-existent entries.
- Clean builds reset `includePath` first, then add only discovered paths.
- For ESP32 family (esp32/xtensa-esp32/riscv32-esp-elf), it prefers `c17` / `c++23`.
- "Configure IntelliSense" computes include paths and writes `c_cpp_properties.json` without triggering a build.

## Settings

- `arduino-cli-wrapper.path`: Path to the `arduino-cli` executable
- `arduino-cli-wrapper.additionalArgs`: Extra arguments appended to every invocation (array)
- `arduino-cli-wrapper.verbose`: Adds `--verbose` to compile/upload (mirrors the status bar toggle)
- `arduino-cli-wrapper.compileWarnings`: Warning level passed to `arduino-cli compile` (`--warnings`, mirrors the status bar toggle)
- `arduino-cli-wrapper.lint.m5gfxIncludes`: Header list treated as M5GFX family for include-order linting
- `arduino-cli-wrapper.lint.fsIncludes`: Header list treated as filesystem-related for include-order linting

## Include Order Lint

- Applies to `.ino` files in the workspace.
- When an M5GFX header (from `arduino-cli-wrapper.lint.m5gfxIncludes`) appears before a filesystem header (from `arduino-cli-wrapper.lint.fsIncludes`) in the same translation unit, the extension emits an error diagnostic.
- The default header lists cover the common M5GFX and filesystem headers; customize them per project via the settings above.
- Diagnostics refresh automatically as documents change or when the settings are updated.

## Requirements

- VS Code 1.84.0+
- Arduino CLI installed locally

## Troubleshooting

- Executable not found: set a full path in `arduino-cli-wrapper.path`.
- Board not detected: check cable/driver/port, and run "Arduino CLI: List Connected Boards".
- Upload Data: ensure `data/` exists and the sketch includes `SPIFFS.h` or `LittleFS.h`.

## Third-Party Notices

- Highlight.js (core, cpp grammar, VS2015 theme) (c) 2006-2023 the highlight.js authors, BSD-3-Clause. [License](https://github.com/highlightjs/highlight.js/blob/main/LICENSE)

## License

CC0 1.0 Universal (Public Domain Dedication). See `LICENSE`.
