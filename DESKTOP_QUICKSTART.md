# Desktop Startup Quickstart

## Daily Startup

For normal local use, only use these three files from the project root:

```bat
启动智能客服.cmd
停止智能客服.cmd
检查智能客服.cmd
```

Double click `启动智能客服.cmd`. It stops old managed services, resets local
development mode, starts the web/API/mock design services on `3100/3200/3700`,
and opens the desktop window.

If the desktop window does not appear, open:

```text
http://127.0.0.1:3100/overview
```

Default local development mode uses the mock design platform:

```text
DESIGN_PLATFORM_ADAPTER=standard_v1
DESIGN_PLATFORM_BASE_URL=http://127.0.0.1:3700
```

Only use `run_desktop_real_design.bat` after the real design platform is already
running on `http://127.0.0.1:3000`. Older English launch files are compatibility
wrappers or diagnostics, not the daily entry.

This project now has a desktop customer service app under:

```text
desktop/
```

Compatibility files from the project root:

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
启动智能客服.cmd
```

The launcher will:

1. Check Node.js and npm.
2. Install dependencies on the first run if `desktop\node_modules` is missing.
3. Stop old managed desktop service processes from ports `3100`, `3200`, and
   `3700`.
4. Start the web workbench, API, and mock design platform in managed background
   mode.
5. Open the desktop window at `http://127.0.0.1:3100/overview`.

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
`停止智能客服.cmd` first, then start the mode you want.

## Service URLs

```text
Customer workbench:      http://127.0.0.1:3100/overview
NestJS API health:       http://127.0.0.1:3200/api/health
Mock design health:      http://127.0.0.1:3700/v1/health
Runtime logs:            desktop\.runtime-stable\logs
```

## Stop

Double click:

```bat
停止智能客服.cmd
```

It will request Administrator permission automatically when Windows needs it
to stop occupied ports.

## Diagnose

Double click this when the browser cannot open the app, or when a port looks
wrong:

```bat
检查智能客服.cmd
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

`启动智能客服.cmd` already performs the normal repair/start sequence: it stops
old managed services, resets default local mode, starts the managed runtime, and
opens the desktop window. Use `检查智能客服.cmd` only when startup still fails and
you need the diagnostic output.

## Mode Mismatch

Default stable mode uses the mock design platform on port `3700`.
Real design platform mode uses your real design app on port `3000`.

If `检查智能客服.cmd` reports a design integration adapter or base URL
mismatch, do this:

```text
Use the app without the real design platform:
  run 启动智能客服.cmd

Use the real design platform:
  start the real design platform first
  run 停止智能客服.cmd
  run run_desktop_real_design.bat
```

If port `3200` is occupied by the wrong mode, run `停止智能客服.cmd`, approve
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

If one of these ports is blocked, run `停止智能客服.cmd` first. If it still
fails, close the listed PID in Task Manager or run the stop file as
administrator.
