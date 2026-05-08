# Android Plan

This document describes how the current web MVP can grow into an Android client later.

## Current Architecture

- Frontend: React + TypeScript + FullCalendar.
- Backend: FastAPI with task and task-list REST APIs.
- Storage: PostgreSQL through SQLAlchemy models.
- Current app shape: scheduled tasks have checkbox state plus optional calendar timing.

## Future Android Architecture

The Android app should reuse the same backend API instead of introducing a separate backend.

Suggested stack:

- Kotlin
- Jetpack Compose
- Room
- Retrofit or Ktor Client
- WorkManager
- Jetpack Glance

## Why Reuse The Same Backend

- It keeps the task model consistent across web and Android.
- It avoids duplicating scheduling rules.
- It makes future sync behavior easier to reason about.
- It keeps the web MVP and the mobile client aligned on the same source of truth.

## MVP Android Screens

- Today
- Upcoming
- Calendar
- Task editor

## Widget Plan

The long-term widget idea should be based on native Android, not the PWA alone.

- Show today scheduled tasks in a widget.
- Allow checkbox interaction from the widget when feasible.
- Open the task in the app from the widget.
- Update the local Room cache first.
- Sync changes back to the backend in the background.

## Risks

- Offline conflict handling will need a real strategy.
- Background sync is limited by Android constraints.
- Widget refresh timing is not guaranteed.
- Timezone handling must stay explicit so scheduled ranges do not drift between devices.

## PWA As An Intermediate Step

- A PWA can help test installability and Android browser behavior before native Android work starts.
- A PWA does not replace the eventual native Android app.
- A PWA is still useful for layout, touch, and calendar interaction testing.
