export const CLINIC_CONFIG = {
  clinicName: "Northstar Family Clinic",
  address: "123 Orchard Medical Centre, Singapore",
  operatingDays: [1, 2, 3, 4, 5, 6],
  openingHour: 8,
  closingHour: 17,
  slotDurationMinutes: 15,
  reminderHours: [24, 2],
  averageConsultationMinutes: 15
};

export const DEFAULT_DOCTORS = [
  {
    id: "doctor-1",
    fullName: "Dr. Amelia Tan",
    activeStatus: true,
    workingHours: "08:00-17:00",
    createdAt: "2026-03-13T00:00:00.000Z"
  },
  {
    id: "doctor-2",
    fullName: "Dr. Marcus Lee",
    activeStatus: true,
    workingHours: "08:00-17:00",
    createdAt: "2026-03-13T00:00:00.000Z"
  },
  {
    id: "doctor-3",
    fullName: "Dr. Priya Nair",
    activeStatus: true,
    workingHours: "08:00-17:00",
    createdAt: "2026-03-13T00:00:00.000Z"
  }
];

export const APPOINTMENT_STATUSES = [
  "Not Arrived",
  "Checked In",
  "With Doctor",
  "Completed",
  "Cancelled",
  "No Show"
];

export const QUEUE_STATUSES = [
  "In Queue",
  "With Doctor",
  "Completed",
  "Cancelled",
  "No Show"
];

export const PRIORITY_LEVELS = ["Normal", "Priority", "Urgent"];
