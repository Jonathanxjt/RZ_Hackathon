import test from "node:test";
import assert from "node:assert/strict";

import {
  addMinutesToTime,
  assignDoctorToSlot,
  assertBookableSlot,
  buildQueueSnapshot,
  compareQueueEntries
} from "../src/lib/clinic.js";

const doctors = [
  { id: "doctor-1", fullName: "Dr. A", activeStatus: true },
  { id: "doctor-2", fullName: "Dr. B", activeStatus: true },
  { id: "doctor-3", fullName: "Dr. C", activeStatus: true }
];

test("assignDoctorToSlot balances load across available doctors", () => {
  const appointments = [
    {
      id: "appointment-1",
      doctorId: "doctor-1",
      appointmentDate: "2026-03-16",
      startTime: "08:00",
      endTime: "08:15",
      status: "Not Arrived"
    },
    {
      id: "appointment-2",
      doctorId: "doctor-1",
      appointmentDate: "2026-03-16",
      startTime: "08:15",
      endTime: "08:30",
      status: "Not Arrived"
    }
  ];

  const assignedDoctor = assignDoctorToSlot({
    dateString: "2026-03-16",
    startTime: "09:00",
    doctors,
    appointments
  });

  assert.equal(assignedDoctor.id, "doctor-2");
});

test("assertBookableSlot rejects already occupied slots", () => {
  const appointments = [
    {
      id: "appointment-1",
      doctorId: "doctor-1",
      appointmentDate: "2026-03-16",
      startTime: "09:00",
      endTime: "09:15",
      status: "Not Arrived"
    },
    {
      id: "appointment-2",
      doctorId: "doctor-2",
      appointmentDate: "2026-03-16",
      startTime: "09:00",
      endTime: "09:15",
      status: "Not Arrived"
    },
    {
      id: "appointment-3",
      doctorId: "doctor-3",
      appointmentDate: "2026-03-16",
      startTime: "09:00",
      endTime: "09:15",
      status: "Not Arrived"
    }
  ];

  assert.throws(
    () =>
      assertBookableSlot({
        dateString: "2026-03-16",
        startTime: "09:00",
        doctors,
        appointments,
        now: new Date("2026-03-15T08:00:00")
      }),
    /no longer available/i
  );
});

test("compareQueueEntries places urgent patients ahead of normal patients", () => {
  const earlierNormal = {
    priorityLevel: "Normal",
    checkInTime: "2026-03-16T08:00:00.000Z"
  };
  const laterUrgent = {
    priorityLevel: "Urgent",
    checkInTime: "2026-03-16T08:10:00.000Z"
  };

  assert.ok(compareQueueEntries(laterUrgent, earlierNormal) < 0);
});

test("buildQueueSnapshot estimates wait using active doctor count", () => {
  const queue = buildQueueSnapshot({
    doctors,
    queueEntries: [
      {
        id: "queue-1",
        patientId: "patient-1",
        visitType: "walk-in",
        referenceId: "walk-in-1",
        priorityLevel: "Normal",
        checkInTime: "2026-03-16T08:00:00.000Z",
        status: "In Queue"
      },
      {
        id: "queue-2",
        patientId: "patient-2",
        visitType: "walk-in",
        referenceId: "walk-in-2",
        priorityLevel: "Normal",
        checkInTime: "2026-03-16T08:05:00.000Z",
        status: "In Queue"
      },
      {
        id: "queue-3",
        patientId: "patient-3",
        visitType: "walk-in",
        referenceId: "walk-in-3",
        priorityLevel: "Normal",
        checkInTime: "2026-03-16T08:10:00.000Z",
        status: "In Queue"
      }
    ]
  });

  assert.equal(queue[0].estimatedWaitMinutes, 0);
  assert.equal(queue[1].estimatedWaitMinutes, 5);
  assert.equal(queue[2].estimatedWaitMinutes, 10);
});

test("addMinutesToTime returns the expected end time", () => {
  assert.equal(addMinutesToTime("16:45", 15), "17:00");
});
