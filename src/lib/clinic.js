import { CLINIC_CONFIG } from "./config.js";

const MINUTES_PER_HOUR = 60;

export function padTime(value) {
  return String(value).padStart(2, "0");
}

export function toTimeLabel(totalMinutes) {
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  return `${padTime(hours)}:${padTime(minutes)}`;
}

export function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}

export function addMinutesToTime(time, minutesToAdd) {
  return toTimeLabel(timeToMinutes(time) + minutesToAdd);
}

export function isOperatingDay(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return CLINIC_CONFIG.operatingDays.includes(date.getDay());
}

export function isWithinOperatingHours(startTime, endTime) {
  const openMinutes = CLINIC_CONFIG.openingHour * MINUTES_PER_HOUR;
  const closeMinutes = CLINIC_CONFIG.closingHour * MINUTES_PER_HOUR;
  return timeToMinutes(startTime) >= openMinutes && timeToMinutes(endTime) <= closeMinutes;
}

export function compareDateTimes(dateA, timeA, dateB, timeB) {
  return new Date(`${dateA}T${timeA}:00`).getTime() - new Date(`${dateB}T${timeB}:00`).getTime();
}

export function isPastSlot(dateString, time, now = new Date()) {
  return new Date(`${dateString}T${time}:00`).getTime() < now.getTime();
}

export function generateDailySlots(slotDurationMinutes = CLINIC_CONFIG.slotDurationMinutes) {
  const slots = [];
  const openingMinutes = CLINIC_CONFIG.openingHour * MINUTES_PER_HOUR;
  const closingMinutes = CLINIC_CONFIG.closingHour * MINUTES_PER_HOUR;

  for (
    let currentMinutes = openingMinutes;
    currentMinutes + slotDurationMinutes <= closingMinutes;
    currentMinutes += slotDurationMinutes
  ) {
    const startTime = toTimeLabel(currentMinutes);
    const endTime = toTimeLabel(currentMinutes + slotDurationMinutes);
    slots.push({ startTime, endTime });
  }

  return slots;
}

export function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d+]/g, "").trim();
}

export function getDoctorAppointmentsForDate(appointments, doctorId, dateString) {
  return appointments.filter(
    (appointment) =>
      appointment.doctorId === doctorId &&
      appointment.appointmentDate === dateString &&
      !["Cancelled", "No Show"].includes(appointment.status)
  );
}

export function hasTimeConflict(existingEntries, startTime, endTime) {
  const proposedStart = timeToMinutes(startTime);
  const proposedEnd = timeToMinutes(endTime);

  return existingEntries.some((entry) => {
    const entryStart = timeToMinutes(entry.startTime);
    const entryEnd = timeToMinutes(entry.endTime);
    return proposedStart < entryEnd && proposedEnd > entryStart;
  });
}

export function isDoctorAvailable({
  doctorId,
  dateString,
  startTime,
  slotDurationMinutes = CLINIC_CONFIG.slotDurationMinutes,
  appointments,
  blockedTimes = []
}) {
  const endTime = addMinutesToTime(startTime, slotDurationMinutes);
  if (!isOperatingDay(dateString) || !isWithinOperatingHours(startTime, endTime)) {
    return false;
  }

  const doctorAppointments = getDoctorAppointmentsForDate(appointments, doctorId, dateString);
  const doctorBlockedTimes = blockedTimes.filter(
    (blockedTime) => blockedTime.doctorId === doctorId && blockedTime.date === dateString
  );

  return (
    !hasTimeConflict(doctorAppointments, startTime, endTime) &&
    !hasTimeConflict(doctorBlockedTimes, startTime, endTime)
  );
}

export function assignDoctorToSlot({
  dateString,
  startTime,
  doctors,
  appointments,
  blockedTimes = [],
  slotDurationMinutes = CLINIC_CONFIG.slotDurationMinutes
}) {
  const eligibleDoctors = doctors
    .filter((doctor) => doctor.activeStatus)
    .filter((doctor) =>
      isDoctorAvailable({
        doctorId: doctor.id,
        dateString,
        startTime,
        slotDurationMinutes,
        appointments,
        blockedTimes
      })
    )
    .map((doctor) => ({
      doctor,
      load: getDoctorAppointmentsForDate(appointments, doctor.id, dateString).length
    }))
    .sort((left, right) => left.load - right.load || left.doctor.fullName.localeCompare(right.doctor.fullName));

  return eligibleDoctors[0]?.doctor || null;
}

