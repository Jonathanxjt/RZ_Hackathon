import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  addMinutesToTime,
  assertBookableSlot,
  buildAvailabilityForDate,
  buildQueueSnapshot,
  createBookingReference,
  createQueueNumber,
  normalizePhone
} from "./lib/clinic.js";
import { CLINIC_CONFIG, PRIORITY_LEVELS, QUEUE_STATUSES } from "./lib/config.js";
import { nextId, readDatabase, updateDatabase, upsertPatient } from "./lib/store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDirectory = path.resolve(__dirname, "../public");
const port = Number(process.env.PORT || 3000);

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function notFound(response) {
  json(response, 404, { error: "Not found" });
}

async function parseRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Invalid JSON payload.");
  }
}

function createAuditLog(database, actionType, entityType, entityId, metadata = {}, actorId = "system") {
  const auditId = `audit-${nextId(database, "auditLog")}`;
  database.auditLogs.push({
    id: auditId,
    actorId,
    actionType,
    entityType,
    entityId,
    metadata,
    createdAt: new Date().toISOString()
  });
}

function createNotification(database, patientId, channel, type) {
  const notificationId = `notification-${nextId(database, "notification")}`;
  database.notifications.push({
    id: notificationId,
    patientId,
    channel,
    type,
    status: "Pending",
    sentAt: null
  });
}

function getDoctor(database, doctorId) {
  return database.doctors.find((doctor) => doctor.id === doctorId) || null;
}

function serializeAppointment(database, appointment) {
  const patient = database.patients.find((entry) => entry.id === appointment.patientId) || null;
  const doctor = getDoctor(database, appointment.doctorId);

  return {
    ...appointment,
    patientName: patient?.fullName || "Unknown Patient",
    patientPhone: patient?.phone || "",
    patientEmail: patient?.email || "",
    doctorName: doctor?.fullName || "Unassigned"
  };
}

function serializeQueueEntry(database, queueEntry, estimatedWaitMinutes = 0) {
  const patient = database.patients.find((entry) => entry.id === queueEntry.patientId) || null;
  const appointment =
    queueEntry.visitType === "appointment"
      ? database.appointments.find((entry) => entry.id === queueEntry.referenceId) || null
      : null;
  const walkInVisit =
    queueEntry.visitType === "walk-in"
      ? database.walkInVisits.find((entry) => entry.id === queueEntry.referenceId) || null
      : null;
  const assignedDoctorId = queueEntry.assignedDoctorId || appointment?.doctorId || walkInVisit?.assignedDoctorId || null;
  const doctor = assignedDoctorId ? getDoctor(database, assignedDoctorId) : null;

  return {
    ...queueEntry,
    patientName: patient?.fullName || "Unknown Patient",
    patientPhone: patient?.phone || "",
    assignedDoctorName: doctor?.fullName || "Awaiting assignment",
    notes: appointment?.notes || walkInVisit?.reasonForVisit || "",
    estimatedWaitMinutes
  };
}

function buildDashboard(database, selectedDate) {
  const appointments = database.appointments
    .filter((appointment) => appointment.appointmentDate === selectedDate)
    .sort((left, right) => left.startTime.localeCompare(right.startTime))
    .map((appointment) => serializeAppointment(database, appointment));

  const queueSnapshot = buildQueueSnapshot({
    queueEntries: database.queueEntries,
    doctors: database.doctors
  }).map((entry) => serializeQueueEntry(database, entry, entry.estimatedWaitMinutes));

  const doctorSummaries = database.doctors.map((doctor) => {
    const doctorAppointments = appointments.filter((appointment) => appointment.doctorId === doctor.id);
    const doctorQueue = queueSnapshot.filter((entry) => entry.assignedDoctorId === doctor.id);
    return {
      id: doctor.id,
      fullName: doctor.fullName,
      activeStatus: doctor.activeStatus,
      appointmentCount: doctorAppointments.length,
      inQueueCount: doctorQueue.filter((entry) => entry.status === "In Queue").length,
      withDoctorCount: doctorQueue.filter((entry) => entry.status === "With Doctor").length
    };
  });

  const metrics = {
    totalAppointments: appointments.length,
    activeQueue: queueSnapshot.filter((entry) => entry.status === "In Queue").length,
    inConsultation: queueSnapshot.filter((entry) => entry.status === "With Doctor").length,
    walkInsToday: database.walkInVisits.filter((visit) => visit.registrationDate === selectedDate).length
  };

  return {
    selectedDate,
    metrics,
    appointments,
    queue: queueSnapshot,
    doctorSummaries
  };
}

