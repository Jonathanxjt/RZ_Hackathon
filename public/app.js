const state = {
  selectedDate: "",
  availability: [],
  dashboard: null,
  selectedSlot: null
};

const elements = {
  bookingDate: document.querySelector("#booking-date"),
  bookingForm: document.querySelector("#booking-form"),
  bookingFeedback: document.querySelector("#booking-feedback"),
  walkInForm: document.querySelector("#walkin-form"),
  walkInFeedback: document.querySelector("#walkin-feedback"),
  slotGrid: document.querySelector("#slot-grid"),
  slotSummary: document.querySelector("#slot-summary"),
  metricStrip: document.querySelector("#metric-strip"),
  queueList: document.querySelector("#queue-list"),
  appointmentsTable: document.querySelector("#appointments-table"),
  doctorCards: document.querySelector("#doctor-cards"),
  searchForm: document.querySelector("#search-form"),
  searchQuery: document.querySelector("#search-query"),
  searchResults: document.querySelector("#search-results"),
  viewQueueButton: document.querySelector("#view-queue-button"),
  patientQueueView: document.querySelector("#patient-queue-view")
};

function todayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setFeedback(target, message, type = "success") {
  target.textContent = message;
  target.className = `feedback ${type}`;
}

function clearFeedback(target) {
  target.textContent = "";
  target.className = "feedback";
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function renderMetrics(metrics) {
  elements.metricStrip.innerHTML = `
    <div class="metric-card">
      <span class="metric-label">Appointments</span>
      <strong>${metrics.totalAppointments}</strong>
    </div>
    <div class="metric-card">
      <span class="metric-label">Queue</span>
      <strong>${metrics.activeQueue}</strong>
    </div>
    <div class="metric-card">
      <span class="metric-label">With doctor</span>
      <strong>${metrics.inConsultation}</strong>
    </div>
    <div class="metric-card">
      <span class="metric-label">Walk-ins</span>
      <strong>${metrics.walkInsToday}</strong>
    </div>
  `;
}

function renderSlots() {
  if (!state.availability.length) {
    elements.slotGrid.innerHTML = `<p class="empty-state">No bookable slots for this day.</p>`;
    elements.slotSummary.textContent = "No slots available.";
    return;
  }

  const availableCount = state.availability.filter((slot) => slot.isBookable).length;
  elements.slotSummary.textContent = `${availableCount} bookable slots available.`;
  elements.slotGrid.innerHTML = state.availability
    .map((slot) => {
      const isSelected = state.selectedSlot === slot.startTime;
      const disabled = !slot.isBookable;
      const classes = ["slot-pill"];
      if (isSelected) {
        classes.push("selected");
      }
      if (disabled) {
        classes.push("disabled");
      }
      return `
        <button
          type="button"
          class="${classes.join(" ")}"
          data-time="${slot.startTime}"
          ${disabled ? "disabled" : ""}
        >
          ${slot.startTime}
        </button>
      `;
    })
    .join("");
}

function queueStatusOptions(currentStatus) {
  return ["In Queue", "With Doctor", "Completed", "Cancelled", "No Show"]
    .map((status) => `<option value="${status}" ${status === currentStatus ? "selected" : ""}>${status}</option>`)
    .join("");
}

function priorityOptions(currentPriority) {
  return ["Normal", "Priority", "Urgent"]
    .map((priority) => `<option value="${priority}" ${priority === currentPriority ? "selected" : ""}>${priority}</option>`)
    .join("");
}

function renderQueue(queue) {
  if (!queue.length) {
    elements.queueList.innerHTML = `<p class="empty-state">No active queue entries yet.</p>`;
    return;
  }

  elements.queueList.innerHTML = queue
    .map(
      (entry) => `
        <article class="queue-card">
          <div class="queue-primary">
            <div>
              <p class="queue-number">${entry.queueNumber}</p>
              <h3>${entry.patientName}</h3>
              <p class="queue-meta">${entry.visitType} • ${entry.assignedDoctorName}</p>
            </div>
            <div class="pill-group">
              <span class="badge">${entry.priorityLevel}</span>
              <span class="badge muted">${entry.estimatedWaitMinutes} min wait</span>
            </div>
          </div>
          <div class="queue-controls">
            <label>
              <span>Priority</span>
              <select data-priority-id="${entry.id}">
                ${priorityOptions(entry.priorityLevel)}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select data-status-id="${entry.id}">
                ${queueStatusOptions(entry.status)}
              </select>
            </label>
          </div>
        </article>
      `
    )
    .join("");
}

function renderPatientQueue(queue) {
  const activeQueue = queue.filter((entry) => entry.status === "In Queue" || entry.status === "With Doctor");

  if (!activeQueue.length) {
    elements.patientQueueView.innerHTML = `<p class="empty-state">No active patients in queue right now.</p>`;
    return;
  }

  elements.patientQueueView.innerHTML = activeQueue
    .map(
      (entry) => `
        <article class="search-card">
          <div>
            <h3>${entry.queueNumber}</h3>
            <p>${entry.patientName} • ${entry.status} • ${entry.estimatedWaitMinutes} min wait</p>
          </div>
        </article>
      `
    )
    .join("");
}

function renderAppointments(appointments) {
  if (!appointments.length) {
    elements.appointmentsTable.innerHTML = `<p class="empty-state">No appointments for this date.</p>`;
    return;
  }

  elements.appointmentsTable.innerHTML = `
    <div class="table-shell">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Patient</th>
            <th>Doctor</th>
            <th>Status</th>
            <th>Reference</th>
          </tr>
        </thead>
        <tbody>
          ${appointments
      .map(
        (appointment) => `
                <tr>
                  <td>${appointment.startTime}</td>
                  <td>${appointment.patientName}</td>
                  <td>${appointment.doctorName}</td>
                  <td>${appointment.status}</td>
                  <td>${appointment.reference}</td>
                </tr>
              `
      )
      .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDoctors(doctors) {
  elements.doctorCards.innerHTML = doctors
    .map(
      (doctor) => `
        <article class="doctor-card">
          <p class="panel-kicker">${doctor.activeStatus ? "Active doctor" : "Unavailable"}</p>
          <h3>${doctor.fullName}</h3>
          <div class="doctor-stats">
            <div>
              <span>Appointments</span>
              <strong>${doctor.appointmentCount}</strong>
            </div>
            <div>
              <span>Queued</span>
              <strong>${doctor.inQueueCount}</strong>
            </div>
            <div>
              <span>With doctor</span>
              <strong>${doctor.withDoctorCount}</strong>
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

async function loadAvailability() {
  const payload = await api(`/api/availability?date=${state.selectedDate}`);
  state.availability = payload.availability;
  if (!state.availability.some((slot) => slot.startTime === state.selectedSlot && slot.isBookable)) {
    state.selectedSlot = null;
  }
  renderSlots();
}

async function loadDashboard() {
  const payload = await api(`/api/dashboard?date=${state.selectedDate}`);
  state.dashboard = payload;
  renderMetrics(payload.metrics);
  renderQueue(payload.queue);
  renderAppointments(payload.appointments);
  renderDoctors(payload.doctorSummaries);
}

async function bootstrap() {
  state.selectedDate = todayString();
  elements.bookingDate.value = state.selectedDate;

  const payload = await api(`/api/bootstrap?date=${state.selectedDate}`);
  state.availability = payload.availability;
  state.dashboard = payload.dashboard;
  renderSlots();
  renderMetrics(payload.dashboard.metrics);
  renderQueue(payload.dashboard.queue);
  renderAppointments(payload.dashboard.appointments);
  renderDoctors(payload.dashboard.doctorSummaries);
}

async function searchAppointments(event) {
  event.preventDefault();
  const query = elements.searchQuery.value.trim();

  if (!query) {
    elements.searchResults.innerHTML = `<p class="empty-state">Enter a name, phone number, or booking reference.</p>`;
    return;
  }

  const payload = await api(
    `/api/appointments/search?date=${state.selectedDate}&query=${encodeURIComponent(query)}`
  );

  if (!payload.appointments.length) {
    elements.searchResults.innerHTML = `<p class="empty-state">No same-day appointments matched.</p>`;
    return;
  }

  elements.searchResults.innerHTML = payload.appointments
    .map(
      (appointment) => `
        <article class="search-card">
          <div>
            <h3>${appointment.patientName}</h3>
            <p>${appointment.startTime} • ${appointment.reference} • ${appointment.status}</p>
          </div>
          <button class="secondary-button" type="button" data-checkin-id="${appointment.id}">
            Check in
          </button>
        </article>
      `
    )
    .join("");
}

elements.bookingDate.addEventListener("change", async () => {
  state.selectedDate = elements.bookingDate.value;
  clearFeedback(elements.bookingFeedback);
  await loadAvailability();
  await loadDashboard();
});

elements.slotGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-time]");
  if (!button) {
    return;
  }

  state.selectedSlot = button.dataset.time;
  renderSlots();
});

