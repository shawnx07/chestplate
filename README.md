# Readme written by AI

# Chestplate

A friendly desktop control panel for **Minecraft servers that run on your own PC**.
No `start.bat`, no hunting for jars, no console window — pick a version, click Create, click Start.

It looks and feels like a modern hosting panel, but everything stays on your computer.

## Install (Windows)

1. Unzip the download.
2. Double-click **Install Chestplate.bat** and approve the permission prompt.
3. Open **Chestplate** from the Start menu or Desktop.

Chestplate installs to `C:\Program Files\Chestplate`. Every server you create lives in
`C:\Program Files\Chestplate\servers\<server name>` (the installer lets normal users write there, so no
admin prompts later). If Node.js isn't on your PC, the installer downloads a private copy for Chestplate only.

Prefer not to install? **Run without installing.bat** starts it straight from the folder (needs Node.js 18.15+;
data goes to `%LOCALAPPDATA%\Chestplate`).

Uninstall from *Settings → Apps*, or run `uninstall.ps1`. Your servers are kept unless you choose to delete them.

## What you get

**First launch** — enter your Minecraft username (optionally lock Chestplate with a PIN). It's used for the quick OP / whitelist buttons.

**Servers tab** — create servers, see them as a **Grid**, **List** or **Bars**, styled like Minecraft's multiplayer list
(icon, coloured MOTD, player count). No servers yet? Chestplate points you at the Create button.
Supported software: **Paper, Purpur, Vanilla, Fabric**, or **your own jar** (Forge, NeoForge, Folia…).
Chestplate downloads the jar, verifies its checksum, and installs the right **Java** automatically
(a private Eclipse Temurin copy — your system Java is never touched).

**Per-server tabs**
- **Console** — Start / Stop / Restart, live output with filtering, command history, and quick-command buttons.
  The OP and whitelist buttons *toggle* (OP ⇄ DeOP, Whitelist ⇄ Unwhitelist, whitelist on/off) based on the server's real state.
  Add your own buttons in *Settings → Console shortcuts*.
- **Players** — who's online, operators, whitelist and bans, with one-click actions.
- **Files** — open the server folder in File Explorer, plus a quick browser/editor for text configs.
- **Backups** — one-click world or full backups, restore, download.
- **Settings** — name, description (MOTD with colour codes), icon (`server-icon.png`), folder name, **every** `server.properties`
  option as toggles / numbers / dropdowns (searchable), and an **Advanced** section: jar file, run command, Java path,
  min/max RAM, CPU limit, storage limit, JVM flags, auto-restart, reinstall, copy and delete.

**Appearance** — Glow (default, blue-lit like the hero bands), Cosmic (stars, nebula, shooting stars, parallax), Gradient, Solid or Image backgrounds; dark / light / system theme;
gradient colours, angle and where they're applied; transparency/glass with opacity and blur; roundness, density, text size,
animations; presets. Everything previews live.

**Settings** — default memory, first-start popups (OP me / whitelist me / enable whitelist), ask for a folder on every create,
auto-accept the EULA, and defaults for new servers (view-distance, simulation-distance, online-mode, hardcore, difficulty, …).

## Notes

- Creating a server needs an internet connection (to download the server and, if needed, Java). Running one doesn't.
- Closing the Chestplate window quits it automatically when no server is running; servers that are running keep Chestplate alive.
  Change this in *Settings → General → Chestplate window*.
- Chestplate only listens on `127.0.0.1` and refuses requests from other websites.
- Windows Firewall will ask about Java the first time a server starts — allow it if friends should be able to join on your network.
- By turning on "accept the EULA automatically" you agree to the [Minecraft EULA](https://aka.ms/MinecraftEULA).

## Run from source / develop

```
node server.js            # opens the app window
node server.js --no-window
npm test                  # backend tests (uses a fake Minecraft server, no internet needed)
```
Environment: `CHESTPLATE_HOME` (data folder), `CHESTPLATE_PORT` (default 4545).