function validateRequiredFields(input, fields) {
  for (const field of fields) {
    if (!input[field]) {
      throw new Error(`${field} is required.`);
    }
  }
}

async function handleBootstrap(requestUrl, response) {
  const selectedDate = requestUrl.searchParams.get("date") || getLocalDateString();
  const database = await readDatabase();
  const availability = buildAvailabilityForDate({
    dateString: selectedDate,
    doctors: database.doctors,
    appointments: database.appointments,
    blockedTimes: database.blockedTimes
  });
  json(response, 200, {
    config: CLINIC_CONFIG,
    priorityLevels: PRIORITY_LEVELS,
    queueStatuses: QUEUE_STATUSES,
    doctors: database.doctors,
    selectedDate,
    availability,
    dashboard: buildDashboard(database, selectedDate)
  });
}

async function handleAvailability(requestUrl, response) {
  const dateString = requestUrl.searchParams.get("date");
  if (!dateString) {
    json(response, 400, { error: "date is required." });
    return;
  }

  const database = await readDatabase();
  const availability = buildAvailabilityForDate({
    dateString,
    doctors: database.doctors,
    appointments: database.appointments,
    blockedTimes: database.blockedTimes
  });
  json(response, 200, { availability });
}

async function handleCreateAppointment(request, response) {
  try {
    const payload = await parseRequestBody(request);
    validateRequiredFields(payload, ["fullName", "phone", "date", "time"]);

    const result = await updateDatabase((database) => {
      const patient = upsertPatient(database, payload);
      const assignedDoctor = assertBookableSlot({
        dateString: payload.date,
        startTime: payload.time,
        doctors: database.doctors,
        appointments: database.appointments,
        blockedTimes: database.blockedTimes
      });

      const appointmentCounter = nextId(database, "appointment");
      const appointment = {
        id: `appointment-${appointmentCounter}`,
        reference: createBookingReference(appointmentCounter),
        patientId: patient.id,
        doctorId: assignedDoctor.id,
        appointmentDate: payload.date,
        startTime: payload.time,
        endTime: addMinutesToTime(payload.time, CLINIC_CONFIG.slotDurationMinutes),
        status: "Not Arrived",
        bookingSource: "online",
        notes: payload.notes || "",
        createdAt: new Date().toISOString()
      };

      database.appointments.push(appointment);
      createAuditLog(database, "appointment.created", "Appointment", appointment.id, {
        reference: appointment.reference,
        doctorId: assignedDoctor.id
      });
      createNotification(database, patient.id, "sms", "booking_confirmation");
      if (patient.email) {
        createNotification(database, patient.id, "email", "booking_confirmation");
      }

      return {
        appointment: serializeAppointment(database, appointment)
      };
    });

    json(response, 201, { message: "Appointment booked successfully.", ...result });
  } catch (error) {
    const statusCode = error.message.includes("no longer available") ? 409 : 400;
    json(response, statusCode, { error: error.message });
  }
}