elements.bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFeedback(elements.bookingFeedback);

  if (!state.selectedSlot) {
    setFeedback(elements.bookingFeedback, "Select an available time slot first.", "error");
    return;
  }

  const formData = new FormData(elements.bookingForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    const result = await api("/api/appointments", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        date: state.selectedDate,
        time: state.selectedSlot
      })
    });
    elements.bookingForm.reset();
    state.selectedSlot = null;
    setFeedback(
      elements.bookingFeedback,
      `Booked ${result.appointment.reference} for ${result.appointment.startTime}. Confirmation created instantly.`,
      "success"
    );
    await loadAvailability();
    await loadDashboard();
  } catch (error) {
    setFeedback(elements.bookingFeedback, error.message, "error");
  }
});

elements.walkInForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFeedback(elements.walkInFeedback);
  const formData = new FormData(elements.walkInForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    const result = await api("/api/walk-ins", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    elements.walkInForm.reset();
    setFeedback(
      elements.walkInFeedback,
      `${result.queueEntry.patientName} added as ${result.queueEntry.queueNumber}. Estimated wait ${result.queueEntry.estimatedWaitMinutes} minutes.`,
      "success"
    );
    await loadDashboard();
  } catch (error) {
    setFeedback(elements.walkInFeedback, error.message, "error");
  }
});

