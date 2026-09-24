# AM Pet

AM Pet is a small cross-platform Electron desktop pet for macOS, Windows, and Linux.

The app displays a transparent, frameless, always-on-top pet window. The current character uses preprocessed transparent PNG frame sequences generated from the `.mov` clips in the parent project folder.

## Current Features

- Transparent desktop pet with idle, click, drag, position memory, lock, click-through, always-on-top, tray, and auto-launch settings.
- Search panel with Google, Bing, and Baidu engines. Open it by double-clicking the pet or pressing `Ctrl + Shift + Space` by default.
- Clipboard search and translation: read copied text into the panel, then search it or open it in Google Translate.
- Translation mode with source/target language selection, automatic language detection, and persisted language preferences.
- Reminder center with water, stretch, eye-rest, and "pet me" reminders. Intervals can be set from 1 to 1440 minutes and reminders continue while the panel is hidden.
- "Pet me" reminder: if the pet is not clicked or dragged for the configured time, it sends a water/rest reminder. Default: enabled, 90 minutes.
- Pomodoro MVP: 25-minute focus and 5-minute break cycles with start, pause, reset, skip, and system notifications.
- Settings panel for size, opacity, animation speed, locking, click-through, always-on-top, behavior-related state, search shortcut, and reminder access.
- AI chat MVP in the search panel with persisted OpenAI-compatible Base URL, model, system prompt, temperature, max-token, and API-key settings.

## What You Need

### Required to run the app

- Node.js 18 or newer
- npm 9 or newer
- Internet access the first time you run `npm install`, because Electron must be downloaded

### Required only when changing video assets

- FFmpeg
- ImageMagick 7, with the `magick` command available

If you only want to run the included pet and the `src/assets/frames` folder is already present, FFmpeg and ImageMagick are not needed.

## macOS Setup

Install Node.js:

```bash
brew install node
```

Install video preprocessing tools, only needed if changing `.mov` assets:

```bash
brew install ffmpeg imagemagick
```

Run the app:

```bash
cd am_pet
npm install
npm start
```

If Electron did not download correctly:

```bash
npx install-electron --no
npm start
```

Regenerate transparent frames after changing the source videos:

```bash
npm run preprocess
```

Build a macOS DMG:

```bash
npm run dist:mac
```

## Windows Setup

Install Node.js 18+ from:

```text
https://nodejs.org/
```

Open a new PowerShell window after installation and check:

```powershell
node --version
npm --version
```

Install video preprocessing tools, only needed if changing video assets. Recommended with winget:

```powershell
winget install Gyan.FFmpeg
winget install ImageMagick.ImageMagick
```

If `ffmpeg` or `magick` is still not found, close and reopen PowerShell.

Run the app:

```powershell
cd am_pet
npm install
npm start
```

If Electron did not download correctly:

```powershell
npx install-electron --no
npm start
```

Regenerate transparent frames after changing the source videos:

```powershell
npm run preprocess
```

Build Windows installer and portable app:

```powershell
npm run dist:win
```

## Linux / Ubuntu Setup

Linux support targets X11/Xwayland. The app starts Electron with `--ozone-platform=x11` by default on Linux because native Wayland restricts the window positioning behavior desktop pets need.

Install dependencies on Ubuntu:

```bash
sudo apt update
sudo apt install -y nodejs npm ffmpeg imagemagick
```

If Ubuntu's apt version of Node.js is older than 18, install Node.js using nvm or NodeSource instead.

Run the app:

```bash
cd am_pet
npm install
npm start
```

If Electron did not download correctly:

```bash
npx install-electron --no
npm start
```

Regenerate transparent frames after changing the source videos:

```bash
npm run preprocess
```

Build Linux AppImage and deb packages:

```bash
npm run dist:linux
```

## AI Chat Setup

AM Pet uses the OpenAI-compatible `POST /chat/completions` API. Open the pet menu and choose `AI 对话...`, or open `设置` and use the AI card.

Typical configurations:

| Service | Base URL | Notes |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | Enter a model such as `gpt-4o-mini`. |
| DeepSeek | `https://api.deepseek.com/v1` | Enter a model supported by your account. |
| OpenRouter | `https://openrouter.ai/api/v1` | Enter the full OpenRouter model ID. |
| Ollama | `http://localhost:11434/v1` | API Key may be left empty for a local service. |
| OneAPI / compatible gateway | Your gateway URL ending in `/v1` | Use the model name exposed by the gateway. |

Configuration rules:

- `Base URL` may end in `/v1`, or may already be the full `/chat/completions` URL.
- API keys are sent only to the configured service. AM Pet does not send them to the renderer.
- On supported systems the key is encrypted with Electron `safeStorage`. If secure storage is unavailable, the settings panel shows a warning and the key is stored locally in plain text as a fallback.
- AI requests require Internet access, and usage may incur charges from the selected provider.
- The MVP returns a complete response at once and keeps the current conversation only in memory. It does not persist chat history or expose streaming output yet.

For provider-local testing, run:

```powershell
node scripts/test-ai-provider.js
```
## Changing the Character

The current app expects these frame folders:

```text
src/assets/frames/idle
src/assets/frames/jump
src/assets/frames/shake
src/assets/frames/shake2
src/assets/frames/shy_shake
```

Each folder contains numbered transparent PNG files:

```text
001.png
002.png
003.png
...
```

The included preprocessing command reads the parent folder videos:

```text
../idle.mov
../jump.mov
../shake.mov
../shake2.mov
../shy_shake.mov
```

Then it outputs transparent frames into `src/assets/frames`.

Run it after replacing those `.mov` files:

```bash
npm run preprocess
```

For a one-off source video with any solid background color, use the helper skill/script in the project root:

```bash
node ../extract_chars_for_pet/scripts/extract_pet_frames.js \
  --video /path/to/source.mov \
  --bg "#ffffff" \
  --state idle
```

The script writes a folder next to the video named:

```text
<video basename>_pet_frames
```

Copy that folder into the app state you want to replace:

```bash
rm -rf src/assets/frames/idle
cp -R /path/to/source_pet_frames src/assets/frames/idle
npm run manifest
npm start
```

On Windows PowerShell:

```powershell
Remove-Item -Recurse -Force src\assets\frames\idle
Copy-Item -Recurse C:\path\to\source_pet_frames src\assets\frames\idle
npm run manifest
npm start
```

The current preprocessing strategy is conservative:

- Extract frames with FFmpeg.
- Remove only background pixels connected to the image edges.
- Use `1%` color tolerance to avoid cutting holes into the white parts of the pet.
- Apply light alpha feathering to soften the edge.

## Interaction Mapping

- Idle: loops `idle` frames.
- Click upper third of the pet: plays `jump`, then returns to idle.
- Click middle third of the pet: randomly plays `shake`, `shake2`, or `shy_shake`, then returns to idle.
- Drag the pet: move it around the desktop.
- Right-click the pet: open the context menu.

## Useful Commands

```bash
npm install          # install app dependencies
npm start            # run the desktop pet
npm run preprocess   # regenerate transparent frames from source videos
npm run manifest     # rebuild frame counts after manually replacing frame folders
npm run dist:mac     # build macOS package
npm run dist:win     # build Windows package
npm run dist:linux   # build Linux package
```

## Notes

- If the pet starts but the transparent area blocks clicks, restart the app once. Click-through behavior can vary by desktop environment.
- On Linux, use an X11 or Xwayland session for best results.
- On macOS, the first launch of a downloaded build may require right-clicking the app and choosing Open.