async function handleWalkIn(request, response) {
  try {
    const payload = await parseRequestBody(request);
    validateRequiredFields(payload, ["fullName", "phone", "reasonForVisit"]);

    const result = await updateDatabase((database) => {
      const patient = upsertPatient(database, payload);
      const walkInCounter = nextId(database, "walkIn");
      const queueCounter = nextId(database, "queue");
      const now = new Date().toISOString();
      const priorityLevel = PRIORITY_LEVELS.includes(payload.priorityLevel) ? payload.priorityLevel : "Normal";

      const walkInVisit = {
        id: `walk-in-${walkInCounter}`,
        patientId: patient.id,
        registrationTime: now,
        registrationDate: getLocalDateString(),
        status: "In Queue",
        priorityLevel,
        assignedDoctorId: null,
        reasonForVisit: payload.reasonForVisit,
        estimatedWaitMinutes: 0,
        createdAt: now
      };
      database.walkInVisits.push(walkInVisit);

      const queueEntry = {
        id: `queue-${queueCounter}`,
        patientId: patient.id,
        visitType: "walk-in",
        referenceId: walkInVisit.id,
        queueNumber: createQueueNumber(queueCounter),
        queuePosition: null,
        priorityLevel,
        checkInTime: now,
        status: "In Queue",
        assignedDoctorId: null,
        createdAt: now
      };
      database.queueEntries.push(queueEntry);

      createAuditLog(database, "walkin.created", "WalkInVisit", walkInVisit.id, {
        queueEntryId: queueEntry.id,
        priorityLevel
      }, "staff");

      const queueSnapshot = buildQueueSnapshot({
        queueEntries: database.queueEntries,
        doctors: database.doctors
      });
      const currentQueueEntry = queueSnapshot.find((entry) => entry.id === queueEntry.id);

      return {
        walkInVisit,
        queueEntry: serializeQueueEntry(database, queueEntry, currentQueueEntry?.estimatedWaitMinutes || 0)
      };
    });

    json(response, 201, { message: "Walk-in registered successfully.", ...result });
  } catch (error) {
    json(response, 400, { error: error.message });
  }
}

async function handleSearchAppointments(requestUrl, response) {
  const query = (requestUrl.searchParams.get("query") || "").trim().toLowerCase();
  const selectedDate = requestUrl.searchParams.get("date") || getLocalDateString();

  if (!query) {
    json(response, 200, { appointments: [] });
    return;
  }

  const database = await readDatabase();
  const appointments = database.appointments
    .filter((appointment) => appointment.appointmentDate === selectedDate)
    .map((appointment) => serializeAppointment(database, appointment))
    .filter((appointment) => {
      return (
        appointment.reference.toLowerCase().includes(query) ||
        appointment.patientName.toLowerCase().includes(query) ||
        normalizePhone(appointment.patientPhone).includes(normalizePhone(query))
      );
    });

  json(response, 200, { appointments });
}

async function handleCheckIn(request, response) {
  try {
    const payload = await parseRequestBody(request);
    validateRequiredFields(payload, ["appointmentId"]);

    const result = await updateDatabase((database) => {
      const appointment = database.appointments.find((entry) => entry.id === payload.appointmentId);
      if (!appointment) {
        throw new Error("Appointment not found.");
      }
      if (appointment.appointmentDate !== getLocalDateString()) {
        throw new Error("Appointments can only be checked in on the same day.");
      }

      appointment.status = "Checked In";

      let queueEntry = database.queueEntries.find(
        (entry) => entry.referenceId === appointment.id && entry.visitType === "appointment" && entry.status !== "Cancelled"
      );

      if (!queueEntry) {
        const queueCounter = nextId(database, "queue");
        const now = new Date().toISOString();
        queueEntry = {
          id: `queue-${queueCounter}`,
          patientId: appointment.patientId,
          visitType: "appointment",
          referenceId: appointment.id,
          queueNumber: createQueueNumber(queueCounter),
          queuePosition: null,
          priorityLevel: "Normal",
          checkInTime: now,
          status: "In Queue",
          assignedDoctorId: appointment.doctorId,
          createdAt: now
        };
        database.queueEntries.push(queueEntry);
      } else {
        queueEntry.status = "In Queue";
      }

      createAuditLog(database, "appointment.checked_in", "Appointment", appointment.id, {
        queueEntryId: queueEntry.id
      }, "staff");

      const queueSnapshot = buildQueueSnapshot({
        queueEntries: database.queueEntries,
        doctors: database.doctors
      });
      const currentQueueEntry = queueSnapshot.find((entry) => entry.id === queueEntry.id);

      return {
        appointment: serializeAppointment(database, appointment),
        queueEntry: serializeQueueEntry(database, queueEntry, currentQueueEntry?.estimatedWaitMinutes || 0)
      };
    });

    json(response, 200, { message: "Patient checked in successfully.", ...result });
  } catch (error) {
    json(response, 400, { error: error.message });
  }
}

