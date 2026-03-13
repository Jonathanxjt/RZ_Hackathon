# Clinic Intake & Appointment Management System

Lightweight MVP implementation of the clinic PRD using only Node built-ins and a static frontend.

## What is included

- Online appointment booking with slot availability and doctor auto-assignment
- Walk-in registration with queue ticket creation
- Same-day appointment check-in
- Live queue view with estimated wait times
- Staff controls for queue priority and consultation status
- Doctor load summary for the day
- JSON-backed persistence with seeded doctors

## Run locally

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Test

```bash
npm test
```

## Key assumptions

- Fixed 15-minute slot duration
- Exactly 3 active doctors seeded by default
- Email/SMS notifications are recorded as queueable notification entries, not sent externally
- Data persists in `data/clinic-db.json`
