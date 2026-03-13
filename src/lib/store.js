import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_DOCTORS } from "./config.js";
import { normalizePhone } from "./clinic.js";

const DATA_DIRECTORY = path.resolve("data");
const DATA_FILE = path.join(DATA_DIRECTORY, "clinic-db.json");

const initialState = {
  patients: [],
  doctors: DEFAULT_DOCTORS,
  appointments: [],
  walkInVisits: [],
  queueEntries: [],
  notifications: [],
  auditLogs: [],
  blockedTimes: [],
  counters: {
    patient: 0,
    appointment: 0,
    walkIn: 0,
    queue: 0,
    notification: 0,
    auditLog: 0
  }
};

let writeQueue = Promise.resolve();

async function ensureDataFile() {
  await mkdir(DATA_DIRECTORY, { recursive: true });
  try {
    await readFile(DATA_FILE, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    await writeFile(DATA_FILE, JSON.stringify(initialState, null, 2));
  }
}

export async function readDatabase() {
  await ensureDataFile();
  const rawContent = await readFile(DATA_FILE, "utf8");
  return JSON.parse(rawContent);
}

export async function updateDatabase(mutator) {
  const operation = writeQueue.then(async () => {
    const database = await readDatabase();
    const result = await mutator(database);
    await writeFile(DATA_FILE, JSON.stringify(database, null, 2));
    return result;
  });

  writeQueue = operation.catch(() => undefined);
  return operation;
}

export function nextId(database, type) {
  database.counters[type] += 1;
  return database.counters[type];
}

export function upsertPatient(database, patientInput) {
  const phone = normalizePhone(patientInput.phone);
  const existingPatient = database.patients.find((patient) => normalizePhone(patient.phone) === phone);

  if (existingPatient) {
    existingPatient.fullName = patientInput.fullName || existingPatient.fullName;
    existingPatient.email = patientInput.email || existingPatient.email;
    existingPatient.dateOfBirth = patientInput.dateOfBirth || existingPatient.dateOfBirth || null;
    return existingPatient;
  }

  const patientId = `patient-${nextId(database, "patient")}`;
  const patient = {
    id: patientId,
    fullName: patientInput.fullName,
    phone,
    email: patientInput.email || "",
    dateOfBirth: patientInput.dateOfBirth || null,
    createdAt: new Date().toISOString()
  };
  database.patients.push(patient);
  return patient;
}
