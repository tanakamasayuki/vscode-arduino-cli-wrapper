# Arduino CLI Wrapper (VS Code Extension)

VS Code extension to run Arduino CLI with a better workflow: colored logs in a pseudo terminal, profile‑aware commands, and smart IntelliSense includePath updates during builds.

[日本語 README (Japanese)](README.ja.md)

## Features

- Show Version / List Connected Boards / List All Boards (with optional filter)
- Compile Sketch / Clean Compile (`--clean` and includePath reset at start)
- Upload Sketch (keeps selected serial port; passes `-p` explicitly)
- Monitor Serial (set baudrate from the status bar)
- Create sketch.yaml (appends dump‑profile, sets `default_profile`)
- Board Details (passes `-b <fqbn>`; uses the selected profile’s FQBN when profiles exist)
- Run Command (run arbitrary Arduino CLI arguments)

All command logs are printed to a dedicated pseudo terminal with ANSI colors.

## Status Bar

- Build / Upload / Monitor buttons appear only when the workspace contains a `.ino` file.
- FQBN or profile indicator (switch between FQBN and `sketch.yaml` profiles)
- Current serial port and baudrate

FQBN/port selection is stored per workspace.

## IntelliSense

- During builds, parses `-I`, `-isystem`, and `-iprefix` to update `.vscode/c_cpp_properties.json` (`Arduino` configuration) without duplicates.
- Clean builds start with an empty `includePath` and then add only discovered include paths.
- For ESP32 family, prefers `c17` and `c++23` standards.

## Settings

- `arduino-cli-wrapper.path`: Path to `arduino-cli`
- `arduino-cli-wrapper.additionalArgs`: Extra arguments appended to every call
- `arduino-cli-wrapper.verbose`: Adds `--verbose` to compile/upload

## Requirements

- VS Code 1.84.0+
- Arduino CLI installed locally

## License

CC0 1.0 Universal (Public Domain Dedication). See `LICENSE` for details.