async function handleQueuePriority(request, response, queueId) {
  try {
    const payload = await parseRequestBody(request);
    if (!PRIORITY_LEVELS.includes(payload.priorityLevel)) {
      throw new Error("Invalid priority level.");
    }

    await updateDatabase((database) => {
      const queueEntry = database.queueEntries.find((entry) => entry.id === queueId);
      if (!queueEntry) {
        throw new Error("Queue entry not found.");
      }
      queueEntry.priorityLevel = payload.priorityLevel;

      if (queueEntry.visitType === "walk-in") {
        const walkInVisit = database.walkInVisits.find((entry) => entry.id === queueEntry.referenceId);
        if (walkInVisit) {
          walkInVisit.priorityLevel = payload.priorityLevel;
        }
      }

      createAuditLog(database, "queue.priority_updated", "QueueEntry", queueEntry.id, {
        priorityLevel: payload.priorityLevel
      }, "staff");
    });

    json(response, 200, { message: "Priority updated." });
  } catch (error) {
    json(response, 400, { error: error.message });
  }
}

async function handleQueueStatus(request, response, queueId) {
  try {
    const payload = await parseRequestBody(request);
    if (!QUEUE_STATUSES.includes(payload.status)) {
      throw new Error("Invalid queue status.");
    }

    await updateDatabase((database) => {
      const queueEntry = database.queueEntries.find((entry) => entry.id === queueId);
      if (!queueEntry) {
        throw new Error("Queue entry not found.");
      }
      queueEntry.status = payload.status;

      if (queueEntry.visitType === "appointment") {
        const appointment = database.appointments.find((entry) => entry.id === queueEntry.referenceId);
        if (appointment) {
          appointment.status = payload.status === "In Queue" ? "Checked In" : payload.status;
        }
      }

      if (queueEntry.visitType === "walk-in") {
        const walkInVisit = database.walkInVisits.find((entry) => entry.id === queueEntry.referenceId);
        if (walkInVisit) {
          walkInVisit.status = payload.status;
        }
      }

      createAuditLog(database, "queue.status_updated", "QueueEntry", queueEntry.id, {
        status: payload.status
      }, "staff");
    });

    json(response, 200, { message: "Queue status updated." });
  } catch (error) {
    json(response, 400, { error: error.message });
  }
}

async function handleDashboard(requestUrl, response) {
  const selectedDate = requestUrl.searchParams.get("date") || getLocalDateString();
  const database = await readDatabase();
  json(response, 200, buildDashboard(database, selectedDate));
}

async function serveStaticAsset(requestUrl, response) {
  const requestedPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.normalize(path.join(publicDirectory, requestedPath));
  if (!filePath.startsWith(publicDirectory)) {
    notFound(response);
    return;
  }

  try {
    await readFile(filePath);
  } catch {
    notFound(response);
    return;
  }

  const extension = path.extname(filePath);
  const contentTypeMap = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };

  response.writeHead(200, {
    "Content-Type": contentTypeMap[extension] || "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (request.method === "GET" && requestUrl.pathname === "/api/bootstrap") {
      await handleBootstrap(requestUrl, response);
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/availability") {
      await handleAvailability(requestUrl, response);
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/appointments") {
      await handleCreateAppointment(request, response);
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/appointments/search") {
      await handleSearchAppointments(requestUrl, response);
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/check-in") {
      await handleCheckIn(request, response);
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/walk-ins") {
      await handleWalkIn(request, response);
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/dashboard") {
      await handleDashboard(requestUrl, response);
      return;
    }

    const queuePriorityMatch = requestUrl.pathname.match(/^\/api\/queue\/([^/]+)\/priority$/);
    if (request.method === "POST" && queuePriorityMatch) {
      await handleQueuePriority(request, response, queuePriorityMatch[1]);
      return;
    }

    const queueStatusMatch = requestUrl.pathname.match(/^\/api\/queue\/([^/]+)\/status$/);
    if (request.method === "POST" && queueStatusMatch) {
      await handleQueueStatus(request, response, queueStatusMatch[1]);
      return;
    }

    if (request.method === "GET") {
      await serveStaticAsset(requestUrl, response);
      return;
    }

    notFound(response);
  } catch (error) {
    json(response, 500, { error: error.message || "Unexpected server error." });
  }
});

server.listen(port, () => {
  console.log(`Clinic intake system running at http://localhost:${port}`);
});
