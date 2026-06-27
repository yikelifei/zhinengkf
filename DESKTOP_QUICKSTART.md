# Desktop Startup Quickstart

This project now has a desktop customer service app under:

```text
desktop/
```

Use these files from the project root:

```bat
run_desktop.bat
stop_desktop.bat
check_desktop.bat
repair_desktop.bat
verify_desktop.bat
run_desktop_real_design.bat
check_desktop_real_design.bat
```

## Start

Double click:

```bat
run_desktop.bat
```

The launcher will:

1. Check Node.js and npm.
2. Install dependencies on the first run if `desktop\node_modules` is missing.
3. Clean old desktop service processes from ports `3100`, `3200`, and `3700`.
4. Run a foreground preflight check. Ports `3100`, `3200`, and `3700` must be
   free before the app starts.
5. Build the NestJS API.
6. Start the web workbench, API, and mock design platform in one foreground
   window.

Keep the startup window open while using the app. Closing that window stops the
local web/API/mock services.

Default startup always uses the local mock design platform:

```text
DESIGN_PLATFORM_ADAPTER=standard_v1
DESIGN_PLATFORM_BASE_URL=http://127.0.0.1:3700
```

Use this mode first when you only need the customer service platform to open
stably.

## Real Design Platform Mode

Only use this after the real design platform is already running on port 3000:

```bat
run_desktop_real_design.bat
```

This also runs in foreground mode. Keep its startup window open while using the
app. Closing that window stops the local web/API services for real design mode.

Check that mode with:

```bat
check_desktop_real_design.bat
```

This mode uses:

```text
DESIGN_PLATFORM_ADAPTER=art_image_local
DESIGN_PLATFORM_BASE_URL=http://127.0.0.1:3000
```

If you switch between default mode and real design mode, run
`stop_desktop.bat` first, then start the mode you want.

## Service URLs

```text
Customer workbench:      http://127.0.0.1:3100/
NestJS API health:       http://127.0.0.1:3200/api/health
Mock design health:      http://127.0.0.1:3700/v1/health
Runtime logs:            desktop\.runtime\logs
```

## Stop

Double click:

```bat
stop_desktop.bat
```

It will request Administrator permission automatically when Windows needs it
to stop occupied ports.

## Diagnose

Double click this when the browser cannot open the app, or when a port looks
wrong:

```bat
check_desktop.bat
```

It prints Node.js and npm versions, launcher records, port owners, service
health, and recent logs when a service is not reachable.

## Verify Startup

Double click this when you want to test whether the desktop app can start cleanly
without leaving services running:

```bat
verify_desktop.bat
```

It checks the default mock-mode ports, temporarily starts the web workbench, API,
and mock design platform, verifies all three health URLs, then shuts them down
and confirms the ports are free again.

## Repair Default Startup

Double click this when the app does not open after a normal start, or after
switching between default mode and real design mode:

```bat
repair_desktop.bat
```

It runs this sequence:

```text
stop old desktop services
check default mock-mode ports
build the API
```

It requests Administrator permission automatically when Windows needs it to stop
occupied ports.

After repair finishes, run:

```bat
run_desktop.bat
```

The app itself should run from `run_desktop.bat`, because that keeps the web,
API, and mock design platform in one foreground window.

## Mode Mismatch

Default stable mode uses the mock design platform on port `3700`.
Real design platform mode uses your real design app on port `3000`.

If `check_desktop.bat` reports a design integration adapter or base URL
mismatch, do this:

```text
Use the app without the real design platform:
  run repair_desktop.bat

Use the real design platform:
  start the real design platform first
  run stop_desktop.bat
  run run_desktop_real_design.bat
```

If port `3200` is occupied by the wrong mode, run `stop_desktop.bat`, approve
the Administrator prompt, then start the mode you want again. That port is the
API service and it must be restarted when changing modes.

## Check Status Manually

```bat
cd desktop
npm.cmd run ports:status
```

For a deeper check:

```bat
cd desktop
npm.cmd run ports:doctor
```

To repair and restart default mode from the terminal:

```bat
cd desktop
npm.cmd run ports:repair
```

For real design platform mode:

```bat
cd desktop
npm.cmd run ports:doctor:real
```

## Start Manually

```bat
cd desktop
npm.cmd run ports:preflight:mock
npm.cmd run ports:preflight:mock:free
npm.cmd run ports:start
npm.cmd run ports:status
```

## Stop Manually

```bat
cd desktop
npm.cmd run ports:stop
```

## Reset Demo Data

Only run this when you intentionally want to clear local demo data:

```bat
cd desktop
npm.cmd run data:reset
```

## Ports

```text
3100 = Next.js customer workbench
3200 = NestJS API
3700 = mock design platform
```

If one of these ports is blocked, run `stop_desktop.bat` first. If it still
fails, close the listed PID in Task Manager or run the stop file as
administrator.
