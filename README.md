# Arduino CLI Wrapper (VS Code Extension)

VS Code extension to run Arduino CLI from the command palette and status bar with a smoother workflow: colored logs in a pseudo terminal, profile‑aware commands, and smart IntelliSense includePath updates during builds.

[日本語 README (Japanese)](README.ja.md)

## Features

- Arduino CLI: Show Version — runs `arduino-cli version`
- Arduino CLI: List Connected Boards — shows connected boards
- Arduino CLI: List All Boards (listall) — lists all boards; you can type a filter when running
  - The filter is passed as is to `arduino-cli board listall <filter>` (e.g., `atom`)
- Arduino CLI: Compile Sketch — pick a sketch to compile (FQBN can be specified)
- Arduino CLI: Clean Compile — compiles with `--clean`. At the start, it resets includePath to empty, then adds only the paths discovered during the build
- Arduino CLI: Upload Sketch — pick a sketch and upload with selected port and FQBN
- Arduino CLI: Monitor Serial — open a serial monitor (select port and baudrate)
- Arduino CLI: Create sketch.yaml — creates `sketch.yaml` in the sketch folder (appends dump‑profile’s profiles and sets default_profile to the profile matching the current FQBN)
  - See Arduino CLI docs “Sketch Project File”: https://arduino.github.io/arduino-cli/latest/sketch-project-file/
  - If FQBN is set, the result of `arduino-cli compile --dump-profile` (profiles section) is appended
- Arduino CLI: Board Details — when using profiles, passes the selected profile’s FQBN with `-b` to show details
- Arduino CLI: Run Command — run arbitrary Arduino CLI arguments

All command logs are unified to a dedicated pseudo terminal with ANSI colors.

## Status Bar

- `$(tools) Build`: compiles the `.ino` in the current workspace folder
- `$(cloud-upload) Upload`: uploads the `.ino` in the current workspace folder
- `$(pulse) Monitor`: opens the serial monitor
- `$(list-unordered) Boards`: shows connected boards (`arduino-cli board list`)
- `$(search) ListAll`: shows all boards (`arduino-cli board listall`, asks a filter on run)
- `$(circuit-board) <FQBN/Profile>`:
  - If `sketch.yaml` exists in the sketch folder, shows the default_profile (or the first profile) and lets you switch via “Arduino CLI: Set Profile”
  - If not, shows FQBN and lets you change via “Arduino CLI: Set FQBN”
- `$(plug) <Port>`: shows current serial port (click to change)
- `$(watch) <Baud>`: shows current baudrate (click to change)

Note: Status bar items are hidden when the workspace does not contain any `.ino` files.

FQBN/Port are stored per workspace and preserved after restart.

## Quick Start / Usage

1) Prepare arduino-cli
- Put it in `PATH` or set a full path in the extension setting `arduino-cli-wrapper.path`.
- Confirm with “Arduino CLI: Show Version” (a guide is shown if not configured).
 - On Windows: install via one of the following
   - Installer: https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Windows_64bit.msi
   - Command: `winget install ArduinoSA.CLI`
 - On Linux / macOS: follow the official installation guide
   - https://arduino.github.io/arduino-cli/latest/installation/

2) Open a sketch
- When you open a folder that contains `.ino`, the status bar shows Build/Upload/Monitor and FQBN/Port/Baud.

3) Build
- Use “Arduino CLI: Compile Sketch” or the Build button on the status bar.
- Set the FQBN when needed. IntelliSense settings are updated during the build.

4) Upload
- Use “Arduino CLI: Upload Sketch” or the Upload button.
- Select the serial port beforehand (even with profiles, a selected port is passed explicitly with `-p`).

5) Monitor
- Use “Arduino CLI: Monitor Serial” or the Monitor button.
- Baudrate can be changed from the status bar (default 115200).

### Baudrate

- Command: Arduino CLI: Set Baudrate
- You can also click the `$(watch) <Baud>` item in the status bar
- Port selection is based on the result of `arduino-cli board list` (if the chosen row has FQBN, it is set as well)

You can also use the Build/Upload buttons on the status bar for convenience.

Notes:
- Build/Upload targets “the `.ino` inside the currently opened workspace folder”. If there is an active `.ino` editor, it takes priority.
- When multiple `.ino` files exist, a Quick Pick appears to choose one.
- If the FQBN cannot be inferred from connected boards, you can enter it manually.

## Commands Summary

- Show Version / List Connected Boards / List All Boards (listall)
- Compile Sketch / Clean Compile (clean builds start empty)
- Upload Sketch (keeps the selected port and passes `-p` explicitly)
- Monitor Serial (`--config baudrate=<baud>`)
- Create sketch.yaml (append dump‑profile and set `default_profile`)
- Board Details (pass the profile’s FQBN using `-b`)
- Run Command (run arbitrary CLI arguments)

## sketch.yaml and Profiles

- When `sketch.yaml` exists, compile/upload prefer profiles.
- If `default_profile` is not set, the first profile name is proposed.
- “Create sketch.yaml” appends the `arduino-cli compile --dump-profile` result (profiles) and auto‑sets `default_profile`.
- On the status bar, the FQBN indicator switches to a profile name when `sketch.yaml` exists (click to “Set Profile”).

## IntelliSense Behavior

- During builds, parses `-I` / `-isystem` / `-iprefix` from the compiler lines and updates `.vscode/c_cpp_properties.json` (the `Arduino` configuration) without duplicates.
- Clean builds reset `includePath` at the beginning and add only the discovered paths.
- Language standards: for ESP32 family (`esp32`, `xtensa-esp32`, or `riscv32-esp-elf`), prefers `c17` / `c++23`.

## Settings

- `arduino-cli-wrapper.path`: Path to the arduino-cli executable
- `arduino-cli-wrapper.additionalArgs`: Extra arguments appended to every invocation (array)
- `arduino-cli-wrapper.verbose`: Adds `--verbose` to compile/upload

## Requirements

- VS Code 1.84.0+
- Arduino CLI installed locally

## Troubleshooting

- Executable not found: set a full path in `arduino-cli-wrapper.path`.
- Board not detected: check cable/driver/port, and run “Arduino CLI: List Connected Boards” to inspect.

## License

This project is provided under CC0 1.0 Universal (Public Domain Dedication). See `LICENSE` for details.
