# Arduino CLI Wrapper (VS Code Extension)

VS Code extension to run Arduino CLI from the command palette, status bar, and an Explorer view. It streams colored logs to a pseudo terminal, supports sketch.yaml profiles, and updates IntelliSense includePath during builds.

## Concept

This extension brings the Arduino CLI—normally invoked under the hood of the Arduino IDE—into VS Code so you can reach feature parity (and more) without leaving your editor. By leaning on Arduino CLI profiles, you can pin different versions of platforms and libraries per project through `sketch.yaml`, something that is hard to maintain inside the IDE alone. The helper UIs guide you through editing those profiles and even compare them with the latest releases to suggest upgrades.

Because you are already working inside VS Code, the extension connects build results with the Microsoft C/C++ extension: include paths, IntelliSense, diagnostics, and the generated `compile_commands.json` all stay in sync with each compile. You also get a workspace-focused warnings mode that filters out noise from third-party cores (addressing the IDE’s `none` default), plus exclusive utilities such as the ESP32 data uploader and the Inspector for analysing map and artifact files.

The goal is to make Arduino CLI approachable for beginners while unlocking the advanced workflows—multiple dependency versions, rich IntelliSense, and build automation—that seasoned users expect.

![Arduino CLI Wrapper overview](images/main.png)

*The Explorer view keeps sketches, profiles, and common actions together so you can launch tasks with a click.*

[日本語READMEはこちら](README.ja.md)

## Features

### Getting started with commands (Command Palette)

Press **Ctrl+Shift+P** (or **Cmd+Shift+P** on macOS) and type “Arduino CLI:” to see the commands below. Each one carries a short description in the palette, but the summaries here walk through what to expect on your very first run.

- **Check CLI Version** – Confirms that `arduino-cli` is installed and reachable. If it is missing, the extension shows a friendly setup guide.
- **List Connected Boards** – Scans USB/serial ports and shows the detected boards so you can double‑check the connection before you upload.
- **List All Boards** – Displays the complete board index. You can type a search word (for example `nano`) to narrow the list, just like running `arduino-cli board listall <filter>` manually.
- **Board Details** – Shows the technical info for the currently selected profile/FQBN, making it easy to verify you picked the right board package.

### Build and upload workflow

- **Compile Sketch** – Builds the selected sketch. If the folder contains several `.ino` files, a picker helps you choose the right one. Profiles from `sketch.yaml` are applied automatically; otherwise the saved FQBN is used.
- **Clean Compile** – Runs the same build with `--clean`, resets IntelliSense include paths, and is handy when switching libraries or boards.
- **Upload Sketch** – Compiles and uploads in one go. You will be prompted for a serial port if one is not already selected, and the monitor is closed/reopened as needed so the port stays free.
- **Upload Data (ESP32)** – Looks for a `data/` folder, creates a LittleFS or SPIFFS image, and flashes it. Perfect for web assets or configuration files bundled with your sketch.
- **Build Check** – Compiles every profile defined in `sketch.yaml` with full warnings (`--warnings all`), then shows a summary of warnings and errors so you can spot regressions quickly.

### Keep sketches organised

- **Sketch.yaml Helper** – Opens a helper view where you can review or update board packages, platforms, and libraries without editing YAML by hand.
- **Check Sketch.yaml Versions** – Audits every profile against the official indexes and offers inline upgrades when newer versions are available.
- **New Sketch** – Creates a fresh sketch folder, opens the generated `.ino`, and launches the helper so you can configure profiles immediately.

![Sketch.yaml Helper webview](images/sketch.yaml_helper.png)

*Use the Sketch.yaml Helper to edit profiles without touching raw YAML.*

![Sketch.yaml version comparison](images/sketch.yaml_versions.png)

*See which platforms and libraries have updates pending and apply them in place.*

### Explore examples quickly

