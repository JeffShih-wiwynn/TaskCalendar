# TaskCalendar

TaskCalendar helps you turn tasks into a plan for your day. Keep tasks in your inbox until you are ready to schedule them, then place them on a calendar and track completion in one place.

## Features

- **Tasks with or without a time:** Keep unscheduled tasks in the inbox or give them a start and end time on the calendar.
- **Flexible calendar views:** Switch between day, week, and month views. The day and week views can show working hours or the full day.
- **Fast task planning:** Drag tasks onto the calendar, resize scheduled tasks, reorder inbox tasks, and duplicate tasks when useful.
- **Recurring tasks:** Create daily, weekly, monthly, or yearly tasks and manage one occurrence or the rest of a series.
- **Useful task details:** Add notes and categories, set reminders, mark tasks complete, and review overdue work.
- **Personal calendar preferences:** Choose your timezone, an optional second timezone, working hours, and the first day of the week.
- **Phone-friendly experience:** Use the app on a phone with touch-friendly calendar actions and bottom navigation. Install it as a web app on supported devices.
- **Backups:** Export your calendar data to a file and restore it later.
- **Optional integrations:** Send reminders and daily task summaries to Discord, or mirror selected scheduled tasks to Google Calendar.
- **Private accounts:** Sign in with your own account. The first account becomes the administrator; there is no shared default password.

## Install with Docker

### Requirements

- A Linux server or computer
- Docker Engine and Docker Compose plugin
- Git

On Ubuntu, install Docker Engine and its Compose plugin using the [official Docker instructions](https://docs.docker.com/engine/install/ubuntu/).

### Get a released version

Open the [latest published release](https://github.com/JeffShih-wiwynn/TaskCalendar/releases/latest), copy its tag, and clone that version:

```sh
RELEASE_TAG=vX.Y.Z
git clone --branch "$RELEASE_TAG" --depth 1 https://github.com/JeffShih-wiwynn/TaskCalendar.git
cd TaskCalendar
```

Replace `vX.Y.Z` with the tag shown on the release page.

### Configure and start

Create the environment files:

```sh
cp .env.example .env
cp backend/.env.example backend/.env
```

Edit `.env` and set a private database password. In `backend/.env`, set `APP_BASE_URL` and `FRONTEND_ORIGINS` to the address people will use to open the app. For a home network, use `http://<server-ip>:8088`; for a domain, use its public HTTPS address. Replace `JWT_SECRET_KEY` with a private random value of at least 32 characters. Google Calendar and Discord settings are optional.

Build and start the app:

```sh
docker compose up -d --build
```

Open the configured address, such as `http://<server-ip>:8088`. On the same computer, use <http://localhost:8088>. The first account created becomes the administrator. PostgreSQL data is kept in a persistent Docker volume when the app is stopped or updated.

To stop the services while keeping data:

```sh
docker compose down
```

This runs the released app as a self-hosted service. `./dev.sh` is for developers working on the source code; developer setup and unreleased `main` testing are documented in [Development Commands](docs/dev-commands.md).

### Optional integrations

Discord reminders and Google Calendar mirroring require credentials for those services. They are optional; the calendar and task features work without them. Setup instructions are in [Google Calendar Mirror](docs/google-calendar.md).