export function buildAvailabilityForDate({
  dateString,
  doctors,
  appointments,
  blockedTimes = [],
  slotDurationMinutes = CLINIC_CONFIG.slotDurationMinutes,
  now = new Date()
}) {
  if (!isOperatingDay(dateString)) {
    return [];
  }

  return generateDailySlots(slotDurationMinutes).map((slot) => {
    const assignedDoctor = assignDoctorToSlot({
      dateString,
      startTime: slot.startTime,
      doctors,
      appointments,
      blockedTimes,
      slotDurationMinutes
    });

    const availableDoctorCount = doctors.filter((doctor) =>
      isDoctorAvailable({
        doctorId: doctor.id,
        dateString,
        startTime: slot.startTime,
        slotDurationMinutes,
        appointments,
        blockedTimes
      })
    ).length;

    return {
      ...slot,
      isBookable: Boolean(assignedDoctor) && !isPastSlot(dateString, slot.startTime, now),
      availableDoctorCount,
      suggestedDoctorId: assignedDoctor?.id || null
    };
  });
}

export function createBookingReference(counter) {
  return `APT-${String(counter).padStart(5, "0")}`;
}

export function createQueueNumber(counter) {
  return `Q-${String(counter).padStart(3, "0")}`;
}

function priorityRank(priorityLevel) {
  switch (priorityLevel) {
    case "Urgent":
      return 0;
    case "Priority":
      return 1;
    default:
      return 2;
  }
}

export function compareQueueEntries(left, right) {
  const priorityDifference = priorityRank(left.priorityLevel) - priorityRank(right.priorityLevel);
  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  return new Date(left.checkInTime).getTime() - new Date(right.checkInTime).getTime();
}

export function sortQueueEntries(entries) {
  return [...entries].sort(compareQueueEntries).map((entry, index) => ({
    ...entry,
    queuePosition: index + 1
  }));
}

export function estimateWaitMinutes({ patientsAhead, activeDoctorCount }) {
  if (patientsAhead <= 0) {
    return 0;
  }

  const divisor = Math.max(activeDoctorCount, 1);
  return Math.ceil((patientsAhead * CLINIC_CONFIG.averageConsultationMinutes) / divisor);
}

export function buildQueueSnapshot({ queueEntries, doctors }) {
  const activeDoctorCount = doctors.filter((doctor) => doctor.activeStatus).length || 1;
  const activeEntries = queueEntries.filter((entry) => ["In Queue", "With Doctor"].includes(entry.status));
  const orderedEntries = sortQueueEntries(activeEntries);

  return orderedEntries.map((entry, index) => ({
    ...entry,
    estimatedWaitMinutes: estimateWaitMinutes({
      patientsAhead: index,
      activeDoctorCount
    })
  }));
}

export function assertBookableSlot({
  dateString,
  startTime,
  doctors,
  appointments,
  blockedTimes = [],
  now = new Date()
}) {
  const endTime = addMinutesToTime(startTime, CLINIC_CONFIG.slotDurationMinutes);

  if (!isOperatingDay(dateString)) {
    throw new Error("Bookings are only allowed from Monday to Saturday.");
  }

  if (!isWithinOperatingHours(startTime, endTime)) {
    throw new Error("Selected slot is outside clinic operating hours.");
  }

  if (isPastSlot(dateString, startTime, now)) {
    throw new Error("Selected slot is in the past.");
  }

  const assignedDoctor = assignDoctorToSlot({
    dateString,
    startTime,
    doctors,
    appointments,
    blockedTimes
  });

  if (!assignedDoctor) {
    throw new Error("Selected slot is no longer available.");
  }

  return assignedDoctor;
}