- **Browse Examples** – Opens a tree of every example sketch exposed by your installed cores and libraries. Unlike the Arduino IDE, you can preview the source before opening it in the editor.
- **Filter by name or folder** – Use the quick filter box to narrow the list by file or directory names when you already know what you are looking for.
- **Search inside sketches** – Switch to the built-in grep mode to filter examples by the text they contain (for instance, type `rgb` to find examples that manipulate RGB LEDs or look for a specific function call).
- **Open with one click** – Once the preview matches what you need, open it directly in the editor and start adapting it to your project.

![Examples browser with preview and search](images/examples.png)

*Browse, filter, and preview Arduino examples without leaving VS Code.*

### Fine-tune your tooling

- **Monitor Serial** – Opens a serial terminal with selectable port and baudrate (default 115200). Helpful tips appear if the port is busy.
- **Configure IntelliSense** – Regenerates `.vscode/c_cpp_properties.json` using the latest compiler flags without running a build.
- **Run Command** – Lets you pass custom arguments straight to `arduino-cli` when you need an advanced flag that the UI does not expose.
- **Inspector** – Examines the generated map file, ELF sections, and other build artifacts so you can understand memory usage at a glance.
- **Status controls in the status bar** – Toggle warning levels (`none`, `workspace`, `default`, `more`, `all`) and the `--verbose` switch. The badge (for example `all+V`) updates instantly.
- **Include Order Lint** – Watches `.ino` files and warns if filesystem headers appear before M5GFX headers, catching a common runtime pitfall.

![Inspector analysing build artifacts](images/inspector.png)

*Run the Inspector after a build to review memory usage and section breakdowns.*

All command logs are unified in a dedicated pseudo terminal with ANSI colors so you can follow the exact CLI invocation.

## Explorer View

- Adds an "Arduino CLI" view under Explorer.
- Lists detected sketch folders; shows profiles from `sketch.yaml` when available.
- Per project/profile actions: Compile, Upload, Upload Data, Monitor, Sketch.yaml Helper, Open Examples.
- Global actions at the top: CLI Version, List Boards, List All Boards, Sketch.yaml Helper, Refresh View, New Sketch, Run Command.
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
- Confirm with "Arduino CLI: Check CLI Version" (a guide appears if not configured).
  - Windows: installer https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Windows_64bit.msi or `winget install ArduinoSA.CLI`
  - Linux / macOS: follow https://arduino.github.io/arduino-cli/latest/installation/

2) Open a sketch folder
- When a folder contains `.ino`, the status bar shows Compile/Upload/Monitor plus FQBN/Port/Baud/Warn.

3) Compile / Upload / Monitor
- Build: run "Arduino CLI: Compile Sketch" or click Compile.
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
- "Sketch.yaml Helper" shows a helper UI to inspect/apply FQBN, libraries, and platform info for a selected profile.

## IntelliSense

- During builds, the extension parses compiler lines (`-I`, `-isystem`, `-iprefix`) and updates `.vscode/c_cpp_properties.json` (configuration `Arduino`). While the build runs, it only appends newly discovered paths to minimize churn; when the build finishes, it prunes unused and non-existent entries.
- Clean builds reset `includePath` first, then add only discovered paths.
- For ESP32 family (esp32/xtensa-esp32/riscv32-esp-elf), it prefers `c17` / `c++23`.
- "Configure IntelliSense" computes include paths and writes `c_cpp_properties.json` without triggering a build.

### compile_commands.json for clangd and CMake Tools

If you use tools such as clangd, CMake Tools, or the VS Code C/C++ extension in "use compile commands" mode, you can point them at the file generated by this extension.

1. Run **Arduino CLI: Compile Sketch** at least once so the build output is available.
2. The wrapper writes `.vscode/compile_commands.json` next to your workspace root. Each time you build, the file is refreshed automatically.
3. Every command from the Arduino CLI build and from your workspace sources is included—headers in the sketch folder, generated sources under the build directory, and more.
4. Entries produced from temporary `.ino.cpp` files are rewritten to the original `.ino` filename, and the `file` column only keeps the file name (no absolute paths). This keeps diffs stable when the workspace lives in different locations.

Point clangd or other tools to `<workspace>/.vscode/compile_commands.json` and they will pick up the same flags the Arduino CLI used, without extra configuration.

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