elements.searchForm.addEventListener("submit", searchAppointments);

elements.viewQueueButton.addEventListener("click", async () => {
  elements.patientQueueView.innerHTML = `<p class="empty-state">Loading current queue...</p>`;

  try {
    await loadDashboard();
    renderPatientQueue(state.dashboard.queue);
  } catch (error) {
    elements.patientQueueView.innerHTML = `<p class="empty-state">${error.message}</p>`;
  }
});

elements.searchResults.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-checkin-id]");
  if (!button) {
    return;
  }

  try {
    const result = await api("/api/check-in", {
      method: "POST",
      body: JSON.stringify({ appointmentId: button.dataset.checkinId })
    });
    elements.searchResults.innerHTML = `
      <article class="search-card">
        <div>
          <h3>${result.appointment.patientName}</h3>
          <p>Checked in successfully. Queue number ${result.queueEntry.queueNumber}.</p>
        </div>
      </article>
    `;
    await loadDashboard();
  } catch (error) {
    elements.searchResults.innerHTML = `<p class="empty-state">${error.message}</p>`;
  }
});

document.addEventListener("change", async (event) => {
  const prioritySelect = event.target.closest("[data-priority-id]");
  if (prioritySelect) {
    await api(`/api/queue/${prioritySelect.dataset.priorityId}/priority`, {
      method: "POST",
      body: JSON.stringify({ priorityLevel: prioritySelect.value })
    });
    await loadDashboard();
    return;
  }

  const statusSelect = event.target.closest("[data-status-id]");
  if (statusSelect) {
    await api(`/api/queue/${statusSelect.dataset.statusId}/status`, {
      method: "POST",
      body: JSON.stringify({ status: statusSelect.value })
    });
    await loadDashboard();
  }
});

bootstrap();
setInterval(loadDashboard, 15000);
